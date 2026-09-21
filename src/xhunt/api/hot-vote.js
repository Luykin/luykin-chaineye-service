const express = require("express");
const crypto = require("crypto");
const { body, param, query, header } = require("express-validator");
const { fn, col, Op, UniqueConstraintError } = require("sequelize");
const { validateRequest } = require("../middleware/validate-request");
const {
  authenticateToken,
  authenticateTokenOptional,
} = require("../middleware/auth");
const { voteRateLimiter } = require("../middleware/security");
const {
  XHuntHotVoteTopic,
  XHuntHotVoteRecord,
  XHuntHotVoteComment,
  pgInstance,
} = require("../../models/postgres-start");
const { sanitizePlainText } = require("../services/inputValidator");
const { containsSensitiveWord } = require("../services/sensitiveWordFilter");

const router = express.Router();

// Redis 投票计数缓存 TTL（秒），与 getTopicVoteDistribution 回填逻辑保持一致
const HOT_VOTE_CACHE_TTL_SECONDS = 3600;

/**
 * 议题有效性校验：必须为已发布状态且当前时间处于 [startTime, endTime] 窗口内
 * startTime / endTime 为 null 时表示对应方向不限（与 GET /active 过滤逻辑一致）
 */
function isTopicActive(topic, now = new Date()) {
  if (!topic || topic.status !== "published") return false;
  if (topic.startTime && new Date(topic.startTime) > now) return false;
  if (topic.endTime && new Date(topic.endTime) < now) return false;
  return true;
}

/**
 * 投票计数 hIncrBy 若先于回填创建了缓存 key，则该 key 没有 TTL 会永久残留，
 * 这里在自增后检查并补兜底过期时间
 */
async function ensureVoteCacheTtl(redisClient, cacheKey) {
  try {
    if (redisClient?.ttl && redisClient?.expire) {
      const ttl = await redisClient.ttl(cacheKey);
      if (ttl === -1) {
        await redisClient.expire(cacheKey, HOT_VOTE_CACHE_TTL_SECONDS);
      }
    }
  } catch (e) {
    console.warn("[HotVote] Redis ttl check error:", e.message);
  }
}

function normalizeTesterIdentifier(val) {
  if (!val) return "";
  return String(val).trim().toLowerCase().replace(/^@/, "");
}

function isHotVoteTester(testList, { username, twitterId }) {
  if (!Array.isArray(testList) || testList.length === 0) return false;
  const identifiers = [username, twitterId].map(normalizeTesterIdentifier).filter(Boolean);
  if (!identifiers.length) return false;
  return testList.some((item) => identifiers.includes(normalizeTesterIdentifier(item)));
}

async function getTopicVoteDistribution(topicId, optionsList, redisClient) {
  const cacheKey = `hotvote:counts:${topicId}`;
  let participants = 0;
  let cacheHit = false;
  const countsMap = {};

  try {
    if (redisClient?.hGetAll) {
      const cached = await redisClient.hGetAll(cacheKey);
      if (cached && Object.keys(cached).length > 0 && cached.participants !== undefined) {
        participants = parseInt(cached.participants || "0", 10);
        let allOptionsPresent = true;
        for (const opt of optionsList) {
          if (cached[`opt:${opt.id}`] === undefined) {
            allOptionsPresent = false;
            break;
          }
          countsMap[opt.id] = parseInt(cached[`opt:${opt.id}`] || "0", 10);
        }
        if (allOptionsPresent) {
          cacheHit = true;
        }
      }
    }
  } catch (err) {
    console.warn("[HotVote] Redis read error:", err.message);
  }

  // If cache miss, calculate from DB and populate Redis
  if (!cacheHit) {
    const totalCount = await XHuntHotVoteRecord.count({ where: { topicId } });
    participants = totalCount;

    const groupCounts = await XHuntHotVoteRecord.findAll({
      where: { topicId },
      attributes: ["optionId", [fn("COUNT", col("id")), "count"]],
      group: ["optionId"],
      raw: true,
    });

    const dbMap = {};
    for (const g of groupCounts) {
      dbMap[g.optionId] = parseInt(g.count || "0", 10);
    }

    const redisPayload = { participants: String(participants) };
    for (const opt of optionsList) {
      const count = dbMap[opt.id] || 0;
      countsMap[opt.id] = count;
      redisPayload[`opt:${opt.id}`] = String(count);
    }

    try {
      if (redisClient?.hSet) {
        await redisClient.hSet(cacheKey, redisPayload);
        await redisClient.expire(cacheKey, 3600); // 1 hour TTL
      }
    } catch (err) {
      console.warn("[HotVote] Redis write error:", err.message);
    }
  }

  const distribution = {};
  for (const opt of optionsList) {
    const count = countsMap[opt.id] || 0;
    const percentage =
      participants > 0 ? `${Math.round((count / participants) * 100)}%` : "0%";
    distribution[opt.id] = {
      count,
      percentage,
    };
  }

  return {
    totalParticipants: participants,
    distribution,
  };
}

