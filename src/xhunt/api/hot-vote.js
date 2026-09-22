const express = require("express");
const crypto = require("crypto");
const { body, param, query, header } = require("express-validator");
const { fn, col, Op, QueryTypes, UniqueConstraintError } = require("sequelize");
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
  XHuntUser,
  pgInstance,
} = require("../../models/postgres-start");
const { sanitizePlainText, sanitizeSafeUrl } = require("../services/inputValidator");
const { containsSensitiveWord } = require("../services/sensitiveWordFilter");
const { auditCommentContentWithAI } = require("../services/hotVoteModerationService");
const {
  handleNegotiatedCache,
  invalidateTopicCommentsCache,
  getCachedTopicCommentsPage,
} = require("../utils/hot-vote-cache");
const { queryTwitterProfile } = require("./stats-routes/twitter-id-handler-lookup");

const router = express.Router();
/**
 * 根据 Twitter ID 调取推特用户公开档案（直接复用管理后台 /xhunt/stats#/twitter-id-handler 的接口服务）
 * 支持 Redis 24 小时缓存；报错或查无结果时回退为默认头像
 */
async function fetchTwitterProfileSafe(twitterId, redisClient = null) {
  if (!twitterId) return null;
  const cleanTwId = String(twitterId).trim();
  const cacheKey = `hotvote:twitter:profile:${cleanTwId}`;

  if (redisClient?.get) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {}
  }

  try {
    const profile = await queryTwitterProfile({ user_id: cleanTwId });
    if (profile && (profile.avatar || profile.displayName || profile.handler)) {
      if (redisClient?.set) {
        try {
          await redisClient.set(cacheKey, JSON.stringify(profile), { EX: 86400 });
        } catch (_) {}
      }
      return profile;
    }
  } catch (err) {
    console.warn(`[HotVote] 查询 Twitter 用户资料失败 (twitterId=${cleanTwId}):`, err.message);
  }

  return null;
}

/**
 * 智能解析选民/留言用户的身份信息：
 * 优先级顺序：
 * 1. 携带的 Token 认证态 (req.user)
 * 2. 客户端显式传递的参数 (req.body.userAvatar/avatar, req.headers["x-user-avatar"], displayName, userName)
 * 3. 调取 Twitter ID 查询接口 (与 /xhunt/stats#/twitter-id-handler 一致，报错使用默认头像)
 */
async function resolveVoterUserInfo(req, twitterId) {
  const effectiveUserId = req.user?.id || null;
  let userName = req.user?.username || null;
  let displayName = req.user?.displayName || null;
  let userAvatar = req.user?.avatar || null;

  // 1. 提取请求头
  const rawHeaderHandle = req.headers["x-user-id"];
  const headerHandle = rawHeaderHandle
    ? String(rawHeaderHandle).replace(/^@/, "").trim().substring(0, 50)
    : null;
  const rawHeaderName = req.headers["x-user-name"];
  const headerDisplayName = rawHeaderName
    ? String(rawHeaderName).trim().substring(0, 50)
    : null;
  const rawHeaderAvatar = req.headers["x-user-avatar"] || req.headers["x-avatar"];
  const headerAvatar = rawHeaderAvatar && typeof rawHeaderAvatar === "string"
    ? sanitizeSafeUrl(rawHeaderAvatar.trim(), 512)
    : null;

  // 2. 提取请求体
  const rawBodyAvatar = req.body?.userAvatar || req.body?.avatar;
  const bodyAvatar = rawBodyAvatar && typeof rawBodyAvatar === "string"
    ? sanitizeSafeUrl(rawBodyAvatar.trim(), 512)
    : null;
  const rawBodyDisplayName = req.body?.displayName || req.body?.name;
  const bodyDisplayName = rawBodyDisplayName
    ? sanitizePlainText(String(rawBodyDisplayName), 50)
    : null;
  const rawBodyUserName = req.body?.userName || req.body?.username || req.body?.handle;
  const bodyUserName = rawBodyUserName
    ? String(rawBodyUserName).replace(/^@/, "").trim().substring(0, 50)
    : null;

  if (!userName) userName = bodyUserName || headerHandle;
  if (!displayName) displayName = bodyDisplayName || headerDisplayName || userName;
  if (!userAvatar) userAvatar = bodyAvatar || headerAvatar;

  // 3. 若缺少头像或昵称，调用 Twitter ID 查询接口
  const cleanTwitterId = twitterId ? String(twitterId).trim() : null;
  if (cleanTwitterId && (!userAvatar || !displayName || !userName || displayName === "Anonymous")) {
    const profile = await fetchTwitterProfileSafe(cleanTwitterId, req.redisClient);
    if (profile) {
      if (!userAvatar && profile.avatar) {
        userAvatar = profile.avatar;
      }
      if ((!displayName || displayName === "Anonymous") && profile.displayName) {
        displayName = profile.displayName;
      }
      if ((!userName || userName === "Anonymous") && profile.handler) {
        userName = profile.handler;
      }
    }
  }

  // 4. 报错或查无头像时回退使用默认头像
  if (!userAvatar) {
    userAvatar = getAnonymousAvatar(cleanTwitterId || "default");
  }

  return {
    effectiveUserId,
    userName: userName || "Anonymous",
    displayName: displayName || userName || "User",
    userAvatar: sanitizeSafeUrl(userAvatar, 512) || getAnonymousAvatar(cleanTwitterId || "default"),
  };
}