/**
 * GET /api/xhunt/hot-vote/active
 * 获取当前生效的热点议题及用户个人投票状态
 */
router.get(
  "/active",
  [
    authenticateTokenOptional,
    query("domain").optional().trim().isIn(["web3", "ai"]).withMessage("domain 必须是 web3 或 ai"),
    query("lang").optional().trim().isIn(["zh", "en"]).withMessage("lang 必须是 zh 或 en"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const domain = req.query.domain || "web3";
      const lang = req.query.lang || "zh";
      const rawTwitterId = req.headers["x-tw-id"] || req.user?.twitterId || null;
      const twitterId = rawTwitterId && /^\d{1,25}$/.test(String(rawTwitterId).trim())
        ? String(rawTwitterId).trim()
        : null;
      const requestHandle = req.headers["x-user-id"] || req.user?.username || null;

      const now = new Date();

      // 查询处于发布状态且匹配领域与语言的议题列表（由数据库直接按数组包含过滤，避免硬编码 LIMIT 导致多语种/领域被饿死截断）
      const topics = await XHuntHotVoteTopic.findAll({
        where: {
          status: "published",
          displayDomains: { [Op.contains]: [domain] },
          displayLanguages: { [Op.contains]: [lang] },
          [Op.and]: [
            {
              [Op.or]: [
                { startTime: null },
                { startTime: { [Op.lte]: now } },
              ],
            },
            {
              [Op.or]: [
                { endTime: null },
                { endTime: { [Op.gte]: now } },
              ],
            },
          ],
        },
        order: [
          ["sortWeight", "DESC"],
          ["createdAt", "DESC"],
        ],
      });

      // 测试模式精准过滤：寻找第一条当前用户有权查看的生效议题
      let activeTopic = null;
      for (const t of topics) {
        if (t.testingPhase) {
          const isTester = isHotVoteTester(t.testList, {
            username: requestHandle,
            twitterId,
          });
          if (!isTester) continue;
        }

        activeTopic = t;
        break;
      }

      if (!activeTopic) {
        return res.json({ success: true, data: null });
      }

      // 获取当前用户的投票状态
      let userState = {
        hasVoted: false,
        votedOptionId: null,
        remainingRevotes: activeTopic.maxRevotes,
      };

      if (twitterId) {
        const record = await XHuntHotVoteRecord.findOne({
          where: {
            topicId: activeTopic.id,
            twitterId,
          },
        });

        if (record) {
          userState = {
            hasVoted: true,
            votedOptionId: record.optionId,
            remainingRevotes: Math.max(0, activeTopic.maxRevotes - record.revoteCount),
          };
        }
      }

      // 计算投票统计结果 (仅已投票用户返回结果数据，未投票时返回 null)
      let results = null;
      if (userState.hasVoted) {
        const optionsList = Array.isArray(activeTopic.options) ? activeTopic.options : [];
        results = await getTopicVoteDistribution(
          activeTopic.id,
          optionsList,
          req.redisClient
        );
      }

      return res.json({
        success: true,
        data: {
          topic: {
            id: activeTopic.id,
            title: activeTopic.title,
            titleHtml: activeTopic.titleHtml || null,
            summary: activeTopic.summary,
            topicType: activeTopic.topicType,
            options: activeTopic.options,
            maxRevotes: activeTopic.maxRevotes,
          },
          userState,
          results,
        },
      });
    } catch (err) {
      console.error("[HotVote] GET /active error:", err);
      return res.status(500).json({ success: false, error: "获取热点投票失败" });
    }
  }
);

/**
 * POST /api/xhunt/hot-vote/topics/:topicId/vote
 * 提交投票（免登录或登录均可）
 */
router.post(
  "/topics/:topicId/vote",
  [
    voteRateLimiter,
    authenticateTokenOptional,
    header("x-tw-id").trim().matches(/^\d{1,25}$/).withMessage("无效的 Twitter ID"),
    param("topicId").isUUID().withMessage("无效的议题ID"),
    body("optionId").trim().matches(/^[a-zA-Z0-9_-]{1,32}$/).withMessage("无效的选项ID"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const { topicId } = req.params;
      const { optionId } = req.body;
      const twitterId = req.headers["x-tw-id"].trim();
      const requestHandle = req.headers["x-user-id"] || req.user?.username || null;

      // 若携带 Token 登录态，校验一致性防伪造
      if (req.user?.twitterId && req.user.twitterId !== twitterId) {
        return res.status(403).json({ success: false, error: "TWITTER_ID_MISMATCH" });
      }

      const topic = await XHuntHotVoteTopic.findByPk(topicId);
      if (!topic) {
        return res.status(404).json({ success: false, error: "议题不存在或已下线" });
      }
      if (!isTopicActive(topic)) {
        return res.status(403).json({ success: false, error: "TOPIC_NOT_ACTIVE" });
      }

      // 测试阶段鉴权
      if (topic.testingPhase) {
        const isTester = isHotVoteTester(topic.testList, {
          username: requestHandle,
          twitterId,
        });
        if (!isTester) {
          return res.status(403).json({ success: false, error: "该议题当前仅内测人员可见" });
        }
      }

      // 验证选项合法性
      const options = Array.isArray(topic.options) ? topic.options : [];
      const optionExists = options.some((opt) => opt.id === optionId);
      if (!optionExists) {
        return res.status(400).json({ success: false, error: "选项不存在" });
      }

      // 频控检查 (同一推特ID 3秒内防抖)
      const rateLimitKey = `ratelimit:hotvote:${twitterId}`;
      if (req.redisClient?.set) {
        const acquired = await req.redisClient.set(rateLimitKey, "1", {
          PX: 3000,
          NX: true,
        });
        if (!acquired) {
          return res.status(429).json({ success: false, error: "操作过于频繁，请稍候再试" });
        }
      }

      // 事务写入并防重
      let created = false;
      await pgInstance.transaction(async (t) => {
        const existing = await XHuntHotVoteRecord.findOne({
          where: { topicId, twitterId },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (existing) {
          return;
        }

        await XHuntHotVoteRecord.create(
          {
            topicId,
            twitterId,
            xHuntUserId: req.user?.id || null,
            optionId,
            revoteCount: 0,
            clientIp: req.ip || null,
          },
          { transaction: t }
        );
        created = true;
      });

      if (!created) {
        return res.status(400).json({ success: false, error: "您已参与过该投票，请使用修改选择功能" });
      }

      // 更新 Redis 缓存原子自增（仅在缓存存在时自增；若缓存失效切勿直接自增，交由 getTopicVoteDistribution 从 DB 全量回填）
      const cacheKey = `hotvote:counts:${topicId}`;
      if (req.redisClient) {
        try {
          const cacheExists = req.redisClient.exists
            ? (await req.redisClient.exists(cacheKey)) === 1
            : false;
          if (cacheExists && req.redisClient.hIncrBy) {
            await req.redisClient.hIncrBy(cacheKey, "participants", 1);
            await req.redisClient.hIncrBy(cacheKey, `opt:${optionId}`, 1);
            await ensureVoteCacheTtl(req.redisClient, cacheKey);
          }
        } catch (e) {
          console.warn("[HotVote] Redis hIncrBy error:", e.message);
        }
      }

      const results = await getTopicVoteDistribution(topicId, options, req.redisClient);

      return res.json({
        success: true,
        data: {
          userState: {
            hasVoted: true,
            votedOptionId: optionId,
            remainingRevotes: topic.maxRevotes,
          },
          results,
        },
      });
    } catch (err) {
      // 并发下第二个请求撞 uk_hot_vote_topic_twitter_id 唯一索引时，返回友好错误而非 500
      if (err instanceof UniqueConstraintError || err.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({ success: false, error: "ALREADY_VOTED", message: "您已参与过该投票，请使用修改选择功能" });
      }
      console.error("[HotVote] POST /vote error:", err);
      return res.status(500).json({ success: false, error: "投票提交失败，请重试" });
    }
  }
);

/**
 * PUT /api/xhunt/hot-vote/topics/:topicId/vote
 * 修改投票选项（受 maxRevotes 限制）
 */
router.put(
  "/topics/:topicId/vote",
  [
    voteRateLimiter,
    authenticateTokenOptional,
    header("x-tw-id").trim().matches(/^\d{1,25}$/).withMessage("无效的 Twitter ID"),
    param("topicId").isUUID().withMessage("无效的议题ID"),
    body("newOptionId").trim().matches(/^[a-zA-Z0-9_-]{1,32}$/).withMessage("无效的新选项ID"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const { topicId } = req.params;
      const { newOptionId } = req.body;
      const twitterId = req.headers["x-tw-id"].trim();
      const requestHandle = req.headers["x-user-id"] || req.user?.username || null;

      if (req.user?.twitterId && req.user.twitterId !== twitterId) {
        return res.status(403).json({ success: false, error: "TWITTER_ID_MISMATCH" });
      }

      const topic = await XHuntHotVoteTopic.findByPk(topicId);
      if (!topic) {
        return res.status(404).json({ success: false, error: "议题不存在或已下线" });
      }
      if (!isTopicActive(topic)) {
        return res.status(403).json({ success: false, error: "TOPIC_NOT_ACTIVE" });
      }

      // 测试阶段鉴权
      if (topic.testingPhase) {
        const isTester = isHotVoteTester(topic.testList, {
          username: requestHandle,
          twitterId,
        });
        if (!isTester) {
          return res.status(403).json({ success: false, error: "该议题当前仅内测人员可见" });
        }
      }

      const options = Array.isArray(topic.options) ? topic.options : [];
      const optionExists = options.some((opt) => opt.id === newOptionId);
      if (!optionExists) {
        return res.status(400).json({ success: false, error: "所选新选项不存在" });
      }

      // 频控检查 (3秒冷却)
      const rateLimitKey = `ratelimit:hotvote:${twitterId}`;
      if (req.redisClient?.set) {
        const acquired = await req.redisClient.set(rateLimitKey, "1", {
          PX: 3000,
          NX: true,
        });
        if (!acquired) {
          return res.status(429).json({ success: false, error: "操作过于频繁，请稍候再试" });
        }
      }

      let oldOptionId = null;
      let newRevoteCount = 0;

      await pgInstance.transaction(async (t) => {
        const record = await XHuntHotVoteRecord.findOne({
          where: { topicId, twitterId },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (!record) {
          throw new Error("VOTE_RECORD_NOT_FOUND");
        }

        if (record.optionId === newOptionId) {
          throw new Error("SAME_OPTION");
        }

        if (record.revoteCount >= topic.maxRevotes) {
          throw new Error("REVOTE_LIMIT_EXCEEDED");
        }

        oldOptionId = record.optionId;
        record.previousOptionId = oldOptionId;
        record.optionId = newOptionId;
        record.revoteCount += 1;
        if (req.user?.id) {
          record.xHuntUserId = req.user.id;
        }

        await record.save({ transaction: t });
        newRevoteCount = record.revoteCount;
      });

      // 原子更新 Redis 缓存（旧选项 -1，新选项 +1；仅在缓存存在时自增，防止产生负数与脏数据）
      const cacheKey = `hotvote:counts:${topicId}`;
      if (req.redisClient && oldOptionId) {
        try {
          const cacheExists = req.redisClient.exists
            ? (await req.redisClient.exists(cacheKey)) === 1
            : false;
          if (cacheExists && req.redisClient.hIncrBy) {
            await req.redisClient.hIncrBy(cacheKey, `opt:${oldOptionId}`, -1);
            await req.redisClient.hIncrBy(cacheKey, `opt:${newOptionId}`, 1);
            await ensureVoteCacheTtl(req.redisClient, cacheKey);
          }
        } catch (e) {
          console.warn("[HotVote] Redis revote hIncrBy error:", e.message);
        }
      }

      const results = await getTopicVoteDistribution(topicId, options, req.redisClient);

      return res.json({
        success: true,
        data: {
          userState: {
            hasVoted: true,
            votedOptionId: newOptionId,
            remainingRevotes: Math.max(0, topic.maxRevotes - newRevoteCount),
          },
          results,
        },
      });
    } catch (err) {
      if (err.message === "VOTE_RECORD_NOT_FOUND") {
        return res.status(404).json({ success: false, error: "未找到您的历史投票记录" });
      }
      if (err.message === "SAME_OPTION") {
        return res.status(400).json({ success: false, error: "您已支持该选项，无需重复修改" });
      }
      if (err.message === "REVOTE_LIMIT_EXCEEDED") {
        return res.status(403).json({ success: false, error: "已达到该议题的最大修改次数限制" });
      }
      console.error("[HotVote] PUT /vote error:", err);
      return res.status(500).json({ success: false, error: "修改投票失败，请重试" });
    }
  }
);

/**
 * GET /api/xhunt/hot-vote/topics/:topicId/comments
 * 获取留言列表（公开免登录）
 */
router.get(
  "/topics/:topicId/comments",
  [
    param("topicId").isUUID().withMessage("无效的议题ID"),
    query("page").optional().isInt({ min: 1, max: 1000 }).toInt(),
    query("pageSize").optional().isInt({ min: 1, max: 20 }).toInt(),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const { topicId } = req.params;
      const page = req.query.page || 1;
      const pageSize = req.query.pageSize || 3;
      const offset = (page - 1) * pageSize;

      const { count, rows } = await XHuntHotVoteComment.findAndCountAll({
        where: {
          topicId,
          isDeleted: false,
        },
        order: [["createdAt", "DESC"]],
        limit: pageSize,
        offset,
        attributes: [
          "id",
          "twitterId",
          "userName",
          "displayName",
          "userAvatar",
          "content",
          "createdAt",
        ],
      });

      return res.json({
        success: true,
        data: {
          list: rows,
          pagination: {
            page,
            pageSize,
            total: count,
            totalPages: Math.ceil(count / pageSize),
          },
        },
      });
    } catch (err) {
      console.error("[HotVote] GET /comments error:", err);
      return res.status(500).json({ success: false, error: "获取留言失败" });
    }
  }
);

/**
 * POST /api/xhunt/hot-vote/topics/:topicId/comments
 * 发表留言（强制登录鉴权）
 */
router.post(
  "/topics/:topicId/comments",
  [
    authenticateToken,
    param("topicId").isUUID().withMessage("无效的议题ID"),
    body("content")
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage("留言字数需在 1 ~ 200 字之间"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const { topicId } = req.params;
      const cleanContent = sanitizePlainText(req.body.content, 200);

      if (!cleanContent || cleanContent.trim().length === 0) {
        return res.status(400).json({ success: false, error: "留言内容不能为空" });
      }

      const topic = await XHuntHotVoteTopic.findByPk(topicId);
      if (!topic) {
        return res.status(404).json({ success: false, error: "议题不存在或已关闭" });
      }
      if (!isTopicActive(topic)) {
        return res.status(403).json({ success: false, error: "TOPIC_NOT_ACTIVE" });
      }

      const twitterId = req.user.twitterId;
      if (!twitterId) {
        return res.status(400).json({ success: false, error: "未关联有效的推特账号" });
      }

      // 测试阶段鉴权
      if (topic.testingPhase) {
        const isTester = isHotVoteTester(topic.testList, {
          username: req.user.username,
          twitterId,
        });
        if (!isTester) {
          return res.status(403).json({ success: false, error: "该议题当前仅内测人员可见" });
        }
      }

      // 敏感词过滤
      if (containsSensitiveWord(cleanContent)) {
        return res.status(400).json({ success: false, error: "SENSITIVE_CONTENT", message: "留言内容包含违规信息，请修改后再试" });
      }

      // 防灌水限频：同一推特ID 30秒内只能发一条留言
      const rateLimitKey = `ratelimit:comment:${topicId}:${twitterId}`;
      if (req.redisClient?.set) {
        const acquired = await req.redisClient.set(rateLimitKey, "1", {
          EX: 30,
          NX: true,
        });
        if (!acquired) {
          return res.status(429).json({ success: false, error: "发言过于频繁，请稍候再试（30秒冷却）" });
        }
      }

      // 防重复内容：同一用户 5 分钟内重复提交相同正文直接拒绝
      const contentMd5 = crypto.createHash("md5").update(cleanContent).digest("hex");
      const dupKey = `ratelimit:comment-dup:${topicId}:${twitterId}:${contentMd5}`;
      if (req.redisClient?.set) {
        const acquired = await req.redisClient.set(dupKey, "1", {
          EX: 300,
          NX: true,
        });
        if (!acquired) {
          return res.status(429).json({ success: false, error: "DUPLICATE_COMMENT", message: "5分钟内请勿重复提交相同内容" });
        }
      }

      // 单人单议题最多5条留言限制
      const userCommentCount = await XHuntHotVoteComment.count({
        where: {
          topicId,
          twitterId,
          isDeleted: false,
        },
      });

      if (userCommentCount >= 5) {
        return res.status(403).json({ success: false, error: "您在此议题下的留言数量已达上限 (最多5条)" });
      }

      const newComment = await XHuntHotVoteComment.create({
        topicId,
        twitterId,
        xHuntUserId: req.user.id,
        userName: req.user.username || "Anonymous",
        displayName: req.user.displayName || req.user.username || "User",
        userAvatar: (req.user.avatar || "").substring(0, 512),
        content: cleanContent,
        isDeleted: false,
      });

      return res.json({
        success: true,
        data: {
          id: newComment.id,
          twitterId: newComment.twitterId,
          userName: newComment.userName,
          displayName: newComment.displayName,
          userAvatar: newComment.userAvatar,
          content: newComment.content,
          createdAt: newComment.createdAt,
        },
      });
    } catch (err) {
      console.error("[HotVote] POST /comments error:", err);
      return res.status(500).json({ success: false, error: "留言发布失败，请重试" });
    }
  }
);

module.exports = router;