/**
 * 辅助解析 XHunt 用户 ID：若未携带登录态，则尝试根据推特 ID 反查既有账户
 */
async function resolveXHuntUserId(reqUser, twitterId) {
  if (reqUser?.id) return reqUser.id;
  if (!twitterId) return null;
  try {
    const existing = await XHuntUser.findOne({
      where: { twitterId: String(twitterId).trim() },
      attributes: ["id"],
    });
    return existing ? existing.id : null;
  } catch {
    return null;
  }
}


// Redis 投票计数缓存 TTL（秒），与 getTopicVoteDistribution 回填逻辑保持一致
const HOT_VOTE_CACHE_TTL_SECONDS = 3600;

// 预设高辨识度多彩默认头像列表（8 种鲜艳主题色与极简剪影，零网络依赖且各不相同）
const ANONYMOUS_AVATARS = [
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%232563EB"/><circle cx="20" cy="15" r="6" fill="%23FFFFFF"/><path d="M10 32c0-5.5 4.5-9 10-9s10 3.5 10 9" fill="%23FFFFFF"/></svg>',
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23059669"/><circle cx="20" cy="15" r="6" fill="%23FFFFFF"/><path d="M10 32c0-5.5 4.5-9 10-9s10 3.5 10 9" fill="%23FFFFFF"/></svg>',
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%237C3AED"/><circle cx="20" cy="15" r="6" fill="%23FFFFFF"/><path d="M10 32c0-5.5 4.5-9 10-9s10 3.5 10 9" fill="%23FFFFFF"/></svg>',
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23D97706"/><circle cx="20" cy="15" r="6" fill="%23FFFFFF"/><path d="M10 32c0-5.5 4.5-9 10-9s10 3.5 10 9" fill="%23FFFFFF"/></svg>',
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23E11D48"/><circle cx="20" cy="15" r="6" fill="%23FFFFFF"/><path d="M10 32c0-5.5 4.5-9 10-9s10 3.5 10 9" fill="%23FFFFFF"/></svg>',
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%230891B2"/><circle cx="20" cy="15" r="6" fill="%23FFFFFF"/><path d="M10 32c0-5.5 4.5-9 10-9s10 3.5 10 9" fill="%23FFFFFF"/></svg>',
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23DB2777"/><circle cx="20" cy="15" r="6" fill="%23FFFFFF"/><path d="M10 32c0-5.5 4.5-9 10-9s10 3.5 10 9" fill="%23FFFFFF"/></svg>',
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%234F46E5"/><circle cx="20" cy="15" r="6" fill="%23FFFFFF"/><path d="M10 32c0-5.5 4.5-9 10-9s10 3.5 10 9" fill="%23FFFFFF"/></svg>',
];

/**
 * 根据种子稳定生成匿名默认头像，既避免头像千篇一律，又保证单条评论多次展示时头像一致
 */
function getAnonymousAvatar(seed) {
  if (!seed) return ANONYMOUS_AVATARS[0];
  let hash = 0;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % ANONYMOUS_AVATARS.length;
  return ANONYMOUS_AVATARS[index];
}

/**
 * Twitter Handle 隐私掩码：保留前后字符，中间加 ***
 */
function maskTwitterHandle(handle) {
  if (!handle) return "user***";
  const cleaned = String(handle).trim().replace(/^@/, "");
  if (!cleaned) return "user***";
  if (cleaned.length <= 1) return `${cleaned}***`;
  if (cleaned.length === 2) return `${cleaned[0]}***${cleaned[1]}`;
  if (cleaned.length <= 4) return `${cleaned[0]}***${cleaned.slice(-1)}`;
  return `${cleaned.slice(0, 2)}***${cleaned.slice(-2)}`;
}

/**
 * 格式化输出评论详情
 */
function formatCommentResponse(comment, isAnonymous, lang = "zh") {
  const isAnon = Boolean(isAnonymous !== undefined ? isAnonymous : comment.isAnonymous);
  return {
    id: comment.id,
    twitterId: isAnon ? "" : comment.twitterId,
    userName: isAnon ? maskTwitterHandle(comment.userName) : comment.userName,
    displayName: isAnon ? (lang === "en" ? "Anonymous User" : "匿名用户") : comment.displayName,
    userAvatar: isAnon ? getAnonymousAvatar(comment.id) : (comment.userAvatar || ""),
    content: comment.content,
    isAnonymous: isAnon,
    isSelf: true,
    createdAt: comment.createdAt,
  };
}

/**
 * 保存或修改用户在议题下的唯一留言观点
 * 业务规则：同一推特用户在同一议题下只能发言一次，第二次再发言为对第一次发言的修改更新
 */
async function saveOrUpdateUserComment({
  topicId,
  twitterId,
  content,
  isAnonymous = false,
  userInfo = {},
  effectiveUserId = null,
  redisClient = null,
}) {
  const isAnon = Boolean(isAnonymous);
  const now = new Date();

  // 查询当前用户在该议题下的所有留言记录（按 createdAt 降序取最新的一条）
  const existingComments = await XHuntHotVoteComment.findAll({
    where: {
      topicId,
      twitterId,
    },
    order: [["createdAt", "DESC"]],
  });

  let targetComment = null;

  if (existingComments && existingComments.length > 0) {
    targetComment = existingComments[0];
    targetComment.content = content;
    targetComment.isAnonymous = isAnon;
    targetComment.isDeleted = false;
    targetComment.createdAt = now;
    if (userInfo.userName) targetComment.userName = userInfo.userName;
    if (userInfo.displayName) targetComment.displayName = userInfo.displayName;
    if (userInfo.userAvatar) targetComment.userAvatar = userInfo.userAvatar;
    if (effectiveUserId && !targetComment.xHuntUserId) {
      targetComment.xHuntUserId = effectiveUserId;
    }
    await targetComment.save();

    // 历史脏数据自愈：若历史已存在多条留言记录，清理多余的旧记录，确保唯一
    if (existingComments.length > 1) {
      const extraIds = existingComments.slice(1).map((c) => c.id);
      await XHuntHotVoteComment.destroy({
        where: { id: { [Op.in]: extraIds } },
      }).catch((e) => {
        console.warn("[HotVote] 清理历史重复留言异常:", e.message);
      });
    }
  } else {
    try {
      targetComment = await XHuntHotVoteComment.create({
        topicId,
        twitterId,
        xHuntUserId: effectiveUserId || userInfo.effectiveUserId || null,
        userName: userInfo.userName || "",
        displayName: userInfo.displayName || null,
        userAvatar: userInfo.userAvatar || "",
        content,
        isAnonymous: isAnon,
        isDeleted: false,
      });
    } catch (err) {
      // 处理极端并发情况下的唯一索引冲突，回退为更新既有记录
      if (err.name === "SequelizeUniqueConstraintError" || err instanceof UniqueConstraintError) {
        targetComment = await XHuntHotVoteComment.findOne({
          where: { topicId, twitterId },
        });
        if (targetComment) {
          targetComment.content = content;
          targetComment.isAnonymous = isAnon;
          targetComment.isDeleted = false;
          targetComment.createdAt = now;
          if (userInfo.userName) targetComment.userName = userInfo.userName;
          if (userInfo.displayName) targetComment.displayName = userInfo.displayName;
          if (userInfo.userAvatar) targetComment.userAvatar = userInfo.userAvatar;
          if (effectiveUserId && !targetComment.xHuntUserId) {
            targetComment.xHuntUserId = effectiveUserId;
          }
          await targetComment.save();
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  if (redisClient) {
    await invalidateTopicCommentsCache(redisClient, topicId);
  }

  return targetComment;
}

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

/**
 * 安全解析多语言对象（兼容 JSONB 对象与 JSON 序列化字符串）
 */
function safeParseI18n(val) {
  if (!val) return null;
  if (typeof val === "object") return val;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_) {}
  }
  return null;
}

/**
 * 解析客户端请求语言（支持 ?lang=en, ?x-language=en, Header x-language: en, Header accept-language: en...）
 * 归一化为 "en" 或 "zh"
 */
function resolveRequestLang(req) {
  const candidate =
    req.query?.lang ||
    req.query?.["x-language"] ||
    req.headers?.["x-language"] ||
    req.headers?.["accept-language"];
  if (candidate && String(candidate).trim().toLowerCase().startsWith("en")) {
    return "en";
  }
  return "zh";
}

/**
 * 多语言文案选择：优先请求语言，其次中文，最后回退到兼容旧字段
 */
function pickI18nText(i18n, lang, fallback) {
  const obj = safeParseI18n(i18n);
  if (obj) {
    if (lang && obj[lang]) return obj[lang];
    if (obj.zh) return obj.zh;
  }
  return fallback || "";
}

function pickI18nHtml(i18n, lang, fallbackHtml, fallbackText) {
  const obj = safeParseI18n(i18n);
  if (obj) {
    if (lang === "en") {
      if (obj.enHtml) return obj.enHtml;
      if (obj.en) return obj.en;
    }
    if (obj.zhHtml) return obj.zhHtml;
    if (obj.zh) return obj.zh;
  }
  return fallbackHtml || fallbackText || "";
}

/**
 * 按请求语言本地化议题选项名称（name 为中文兼容值，nameI18n 为多语言内容）
 */
function localizeVoteOptions(optionsList, lang) {
  return optionsList.map((opt) => ({
    ...opt,
    name: pickI18nText(opt.nameI18n, lang, opt.name),
  }));
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
 * GET /api/xhunt/hot-vote/topics
 * 获取当前生效进行中的所有热点议题及用户个人投票状态（支持多个议题同时返回）
 */
router.get(
  ["/active", "/topics"],
  [
    authenticateTokenOptional,
    query("domain").optional().trim().isIn(["web3", "ai"]).withMessage("domain 必须是 web3 或 ai"),
    query("lang").optional().trim(),
    query("x-language").optional().trim(),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const domain = req.query.domain || null;
      const lang = resolveRequestLang(req);
      const rawTwitterId = req.headers["x-tw-id"] || req.user?.twitterId || null;
      const twitterId = rawTwitterId && /^\d{1,25}$/.test(String(rawTwitterId).trim())
        ? String(rawTwitterId).trim()
        : null;
      const requestHandle = req.headers["x-user-id"] || req.user?.username || null;

      const now = new Date();

      // 查询处于发布状态且匹配多语言/领域的进行中议题
      const where = {
        status: "published",
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
      };

      if (domain) {
        where.displayDomains = { [Op.contains]: [domain] };
      }

      const topics = await XHuntHotVoteTopic.findAll({
        where,
        order: [
          ["sortWeight", "DESC"],
          ["createdAt", "DESC"],
        ],
      });

      // 测试模式精准过滤：筛选出当前用户有权查看的所有生效议题
      const visibleTopics = [];
      for (const t of topics) {
        if (t.testingPhase) {
          const isTester = isHotVoteTester(t.testList, {
            username: requestHandle,
            twitterId,
          });
          if (!isTester) continue;
        }

        visibleTopics.push(t);
      }

      if (visibleTopics.length === 0) {
        const emptyResponse = {
          success: true,
          data: {
            topic: null,
            topics: [],
            userState: {
              hasVoted: false,
              votedOptionId: null,
              remainingRevotes: 2,
            },
            results: null,
          },
        };
        if (handleNegotiatedCache(req, res, emptyResponse, { isPrivate: true, maxAge: 0, staleWhileRevalidate: 300 })) {
          return;
        }
        return res.json(emptyResponse);
      }

      // 批量查询当前用户在所有进行中议题下的投票流水
      const visibleTopicIds = visibleTopics.map((t) => t.id);
      const userRecordsByTopicId = {};
      const userLastCommentByTopicId = {};
      if (twitterId) {
        const records = await XHuntHotVoteRecord.findAll({
          where: {
            topicId: { [Op.in]: visibleTopicIds },
            twitterId,
          },
        });
        for (const r of records) {
          userRecordsByTopicId[r.topicId] = r;
        }

        // 批量查询当前用户在各议题下的最新一条留言（用于前端改票时反显）
        const myComments = await XHuntHotVoteComment.findAll({
          where: {
            topicId: { [Op.in]: visibleTopicIds },
            twitterId,
            isDeleted: false,
          },
          order: [["createdAt", "DESC"]],
          attributes: ["topicId", "content"],
        });
        for (const c of myComments) {
          if (!userLastCommentByTopicId[c.topicId]) {
            userLastCommentByTopicId[c.topicId] = c.content;
          }
        }
      }

      // 并行聚合各议题的用户状态与票数分布
      const topicItems = await Promise.all(
        visibleTopics.map(async (t) => {
          const record = userRecordsByTopicId[t.id];
          const userState = record
            ? {
                hasVoted: true,
                votedOptionId: record.optionId,
                remainingRevotes: Math.max(0, t.maxRevotes - record.revoteCount),
                isAnonymous: Boolean(record.isAnonymous),
                lastComment: userLastCommentByTopicId[t.id] || null,
              }
            : {
                hasVoted: false,
                votedOptionId: null,
                remainingRevotes: t.maxRevotes,
              };

          let results = null;
          if (userState.hasVoted) {
            const optionsList = Array.isArray(t.options) ? t.options : [];
            results = await getTopicVoteDistribution(
              t.id,
              optionsList,
              req.redisClient
            );
          }

          const topicPayload = {
            id: t.id,
            title: pickI18nText(t.titleI18n, lang, t.title),
            titleHtml: pickI18nHtml(t.titleI18n, lang, t.titleHtml, t.title),
            summary: pickI18nText(t.summaryI18n, lang, t.summary),
            summaryHtml: pickI18nHtml(t.summaryI18n, lang, t.summaryHtml, t.summary),
            topicType: t.topicType,
            options: localizeVoteOptions(Array.isArray(t.options) ? t.options : [], lang),
            maxRevotes: t.maxRevotes,
          };

          return {
            topic: topicPayload,
            userState,
            results,
          };
        })
      );

      const primary = topicItems[0];
      const responseData = {
        success: true,
        data: {
          topic: primary.topic,
          userState: primary.userState,
          results: primary.results,
          topics: topicItems,
        },
      };

      if (handleNegotiatedCache(req, res, responseData, { isPrivate: true, maxAge: 0, staleWhileRevalidate: 300 })) {
        return;
      }

      return res.json(responseData);
    } catch (err) {
      console.error("[HotVote] GET /active error:", err);
      return res.status(500).json({ success: false, error: "获取热点投票失败" });
    }
  }
);

router.post(
  "/topics/:topicId/vote",
  [
    voteRateLimiter,
    authenticateTokenOptional,
    header("x-tw-id").trim().matches(/^\d{1,25}$/).withMessage("无效的 Twitter ID"),
    param("topicId").isUUID().withMessage("无效的议题ID"),
    body("optionId").trim().matches(/^[a-zA-Z0-9_-]{1,32}$/).withMessage("无效的选项ID"),
    body("isAnonymous").optional().isBoolean().toBoolean(),
    body("comment").optional().trim().isLength({ min: 1, max: 200 }),
    body("content").optional().trim().isLength({ min: 1, max: 200 }),
    body("commentContent").optional().trim().isLength({ min: 1, max: 200 }),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const { topicId } = req.params;
      const { optionId } = req.body;
      const isAnonymous = Boolean(req.body.isAnonymous);
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

      // 提取附带留言观点
      const rawComment = req.body.comment || req.body.content || req.body.commentContent;
      const cleanComment = rawComment ? sanitizePlainText(rawComment, 200).trim() : "";

      // 用户投票时若附带了留言，调用 AI 大模型进行安全审核（不能是反对政治、暴力、色情、辱骂或极端言论）
      if (cleanComment) {
        const audit = await auditCommentContentWithAI(cleanComment);
        if (!audit.passed) {
          return res.status(400).json({
            success: false,
            error: "COMMENT_CONTENT_VIOLATION",
            message: audit.reason || "留言内容未通过安全合规审核（涉政/暴力/色情/辱骂/极端言论或违规引流），请文明发言",
          });
        }
      }

      // 解析有效用户信息与客户端安全 IP (防溢出)
      const userInfo = await resolveVoterUserInfo(req, twitterId);
      const effectiveUserId = userInfo.effectiveUserId;
      const safeClientIp = req.ip ? String(req.ip).substring(0, 64) : null;

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
            xHuntUserId: effectiveUserId,
            optionId,
            revoteCount: 0,
            isAnonymous,
            clientIp: safeClientIp,
          },
          { transaction: t }
        );

        created = true;
      });

      if (!created) {
        return res.status(400).json({ success: false, error: "您已参与过该投票，请使用修改选择功能" });
      }

      // 若投票请求同时携带了留言观点，则写入或更新留言表（单人单议题唯一留言）
      if (cleanComment) {
        try {
          await saveOrUpdateUserComment({
            topicId,
            twitterId,
            content: cleanComment,
            isAnonymous,
            userInfo,
            effectiveUserId,
            redisClient: req.redisClient,
          });
        } catch (commentErr) {
          console.error(
            "[HotVote] 留言写入异常 (未阻塞主投票流水):",
            commentErr.name,
            commentErr.message,
            commentErr.parent?.detail || commentErr.original?.message || ""
          );
        }
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
            isAnonymous,
          },
          results,
        },
      });
    } catch (err) {
      // 并发下第二个请求撞 uk_hot_vote_topic_twitter_id 唯一索引时，返回友好错误而非 500
      if (err instanceof UniqueConstraintError || err.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({ success: false, error: "ALREADY_VOTED", message: "您已参与过该投票，请使用修改选择功能" });
      }
      console.error(
        "[HotVote] POST /vote error:",
        err.name,
        err.message,
        err.parent?.detail || err.original?.message || "",
        err.sql ? ("SQL: " + err.sql) : ""
      );
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
    body("isAnonymous").optional().isBoolean().toBoolean(),
    body("comment").optional().trim().isLength({ min: 1, max: 200 }),
    body("content").optional().trim().isLength({ min: 1, max: 200 }),
    body("commentContent").optional().trim().isLength({ min: 1, max: 200 }),
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

      // 提取附带改票留言观点
      const rawRevoteComment = req.body.comment || req.body.content || req.body.commentContent;
      const cleanRevoteComment = rawRevoteComment ? sanitizePlainText(rawRevoteComment, 200).trim() : "";

      // 用户改票时若附带了留言，调用 AI 大模型进行安全审核（不能是反对政治、暴力、色情、辱骂或极端言论）
      if (cleanRevoteComment) {
        const audit = await auditCommentContentWithAI(cleanRevoteComment);
        if (!audit.passed) {
          return res.status(400).json({
            success: false,
            error: "COMMENT_CONTENT_VIOLATION",
            message: audit.reason || "留言内容未通过安全合规审核（涉政/暴力/色情/辱骂/极端言论或违规引流），请文明发言",
          });
        }
      }

      // 解析有效用户信息
      const userInfo = await resolveVoterUserInfo(req, twitterId);
      const effectiveUserId = userInfo.effectiveUserId;

      let oldOptionId = null;
      let newRevoteCount = 0;
      let isRecordAnonymous = false;

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
        if (req.body.isAnonymous !== undefined) {
          record.isAnonymous = Boolean(req.body.isAnonymous);
        }
        if (effectiveUserId && !record.xHuntUserId) {
          record.xHuntUserId = effectiveUserId;
        }

        await record.save({ transaction: t });
        newRevoteCount = record.revoteCount;
        isRecordAnonymous = Boolean(record.isAnonymous);
      });

      // 若改票时同时附带了留言观点，则更新（或写入）留言表（单人单议题唯一留言，再次发言为修改）
      if (cleanRevoteComment) {
        try {
          await saveOrUpdateUserComment({
            topicId,
            twitterId,
            content: cleanRevoteComment,
            isAnonymous: isRecordAnonymous,
            userInfo,
            effectiveUserId,
            redisClient: req.redisClient,
          });
        } catch (commentErr) {
          console.error(
            "[HotVote] 改票附带留言写入/更新异常 (未阻塞主改票流水):",
            commentErr.name,
            commentErr.message,
            commentErr.parent?.detail || commentErr.original?.message || ""
          );
        }
      } else if (req.body.isAnonymous !== undefined) {
        // 未改发言仅切换匿名状态时，同步更新既有留言的匿名状态
        try {
          const existingComment = await XHuntHotVoteComment.findOne({
            where: { topicId, twitterId, isDeleted: false },
          });
          if (existingComment && Boolean(existingComment.isAnonymous) !== isRecordAnonymous) {
            existingComment.isAnonymous = isRecordAnonymous;
            await existingComment.save();
            await invalidateTopicCommentsCache(req.redisClient, topicId);
          }
        } catch (anonSyncErr) {
          console.warn("[HotVote] 改票同步留言匿名状态异常:", anonSyncErr.message);
        }
      }

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
            isAnonymous: isRecordAnonymous,
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
      console.error(
        "[HotVote] PUT /vote error:",
        err.name,
        err.message,
        err.parent?.detail || err.original?.message || "",
        err.sql ? ("SQL: " + err.sql) : ""
      );
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
    authenticateTokenOptional,
    param("topicId").isUUID().withMessage("无效的议题ID"),
    query("page").optional().isInt({ min: 1, max: 1000 }).toInt(),
    query("pageSize").optional().isInt({ min: 1, max: 20 }).toInt(),
    query("lang").optional().trim(),
    query("x-language").optional().trim(),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const { topicId } = req.params;
      const lang = resolveRequestLang(req);
      const page = req.query.page || 1;
      const pageSize = req.query.pageSize || 3;
      const offset = (page - 1) * pageSize;
      const rawTwitterId = req.headers["x-tw-id"] || req.user?.twitterId || null;
      const currentTwitterId = rawTwitterId ? String(rawTwitterId).trim() : null;

      const { count, rows } = await getCachedTopicCommentsPage(
        req.redisClient,
        topicId,
        page,
        pageSize,
        async () => {
          let count = 0;
          let rawRows = [];

          if (XHuntHotVoteComment.sequelize?.getDialect?.() === "postgres") {
            const countResult = await XHuntHotVoteComment.sequelize.query(
              `SELECT COUNT(DISTINCT "twitterId")::int AS total
               FROM "XHuntHotVoteComments"
               WHERE "topicId" = :topicId AND "isDeleted" = false`,
              {
                replacements: { topicId },
                type: QueryTypes.SELECT,
              }
            );
            count = Number(countResult[0]?.total || 0);

            rawRows = await XHuntHotVoteComment.sequelize.query(
              `SELECT *
               FROM (
                 SELECT DISTINCT ON ("twitterId")
                   id,
                   "twitterId",
                   "userName",
                   "displayName",
                   "userAvatar",
                   content,
                   "isAnonymous",
                   "createdAt"
                 FROM "XHuntHotVoteComments"
                 WHERE "topicId" = :topicId AND "isDeleted" = false
                 ORDER BY "twitterId", "createdAt" DESC, id DESC
               ) sub
               ORDER BY "createdAt" DESC
               LIMIT :limit OFFSET :offset`,
              {
                replacements: { topicId, limit: pageSize, offset },
                type: QueryTypes.SELECT,
              }
            );
          } else {
            const allComments = await XHuntHotVoteComment.findAll({
              where: {
                topicId,
                isDeleted: false,
              },
              order: [["createdAt", "DESC"], ["id", "DESC"]],
              attributes: [
                "id",
                "twitterId",
                "userName",
                "displayName",
                "userAvatar",
                "content",
                "isAnonymous",
                "createdAt",
              ],
            });

            const uniqueMap = new Map();
            for (const c of allComments) {
              const item = typeof c.toJSON === "function" ? c.toJSON() : c;
              if (item.twitterId && !uniqueMap.has(item.twitterId)) {
                uniqueMap.set(item.twitterId, item);
              }
            }
            const uniqueList = Array.from(uniqueMap.values());
            count = uniqueList.length;
            rawRows = uniqueList.slice(offset, offset + pageSize);
          }

          // 补全非匿名留言中缺失的头像（调用 Twitter ID 接口，报错使用默认头像）
          const missingTwIds = rawRows
            .filter((r) => !r.isAnonymous && !r.userAvatar && r.twitterId)
            .map((r) => r.twitterId);

          if (missingTwIds.length > 0) {
            const uniqueTwIds = Array.from(new Set(missingTwIds));
            await Promise.all(
              uniqueTwIds.map(async (twId) => {
                const profile = await fetchTwitterProfileSafe(twId, req.redisClient);
                const avatar = profile?.avatar || getAnonymousAvatar(twId);
                const name = profile?.displayName || null;
                for (const r of rawRows) {
                  if (r.twitterId === twId && !r.isAnonymous) {
                    if (!r.userAvatar) {
                      r.userAvatar = avatar;
                      // 异步自愈数据库历史数据
                      XHuntHotVoteComment.update(
                        { userAvatar: avatar },
                        { where: { id: r.id } }
                      ).catch(() => {});
                    }
                    if ((!r.displayName || r.displayName === "Anonymous") && name) {
                      r.displayName = name;
                    }
                  }
                }
              })
            );
          }

          return {
            count: res.count,
            rows: rawRows,
          };
        }
      );

      const seenTwitterIds = new Set();
      const list = [];
      for (const c of rows) {
        if (c.twitterId && seenTwitterIds.has(c.twitterId)) {
          continue;
        }
        if (c.twitterId) {
          seenTwitterIds.add(c.twitterId);
        }
        const isSelf = Boolean(currentTwitterId && c.twitterId === currentTwitterId);
        if (c.isAnonymous) {
          list.push({
            id: c.id,
            twitterId: "",
            userName: maskTwitterHandle(c.userName),
            displayName: lang === "en" ? "Anonymous User" : "匿名用户",
            userAvatar: getAnonymousAvatar(c.id),
            content: c.content,
            isAnonymous: true,
            isSelf,
            createdAt: c.createdAt,
          });
        } else {
          list.push({
            id: c.id,
            twitterId: c.twitterId,
            userName: c.userName,
            displayName: c.displayName,
            userAvatar: c.userAvatar || "", // 真实头像；若无头像则留空，绝不替换为匿名彩色剪影！
            content: c.content,
            isAnonymous: false,
            isSelf,
            createdAt: c.createdAt,
          });
        }
      }

      const responseData = {
        success: true,
        data: {
          list,
          pagination: {
            page,
            pageSize,
            total: count,
            totalPages: Math.ceil(count / pageSize),
          },
        },
      };

      if (
        handleNegotiatedCache(req, res, responseData, {
          isPrivate: true,
          maxAge: 0, // 个性化 isSelf 字段采用 private 协商缓存，防止公有共享缓存跨用户污染
          staleWhileRevalidate: 300, // 5分钟容灾/后台静默刷新
        })
      ) {
        return;
      }

      return res.json(responseData);
    } catch (err) {
      console.error("[HotVote] GET /comments error:", err);
      return res.status(500).json({ success: false, error: "获取留言失败" });
    }
  }
);

/**
 * POST /api/xhunt/hot-vote/topics/:topicId/comments
 * 发表留言（支持登录与免登录推特用户）
 */
router.post(
  "/topics/:topicId/comments",
  [
    authenticateTokenOptional,
    header("x-tw-id").trim().matches(/^\d{1,25}$/).withMessage("无效的 Twitter ID"),
    param("topicId").isUUID().withMessage("无效的议题ID"),
    body("content")
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage("留言字数需在 1 ~ 200 字之间"),
    body("isAnonymous").optional().isBoolean().toBoolean(),
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

      const twitterId = req.headers["x-tw-id"].trim();
      const rawHandle = req.headers["x-user-id"] || req.user?.username || null;
      const requestHandle = rawHandle
        ? String(rawHandle).replace(/^@/, "").trim().substring(0, 50)
        : null;

      // 若携带 Token 登录态，校验一致性防伪造
      if (req.user?.twitterId && req.user.twitterId !== twitterId) {
        return res.status(403).json({ success: false, error: "TWITTER_ID_MISMATCH" });
      }

      // 测试阶段鉴权
      if (topic.testingPhase) {
        const isTester = isHotVoteTester(topic.testList, {
          username: requestHandle || req.user?.username,
          twitterId,
        });
        if (!isTester) {
          return res.status(403).json({ success: false, error: "该议题当前仅内测人员可见" });
        }
      }

      // 1. 查询该用户在该议题下是否已有留言记录（不限 isDeleted，确保能复用被软删除的记录或避免唯一索引冲突）
      const existingComment = await XHuntHotVoteComment.findOne({
        where: {
          topicId,
          twitterId,
        },
        order: [["createdAt", "DESC"]],
      });

      const isAnonymous = Boolean(req.body.isAnonymous);
      const lang = resolveRequestLang(req);
      const isContentSame = existingComment && existingComment.content === cleanContent;
      const isAnonSame = existingComment && Boolean(existingComment.isAnonymous) === isAnonymous;

      // 若未被删除且内容与匿名状态均未变更，无需重复更新或重新审核
      if (existingComment && !existingComment.isDeleted && isContentSame && isAnonSame) {
        return res.status(400).json({
          success: false,
          error: "COMMENT_UNCHANGED",
          message: "留言内容未发生变更",
        });
      }

      // 若未被删除且仅变更匿名状态（内容未变），直接更新匿名属性，无需重复调用 AI 审核
      if (existingComment && !existingComment.isDeleted && isContentSame && !isAnonSame) {
        existingComment.isAnonymous = isAnonymous;
        await existingComment.save();
        await invalidateTopicCommentsCache(req.redisClient, topicId);
        return res.json({
          success: true,
          data: formatCommentResponse(existingComment, isAnonymous, lang),
        });
      }

      // 防灌水限频：同一推特ID 30秒内只能发一条留言（或修改一次留言）
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

      // AI 大模型安全审核（包含内置敏感词与钓鱼预检）
      const audit = await auditCommentContentWithAI(cleanContent);
      if (!audit.passed) {
        return res.status(400).json({
          success: false,
          error: "COMMENT_CONTENT_VIOLATION",
          message: audit.reason || "留言内容未通过安全合规审核（涉政/暴力/色情/辱骂/极端言论或违规引流），请文明发言",
        });
      }

      const userInfo = await resolveVoterUserInfo(req, twitterId);

      const targetComment = await saveOrUpdateUserComment({
        topicId,
        twitterId,
        content: cleanContent,
        isAnonymous,
        userInfo,
        effectiveUserId: userInfo.effectiveUserId,
        redisClient: req.redisClient,
      });

      return res.json({
        success: true,
        data: formatCommentResponse(targetComment, isAnonymous, lang),
      });
    } catch (err) {
      console.error(
        "[HotVote] POST /comments error:",
        err.name,
        err.message,
        err.parent?.detail || err.original?.message || "",
        err.sql ? ("SQL: " + err.sql) : ""
      );
      return res.status(500).json({ success: false, error: "留言发布失败，请重试" });
    }
  }
);

router.saveOrUpdateUserComment = saveOrUpdateUserComment;
router.formatCommentResponse = formatCommentResponse;

module.exports = router;
