const express = require("express");
const { body, param, query } = require("express-validator");
const { fn, col, Op, QueryTypes } = require("sequelize");
const { validateRequest } = require("../middleware/validate-request");
const { requireRole } = require("../../admin/middleware/adminAuth");
const {
  XHuntHotVoteTopic,
  XHuntHotVoteRecord,
  XHuntHotVoteComment,
  XhuntVipTestUser,
  XhuntAdminAuditLog,
} = require("../../models/postgres-start");
const {
  sanitizeVoteTitleHtml,
  sanitizePlainText,
  sanitizeCommentPlainText,
  sanitizeSafeUrl,
} = require("../services/inputValidator");
const {
  handleNegotiatedCache,
  invalidateTopicsCache,
  invalidateTopicVotesCache,
  invalidateTopicCommentsCache,
} = require("../utils/hot-vote-cache");
const { queryTwitterProfile } = require("./stats-routes/twitter-id-handler-lookup");

const router = express.Router();

/**
 * 根据 Twitter ID 调取推特用户公开档案（复用管理后台 /xhunt/stats#/twitter-id-handler 的接口服务）
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
    console.warn(`[HotVoteAdmin] 查询 Twitter 用户资料失败 (twitterId=${cleanTwId}):`, err.message);
  }

  return null;
}

const OPTION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;

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
 * 清洗选项数组；自动补默认"吃个瓜"选项。
 * 选项 id 不符合字符集要求时返回 null
 * name 为中文名（兼容旧字段），nameEn 可选，二者合并为 nameI18n 供多语言展示
 */
function buildCleanOptions(options) {
  let hasGua = false;
  const cleanOptions = options.map((opt, idx) => {
    const name = sanitizePlainText(opt.name || "", 30);
    const nameEn = opt.nameEn
      ? sanitizePlainText(opt.nameEn, 60)
      : (opt.nameI18n?.en ? sanitizePlainText(opt.nameI18n.en, 60) : "");
    const isThisGua = !!opt.isGua && !hasGua;
    if (isThisGua) hasGua = true;
    return {
      id: String(opt.id || `opt_${idx + 1}`).trim().substring(0, 32),
      name,
      nameI18n: nameEn ? { zh: name, en: nameEn } : { zh: name },
      avatar: isThisGua ? "" : opt.avatar ? sanitizeSafeUrl(opt.avatar, 512) : "",
      twitterHandle: isThisGua ? "" : opt.twitterHandle ? sanitizePlainText(opt.twitterHandle, 50).replace(/^@/, "") : "",
      color: opt.color ? sanitizePlainText(opt.color, 20) : "",
      isGua: isThisGua,
    };
  });

  if (cleanOptions.some((o) => !OPTION_ID_PATTERN.test(o.id))) {
    return null;
  }

  // 检查选项 ID 是否存在重复
  const idSet = new Set(cleanOptions.map((o) => o.id));
  if (idSet.size !== cleanOptions.length) {
    return null;
  }

  return cleanOptions;
}

/**
 * 组装多语言字段：zh 必填（同时写入兼容旧字段），en 为空时省略
 */
function buildI18nField(zhValue, enValue) {
  const i18n = { zh: zhValue };
  if (enValue) i18n.en = enValue;
  return i18n;
}

/**
 * 更新场景下合并多语言字段：基于已有 i18n，应用新的 zh / en 值（en 传空字符串表示清除英文文案）
 */
function mergeI18nField(existingI18n, zhValue, enValue) {
  const i18n = { ...(existingI18n || {}) };
  if (zhValue !== undefined) i18n.zh = zhValue;
  if (enValue !== undefined) {
    if (enValue) i18n.en = enValue;
    else delete i18n.en;
  }
  return i18n;
}

function extractPlainTextFromHtml(html, maxLength = 100) {
  if (!html) return "";
  const text = String(html)
    .replace(/<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi, "[$1]")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
  return sanitizePlainText(text, maxLength);
}

async function recordAdminAudit(req, action, targetId, details = null) {
  try {
    if (XhuntAdminAuditLog && req.adminUser) {
      await XhuntAdminAuditLog.create({
        adminId: req.adminUser.id,
        email: req.adminUser.email,
        action,
        route: req.originalUrl || req.path || "",
        method: req.method || "",
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        payload: details ? JSON.stringify(details) : null,
        success: true,
      });
    }
  } catch (e) {
    console.warn("[HotVoteAdmin] Audit log error:", e.message);
  }
}

/**
 * GET /internal-testers
 * 获取可选的内测人员预设名单
 */
router.get("/internal-testers", async (req, res) => {
  try {
    const list = await XhuntVipTestUser.findAll({
      where: { listType: "internal_test" },
      attributes: ["id", "username", "twitterId"],
      order: [["username", "ASC"]],
    });
    const responseData = { success: true, data: list };
    if (handleNegotiatedCache(req, res, responseData, { isPrivate: true, maxAge: 300, staleWhileRevalidate: 600 })) {
      return;
    }
    return res.json(responseData);
  } catch (err) {
    console.error("[HotVoteAdmin] GET /internal-testers error:", err);
    return res.status(500).json({ success: false, error: "获取内测名单失败" });
  }
});

/**
 * GET /topics
 * 运营后台获取议题列表
 */
router.get(
  "/topics",
  [
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("pageSize").optional().isInt({ min: 1, max: 100 }).toInt(),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const page = req.query.page || 1;
      const pageSize = req.query.pageSize || 20;
      const offset = (page - 1) * pageSize;
      const where = {};

      if (req.query.status) {
        where.status = req.query.status;
      }
      if (req.query.testingPhase !== undefined) {
        where.testingPhase = req.query.testingPhase === "true" || req.query.testingPhase === true;
      }

      const { count, rows } = await XHuntHotVoteTopic.findAndCountAll({
        where,
        order: [
          ["sortWeight", "DESC"],
          ["createdAt", "DESC"],
        ],
        limit: pageSize,
        offset,
      });

      const topicIds = rows.map((r) => r.id);
      const voteCounts = topicIds.length > 0
        ? await XHuntHotVoteRecord.findAll({
            where: { topicId: { [Op.in]: topicIds } },
            attributes: ["topicId", [fn("COUNT", col("id")), "count"]],
            group: ["topicId"],
            raw: true,
          })
        : [];

      const voteCountMap = {};
      for (const vc of voteCounts) {
        voteCountMap[vc.topicId] = parseInt(vc.count || "0", 10);
      }

      const list = rows.map((topic) => {
        const json = topic.toJSON();
        const voteCount = voteCountMap[topic.id] || 0;
        return {
          ...json,
          voteCount,
          hasVotes: voteCount > 0,
        };
      });

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

      if (handleNegotiatedCache(req, res, responseData, { isPrivate: true, maxAge: 0, staleWhileRevalidate: 300 })) {
        return;
      }

      return res.json(responseData);
    } catch (err) {
      console.error("[HotVoteAdmin] GET /topics error:", err);
      return res.status(500).json({ success: false, error: "获取议题列表失败" });
    }
  }
);

/**
 * GET /topics/:id
 * 获取议题详情
 */
router.get(
  "/topics/:id",
  [param("id").isUUID().withMessage("无效的议题ID"), validateRequest],
  async (req, res) => {
    try {
      const topic = await XHuntHotVoteTopic.findByPk(req.params.id);
      if (!topic) {
        return res.status(404).json({ success: false, error: "议题不存在" });
      }
      const voteCount = await XHuntHotVoteRecord.count({ where: { topicId: topic.id } });
      const responseData = {
        success: true,
        data: {
          ...topic.toJSON(),
          voteCount,
          hasVotes: voteCount > 0,
        },
      };

      if (handleNegotiatedCache(req, res, responseData, { isPrivate: true, maxAge: 0, staleWhileRevalidate: 300 })) {
        return;
      }

      return res.json(responseData);
    } catch (err) {
      console.error("[HotVoteAdmin] GET /topics/:id error:", err);
      return res.status(500).json({ success: false, error: "获取议题详情失败" });
    }
  }
);

/**
 * POST /topics
 * 创建新热点议题
 */
router.post(
  "/topics",
  [
    body("title").optional().trim().isLength({ min: 1, max: 100 }),
    body("titleEn").optional().trim().isLength({ max: 100 }),
    body("titleHtml").optional().trim().isLength({ max: 5000 }),
    body("titleHtmlEn").optional().trim().isLength({ max: 5000 }),
    body("summary").optional().trim().isLength({ min: 1, max: 100 }),
    body("summaryEn").optional().trim().isLength({ max: 100 }),
    body("summaryHtml").optional().trim().isLength({ max: 5000 }),
    body("summaryHtmlEn").optional().trim().isLength({ max: 5000 }),
    body("topicType").isIn(["person_pk", "general_topic"]).withMessage("议题形式不合法"),
    body("options").isArray({ min: 2, max: 6 }).withMessage("选项数量必须在 2 ~ 6 个之间"),
    body("displayDomains").isArray({ min: 1 }).withMessage("展示领域必须至少选一项"),
    body("displayLanguages").isArray({ min: 1 }).withMessage("展示语言必须至少选一项"),
    body("maxRevotes").optional().isInt({ min: 0, max: 10 }).toInt(),
    body("testingPhase").optional().isBoolean().toBoolean(),
    body("testList").optional().isArray(),
    body("status").optional().isIn(["draft", "published", "ended", "archived"]),
    body("sortWeight").optional().isInt().toInt(),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const {
        title,
        titleEn,
        titleHtml,
        titleHtmlEn,
        summary,
        summaryEn,
        summaryHtml,
        summaryHtmlEn,
        topicType,
        options,
        displayDomains,
        displayLanguages,
        maxRevotes = 2,
        testingPhase = true,
        testList = [],
        status = "draft",
        sortWeight = 0,
        startTime,
        endTime,
      } = req.body;

      // XSS 安全清洗与纯文本提炼
      const cleanTitleHtml = titleHtml ? sanitizeVoteTitleHtml(titleHtml, 5000) : "";
      const cleanTitleHtmlEn = titleHtmlEn ? sanitizeVoteTitleHtml(titleHtmlEn, 5000) : "";
      const cleanTitle = (title ? sanitizePlainText(title, 100) : "") || extractPlainTextFromHtml(cleanTitleHtml, 100);
      const cleanTitleEn = (titleEn ? sanitizePlainText(titleEn, 100) : "") || extractPlainTextFromHtml(cleanTitleHtmlEn, 100);

      if (!cleanTitle && !cleanTitleHtml) {
        return res.status(400).json({ success: false, error: "议题标题不能为空" });
      }

      const cleanSummaryHtml = summaryHtml ? sanitizeVoteTitleHtml(summaryHtml, 5000) : "";
      const cleanSummaryHtmlEn = summaryHtmlEn ? sanitizeVoteTitleHtml(summaryHtmlEn, 5000) : "";
      const cleanSummary = (summary ? sanitizePlainText(summary, 100) : "") || extractPlainTextFromHtml(cleanSummaryHtml, 100);
      const cleanSummaryEn = (summaryEn ? sanitizePlainText(summaryEn, 100) : "") || extractPlainTextFromHtml(cleanSummaryHtmlEn, 100);

      if (!cleanSummary && !cleanSummaryHtml) {
        return res.status(400).json({ success: false, error: "核心冲突介绍不能为空" });
      }

      // 清洗选项（含 id 字符集校验与自动补吃瓜选项）
      const cleanOptions = buildCleanOptions(options);
      if (!cleanOptions) {
        return res.status(400).json({ success: false, error: "选项ID不合法或存在重复ID（仅支持字母、数字、下划线、中划线，1-32字符）" });
      }

      const cleanTestList = Array.isArray(testList)
        ? testList.map((item) => sanitizePlainText(String(item || "").trim().toLowerCase().replace(/^@/, ""), 50)).filter(Boolean)
        : [];

      const titleI18n = { zh: cleanTitle };
      if (cleanTitleEn) titleI18n.en = cleanTitleEn;
      if (cleanTitleHtml) titleI18n.zhHtml = cleanTitleHtml;
      if (cleanTitleHtmlEn) titleI18n.enHtml = cleanTitleHtmlEn;

      const summaryI18n = { zh: cleanSummary };
      if (cleanSummaryEn) summaryI18n.en = cleanSummaryEn;
      if (cleanSummaryHtml) summaryI18n.zhHtml = cleanSummaryHtml;
      if (cleanSummaryHtmlEn) summaryI18n.enHtml = cleanSummaryHtmlEn;

      const topic = await XHuntHotVoteTopic.create({
        title: cleanTitle,
        titleI18n,
        titleHtml: cleanTitleHtml || null,
        summary: cleanSummary,
        summaryI18n,
        summaryHtml: cleanSummaryHtml || null,
        topicType,
        options: cleanOptions,
        displayDomains,
        displayLanguages,
        maxRevotes,
        testingPhase,
        testList: cleanTestList,
        status,
        sortWeight,
        startTime: startTime ? new Date(startTime) : null,
        endTime: endTime ? new Date(endTime) : null,
      });

      await recordAdminAudit(req, "CREATE_HOT_VOTE_TOPIC", topic.id, { title: cleanTitle });
      await invalidateTopicsCache(req.redisClient, topic.id);

      return res.json({
        success: true,
        data: {
          ...topic.toJSON(),
          voteCount: 0,
          hasVotes: false,
        },
      });
    } catch (err) {
      console.error("[HotVoteAdmin] POST /topics error:", err);
      return res.status(500).json({ success: false, error: "创建议题失败" });
    }
  }
);

/**
 * PUT /topics/:id
 * 更新议题
 */
router.put(
  "/topics/:id",
  [
    param("id").isUUID().withMessage("无效的议题ID"),
    body("title").optional().trim().isLength({ min: 1, max: 100 }),
    body("titleEn").optional().trim().isLength({ max: 100 }),
    body("titleHtml").optional().trim().isLength({ max: 5000 }),
    body("titleHtmlEn").optional().trim().isLength({ max: 5000 }),
    body("summary").optional().trim().isLength({ min: 1, max: 100 }),
    body("summaryEn").optional().trim().isLength({ max: 100 }),
    body("summaryHtml").optional().trim().isLength({ max: 5000 }),
    body("summaryHtmlEn").optional().trim().isLength({ max: 5000 }),
    body("topicType").optional().isIn(["person_pk", "general_topic"]),
    body("options").optional().isArray({ min: 2, max: 6 }),
    body("displayDomains").optional().isArray({ min: 1 }),
    body("displayLanguages").optional().isArray({ min: 1 }),
    body("maxRevotes").optional().isInt({ min: 0, max: 10 }).toInt(),
    body("testingPhase").optional().isBoolean().toBoolean(),
    body("testList").optional().isArray(),
    body("status").optional().isIn(["draft", "published", "ended", "archived"]),
    body("sortWeight").optional().isInt().toInt(),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const topic = await XHuntHotVoteTopic.findByPk(req.params.id);
      if (!topic) {
        return res.status(404).json({ success: false, error: "议题不存在" });
      }

      const updates = {};
      if (
        req.body.title !== undefined ||
        req.body.titleEn !== undefined ||
        req.body.titleHtml !== undefined ||
        req.body.titleHtmlEn !== undefined
      ) {
        const currentTitleI18n = safeParseI18n(topic.titleI18n) || {};
        const cleanTitleHtml = req.body.titleHtml !== undefined
          ? (req.body.titleHtml ? sanitizeVoteTitleHtml(req.body.titleHtml, 5000) : "")
          : (currentTitleI18n.zhHtml || topic.titleHtml || "");
        const cleanTitleHtmlEn = req.body.titleHtmlEn !== undefined
          ? (req.body.titleHtmlEn ? sanitizeVoteTitleHtml(req.body.titleHtmlEn, 5000) : "")
          : (currentTitleI18n.enHtml || "");

        const cleanTitle = req.body.title !== undefined
          ? sanitizePlainText(req.body.title, 100)
          : (cleanTitleHtml ? extractPlainTextFromHtml(cleanTitleHtml, 100) : topic.title);
        const cleanTitleEn = req.body.titleEn !== undefined
          ? sanitizePlainText(req.body.titleEn, 100)
          : (cleanTitleHtmlEn ? extractPlainTextFromHtml(cleanTitleHtmlEn, 100) : (currentTitleI18n.en || ""));

        if (cleanTitle) updates.title = cleanTitle;
        updates.titleHtml = cleanTitleHtml || null;

        const nextTitleI18n = { ...(currentTitleI18n || {}) };
        if (cleanTitle) nextTitleI18n.zh = cleanTitle;
        if (cleanTitleEn) nextTitleI18n.en = cleanTitleEn;
        else if (req.body.titleEn === "" || req.body.titleHtmlEn === "") delete nextTitleI18n.en;

        if (cleanTitleHtml) nextTitleI18n.zhHtml = cleanTitleHtml;
        else if (req.body.titleHtml === "") delete nextTitleI18n.zhHtml;

        if (cleanTitleHtmlEn) nextTitleI18n.enHtml = cleanTitleHtmlEn;
        else if (req.body.titleHtmlEn === "") delete nextTitleI18n.enHtml;

        updates.titleI18n = nextTitleI18n;
      }

      if (
        req.body.summary !== undefined ||
        req.body.summaryEn !== undefined ||
        req.body.summaryHtml !== undefined ||
        req.body.summaryHtmlEn !== undefined
      ) {
        const currentSummaryI18n = safeParseI18n(topic.summaryI18n) || {};
        const cleanSummaryHtml = req.body.summaryHtml !== undefined
          ? (req.body.summaryHtml ? sanitizeVoteTitleHtml(req.body.summaryHtml, 5000) : "")
          : (currentSummaryI18n.zhHtml || topic.summaryHtml || "");
        const cleanSummaryHtmlEn = req.body.summaryHtmlEn !== undefined
          ? (req.body.summaryHtmlEn ? sanitizeVoteTitleHtml(req.body.summaryHtmlEn, 5000) : "")
          : (currentSummaryI18n.enHtml || "");

        const cleanSummary = req.body.summary !== undefined
          ? sanitizePlainText(req.body.summary, 100)
          : (cleanSummaryHtml ? extractPlainTextFromHtml(cleanSummaryHtml, 100) : topic.summary);
        const cleanSummaryEn = req.body.summaryEn !== undefined
          ? sanitizePlainText(req.body.summaryEn, 100)
          : (cleanSummaryHtmlEn ? extractPlainTextFromHtml(cleanSummaryHtmlEn, 100) : (currentSummaryI18n.en || ""));

        if (cleanSummary) updates.summary = cleanSummary;
        updates.summaryHtml = cleanSummaryHtml || null;

        const nextSummaryI18n = { ...(currentSummaryI18n || {}) };
        if (cleanSummary) nextSummaryI18n.zh = cleanSummary;
        if (cleanSummaryEn) nextSummaryI18n.en = cleanSummaryEn;
        else if (req.body.summaryEn === "" || req.body.summaryHtmlEn === "") delete nextSummaryI18n.en;

        if (cleanSummaryHtml) nextSummaryI18n.zhHtml = cleanSummaryHtml;
        else if (req.body.summaryHtml === "") delete nextSummaryI18n.zhHtml;

        if (cleanSummaryHtmlEn) nextSummaryI18n.enHtml = cleanSummaryHtmlEn;
        else if (req.body.summaryHtmlEn === "") delete nextSummaryI18n.enHtml;

        updates.summaryI18n = nextSummaryI18n;
      }
      if (req.body.topicType !== undefined) updates.topicType = req.body.topicType;
      if (req.body.options !== undefined) {
        const cleanOptions = buildCleanOptions(req.body.options);
        if (!cleanOptions) {
          return res.status(400).json({ success: false, error: "选项ID不合法或存在重复ID（仅支持字母、数字、下划线、中划线，1-32字符）" });
        }

        // 校验投票数据：若该议题已有投票，不允许删除已有选项，但允许修改和新增
        const isSuperAdmin = req.adminUser?.role === "super";
        const totalVotes = await XHuntHotVoteRecord.count({
          where: { topicId: topic.id },
        });
        const originalOptions = Array.isArray(topic.options) ? topic.options : [];
        const newOptionIds = new Set(cleanOptions.map((o) => o.id));
        const deletedOptionIds = originalOptions
          .map((o) => o.id)
          .filter((id) => !newOptionIds.has(id));

        if (totalVotes > 0 && deletedOptionIds.length > 0) {
          if (!isSuperAdmin) {
            const missingOption = originalOptions.find((o) => deletedOptionIds.includes(o.id));
            return res.status(403).json({
              success: false,
              error: `该议题已有用户参与投票（共 ${totalVotes} 票），仅超级管理员可删除已有选项 "${missingOption?.name || missingOption?.id || deletedOptionIds[0]}"`,
            });
          }

          // 超级管理员删除选项：清理被删除选项的投票记录并重置历史引用
          await XHuntHotVoteRecord.destroy({
            where: {
              topicId: topic.id,
              optionId: { [Op.in]: deletedOptionIds },
            },
          });
          await XHuntHotVoteRecord.update(
            { previousOptionId: null },
            {
              where: {
                topicId: topic.id,
                previousOptionId: { [Op.in]: deletedOptionIds },
              },
            }
          );
          await invalidateTopicVotesCache(req.redisClient, topic.id);
        }

        if (totalVotes > 0) {
          const existingVoteOptions = await XHuntHotVoteRecord.findAll({
            where: { topicId: topic.id },
            attributes: ["optionId"],
            group: ["optionId"],
            raw: true,
          });
          const orphanedOptionIds = existingVoteOptions
            .map((v) => v.optionId)
            .filter((id) => !newOptionIds.has(id));
          if (orphanedOptionIds.length > 0) {
            if (!isSuperAdmin) {
              return res.status(403).json({
                success: false,
                error: `选项 "${orphanedOptionIds[0]}" 已有历史投票记录，仅超级管理员可删除`,
              });
            }
            await XHuntHotVoteRecord.destroy({
              where: {
                topicId: topic.id,
                optionId: { [Op.in]: orphanedOptionIds },
              },
            });
            await XHuntHotVoteRecord.update(
              { previousOptionId: null },
              {
                where: {
                  topicId: topic.id,
                  previousOptionId: { [Op.in]: orphanedOptionIds },
                },
              }
            );
            await invalidateTopicVotesCache(req.redisClient, topic.id);
          }
        }

        updates.options = cleanOptions;
      }
      if (req.body.displayDomains !== undefined) updates.displayDomains = req.body.displayDomains;
      if (req.body.displayLanguages !== undefined) updates.displayLanguages = req.body.displayLanguages;
      if (req.body.maxRevotes !== undefined) updates.maxRevotes = req.body.maxRevotes;
      if (req.body.testingPhase !== undefined) updates.testingPhase = req.body.testingPhase;
      if (req.body.testList !== undefined) {
        updates.testList = req.body.testList.map((item) => sanitizePlainText(String(item || "").trim().toLowerCase().replace(/^@/, ""), 50)).filter(Boolean);
      }
      if (req.body.status !== undefined) updates.status = req.body.status;
      if (req.body.sortWeight !== undefined) updates.sortWeight = req.body.sortWeight;
      if (req.body.startTime !== undefined) updates.startTime = req.body.startTime ? new Date(req.body.startTime) : null;
      if (req.body.endTime !== undefined) updates.endTime = req.body.endTime ? new Date(req.body.endTime) : null;

      await topic.update(updates);

      // 清除 Redis 缓存并递增版本号促使前端协商缓存立即刷新
      await invalidateTopicsCache(req.redisClient, topic.id);

      await recordAdminAudit(req, "UPDATE_HOT_VOTE_TOPIC", topic.id, updates);

      const latestVoteCount = await XHuntHotVoteRecord.count({ where: { topicId: topic.id } });
      return res.json({
        success: true,
        data: {
          ...topic.toJSON(),
          voteCount: latestVoteCount,
          hasVotes: latestVoteCount > 0,
        },
      });
    } catch (err) {
      console.error("[HotVoteAdmin] PUT /topics/:id error:", err);
      return res.status(500).json({ success: false, error: "更新议题失败" });
    }
  }
);

/**
 * DELETE /topics/:id
 * 超级管理员删除议题（无论是否进行中、是否有投票，级联清理关联选票与留言）
 */
router.delete(
  "/topics/:id",
  requireRole("super"),
  [param("id").isUUID().withMessage("无效的议题ID"), validateRequest],
  async (req, res) => {
    try {
      const { id } = req.params;
      const topic = await XHuntHotVoteTopic.findByPk(id);
      if (!topic) {
        return res.status(404).json({ success: false, error: "议题不存在" });
      }

      const voteCount = await XHuntHotVoteRecord.count({ where: { topicId: id } });
      const commentCount = await XHuntHotVoteComment.count({ where: { topicId: id } });

      // 数据库事务级联删除投票记录、留言以及议题本体
      await XHuntHotVoteTopic.sequelize.transaction(async (t) => {
        await XHuntHotVoteRecord.destroy({
          where: { topicId: id },
          transaction: t,
        });
        await XHuntHotVoteComment.destroy({
          where: { topicId: id },
          transaction: t,
        });
        await topic.destroy({ transaction: t });
      });

      await invalidateTopicsCache(req.redisClient, id);

      await recordAdminAudit(req, "DELETE_HOT_VOTE_TOPIC", id, {
        title: topic.title,
        status: topic.status,
        voteCount,
        commentCount,
      });

      return res.json({
        success: true,
        message: `议题 "${topic.title}" 已成功删除（已清理 ${voteCount} 条投票和 ${commentCount} 条留言）`,
      });
    } catch (err) {
      console.error("[HotVoteAdmin] DELETE /topics/:id error:", err);
      return res.status(500).json({ success: false, error: "删除议题失败" });
    }
  }
);

/**
 * DELETE /topics/:id/options/:optionId
 * 超级管理员删除议题中的指定选项（无论是否有投票或是否进行中）
 */
router.delete(
  "/topics/:id/options/:optionId",
  requireRole("super"),
  [
    param("id").isUUID().withMessage("无效的议题ID"),
    param("optionId").trim().matches(OPTION_ID_PATTERN).withMessage("无效的选项ID"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const { id, optionId } = req.params;
      const topic = await XHuntHotVoteTopic.findByPk(id);
      if (!topic) {
        return res.status(404).json({ success: false, error: "议题不存在" });
      }

      const options = Array.isArray(topic.options) ? topic.options : [];
      const targetOption = options.find((o) => o.id === optionId);
      if (!targetOption) {
        return res.status(404).json({ success: false, error: "未找到该选项" });
      }

      if (options.length <= 2) {
        return res.status(400).json({
          success: false,
          error: "议题至少需保留 2 个选项，若无需该议题请直接删除议题",
        });
      }

      const remainingOptions = options.filter((o) => o.id !== optionId);

      let deletedVotesCount = 0;
      await XHuntHotVoteTopic.sequelize.transaction(async (t) => {
        deletedVotesCount = await XHuntHotVoteRecord.destroy({
          where: { topicId: id, optionId },
          transaction: t,
        });

        await XHuntHotVoteRecord.update(
          { previousOptionId: null },
          {
            where: { topicId: id, previousOptionId: optionId },
            transaction: t,
          }
        );

        await topic.update({ options: remainingOptions }, { transaction: t });
      });

      await invalidateTopicsCache(req.redisClient, id);
      await invalidateTopicVotesCache(req.redisClient, id);

      await recordAdminAudit(req, "DELETE_HOT_VOTE_OPTION", id, {
        optionId,
        optionName: targetOption.name,
        deletedVotesCount,
      });

      const latestVoteCount = await XHuntHotVoteRecord.count({ where: { topicId: id } });
      return res.json({
        success: true,
        message: `选项 "${targetOption.name || optionId}" 已删除${deletedVotesCount > 0 ? `，并清理了 ${deletedVotesCount} 条关联投票` : ""}`,
        data: {
          ...topic.toJSON(),
          voteCount: latestVoteCount,
          hasVotes: latestVoteCount > 0,
        },
      });
    } catch (err) {
      console.error("[HotVoteAdmin] DELETE /topics/:id/options/:optionId error:", err);
      return res.status(500).json({ success: false, error: "删除选项失败" });
    }
  }
);

/**
 * GET /topics/:topicId/comments
 * 运营后台获取议题所有留言列表（包含匿名与已屏蔽状态）
 */
router.get(
  "/topics/:topicId/comments",
  [
    param("topicId").isUUID().withMessage("无效的议题ID"),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("pageSize").optional().isInt({ min: 1, max: 100 }).toInt(),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const { topicId } = req.params;
      const page = req.query.page || 1;
      const pageSize = req.query.pageSize || 20;
      const offset = (page - 1) * pageSize;

      const where = { topicId };
      if (req.query.isDeleted !== undefined) {
        where.isDeleted = req.query.isDeleted === "true" || req.query.isDeleted === true;
      }

      let count = 0;
      let rawRows = [];

      const isDeletedFilter = req.query.isDeleted !== undefined
        ? req.query.isDeleted === "true" || req.query.isDeleted === true
        : null;

      if (XHuntHotVoteComment.sequelize?.getDialect?.() === "postgres") {
        const deletedClause = isDeletedFilter !== null ? `AND "isDeleted" = :isDeleted` : "";
        const countResult = await XHuntHotVoteComment.sequelize.query(
          `SELECT COUNT(DISTINCT "twitterId")::int AS total
           FROM "XHuntHotVoteComments"
           WHERE "topicId" = :topicId ${deletedClause}`,
          {
            replacements: { topicId, isDeleted: isDeletedFilter },
            type: QueryTypes.SELECT,
          }
        );
        count = Number(countResult[0]?.total || 0);

        rawRows = await XHuntHotVoteComment.sequelize.query(
          `SELECT *
           FROM (
             SELECT DISTINCT ON ("twitterId")
               id,
               "topicId",
               "twitterId",
               "xHuntUserId",
               "userName",
               "displayName",
               "userAvatar",
               content,
               "isAnonymous",
               "isDeleted",
               "createdAt",
               "updatedAt"
             FROM "XHuntHotVoteComments"
             WHERE "topicId" = :topicId ${deletedClause}
             ORDER BY "twitterId", "createdAt" DESC, id DESC
           ) sub
           ORDER BY "createdAt" DESC
           LIMIT :limit OFFSET :offset`,
          {
            replacements: { topicId, isDeleted: isDeletedFilter, limit: pageSize, offset },
            type: QueryTypes.SELECT,
          }
        );
      } else {
        const allComments = await XHuntHotVoteComment.findAll({
          where,
          order: [["createdAt", "DESC"], ["id", "DESC"]],
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

      // 批量补全非匿名留言中缺失的头像与昵称（调用 Twitter 接口）
      const missingTwIds = rawRows
        .filter((r) => !r.isAnonymous && (!r.userAvatar || r.userName === "Anonymous") && r.twitterId)
        .map((r) => r.twitterId);

      if (missingTwIds.length > 0) {
        const uniqueTwIds = Array.from(new Set(missingTwIds));
        await Promise.all(
          uniqueTwIds.map(async (twId) => {
            const profile = await fetchTwitterProfileSafe(twId, req.redisClient);
            if (profile) {
              for (const r of rawRows) {
                if (r.twitterId === twId && !r.isAnonymous) {
                  if (!r.userAvatar && profile.avatar) {
                    r.userAvatar = profile.avatar;
                    XHuntHotVoteComment.update(
                      { userAvatar: profile.avatar },
                      { where: { id: r.id } }
                    ).catch(() => {});
                  }
                  if ((!r.displayName || r.displayName === "Anonymous") && profile.displayName) {
                    r.displayName = profile.displayName;
                  }
                  if ((!r.userName || r.userName === "Anonymous") && profile.handler) {
                    r.userName = profile.handler;
                  }
                }
              }
            }
          })
        );
      }

      const seenTwIds = new Set();
      const dedupedRows = [];
      for (const r of rawRows) {
        if (r.twitterId && seenTwIds.has(r.twitterId)) continue;
        if (r.twitterId) seenTwIds.add(r.twitterId);
        dedupedRows.push({
          ...(typeof r.toJSON === "function" ? r.toJSON() : r),
          content: sanitizeCommentPlainText(r.content, 200),
        });
      }

      const responseData = {
        success: true,
        data: {
          list: dedupedRows,
          pagination: {
            page,
            pageSize,
            total: count,
            totalPages: Math.ceil(count / pageSize),
          },
        },
      };

      if (handleNegotiatedCache(req, res, responseData, { isPrivate: true, maxAge: 0, staleWhileRevalidate: 300 })) {
        return;
      }

      return res.json(responseData);
    } catch (err) {
      console.error("[HotVoteAdmin] GET /comments error:", err);
      return res.status(500).json({ success: false, error: "获取议题留言失败" });
    }
  }
);

/**
 * DELETE /topics/:topicId/comments/:commentId
 * 管理员屏蔽/删除留言
 */
router.delete(
  "/topics/:topicId/comments/:commentId",
  [
    param("topicId").isUUID().withMessage("无效的议题ID"),
    param("commentId").isUUID().withMessage("无效的留言ID"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const { topicId, commentId } = req.params;
      const comment = await XHuntHotVoteComment.findOne({
        where: { id: commentId, topicId },
      });

      if (!comment) {
        return res.status(404).json({ success: false, error: "留言不存在" });
      }

      const isHardDelete = req.query.hard === "true" || req.query.hard === true;
      if (isHardDelete) {
        await comment.destroy();
        await recordAdminAudit(req, "DELETE_HOT_VOTE_COMMENT_PERMANENT", commentId, { topicId });
      } else {
        comment.isDeleted = true;
        await comment.save();
        await recordAdminAudit(req, "BLOCK_HOT_VOTE_COMMENT", commentId, { topicId });
      }

      await invalidateTopicCommentsCache(req.redisClient, topicId);

      return res.json({
        success: true,
        message: isHardDelete ? "留言已彻底删除" : "留言已屏蔽",
      });
    } catch (err) {
      console.error("[HotVoteAdmin] DELETE /comments error:", err);
      return res.status(500).json({ success: false, error: "删除留言失败" });
    }
  }
);

/**
 * GET /topics/:topicId/votes
 * 运营后台获取议题投票情况（汇总统计与流水明细）
 */
router.get(
  "/topics/:topicId/votes",
  [
    param("topicId").isUUID().withMessage("无效的议题ID"),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("pageSize").optional().isInt({ min: 1, max: 100 }).toInt(),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const { topicId } = req.params;
      const page = req.query.page || 1;
      const pageSize = req.query.pageSize || 20;
      const offset = (page - 1) * pageSize;

      const topic = await XHuntHotVoteTopic.findByPk(topicId);
      if (!topic) {
        return res.status(404).json({ success: false, error: "议题不存在" });
      }

      const optionsList = Array.isArray(topic.options) ? topic.options : [];
      const optionMap = {};
      for (const opt of optionsList) {
        optionMap[opt.id] = opt.name || opt.id;
      }

      // 统计总参与人数、总权重与各选项分布
      const totalParticipants = await XHuntHotVoteRecord.count({ where: { topicId } });
      const groupCounts = await XHuntHotVoteRecord.findAll({
        where: { topicId },
        attributes: [
          "optionId",
          [fn("COUNT", col("id")), "count"],
          [fn("SUM", fn("COALESCE", col("voteWeight"), 1)), "totalWeight"],
        ],
        group: ["optionId"],
        raw: true,
      });

      const countMap = {};
      const weightMap = {};
      let totalWeight = 0;
      for (const g of groupCounts) {
        const w = parseInt(g.totalWeight || "0", 10);
        const c = parseInt(g.count || "0", 10);
        countMap[g.optionId] = c;
        weightMap[g.optionId] = w;
        totalWeight += w;
      }

      const distribution = optionsList.map((opt) => {
        const count = countMap[opt.id] || 0;
        const weight = weightMap[opt.id] || 0;
        const percentage =
          totalWeight > 0
            ? `${Math.round((weight / totalWeight) * 100)}%`
            : "0%";
        return {
          id: opt.id,
          name: opt.name || opt.id,
          color: opt.color || "#1677ff",
          isGua: !!opt.isGua,
          count,
          weight,
          percentage,
        };
      });

      // 投票明细列表查询
      const where = { topicId };
      if (req.query.optionId) {
        where.optionId = req.query.optionId;
      }

      const { count, rows } = await XHuntHotVoteRecord.findAndCountAll({
        where,
        order: [["createdAt", "DESC"]],
        limit: pageSize,
        offset,
      });

      // 批量关联当前页选民的最近留言与推特用户档案
      const voterTwitterIds = Array.from(new Set(rows.map((r) => r.twitterId).filter(Boolean)));
      const commentsByTwitterId = {};
      const voterUserMap = {};
      if (voterTwitterIds.length > 0) {
        const voterComments = await XHuntHotVoteComment.findAll({
          where: {
            topicId,
            twitterId: { [Op.in]: voterTwitterIds },
          },
          order: [["createdAt", "DESC"]],
        });
        for (const c of voterComments) {
          if (!commentsByTwitterId[c.twitterId]) {
            commentsByTwitterId[c.twitterId] = c;
          }
        }

        await Promise.all(
          voterTwitterIds.map(async (twId) => {
            const profile = await fetchTwitterProfileSafe(twId, req.redisClient);
            if (profile) {
              voterUserMap[twId] = {
                avatar: profile.avatar || "",
                displayName: profile.displayName || "",
                userName: profile.handler || "",
              };
            }
          })
        );
      }

      const list = rows.map((r) => {
        const comment = commentsByTwitterId[r.twitterId];
        const userInfo = voterUserMap[r.twitterId] || {};
        const isAnon = Boolean(r.isAnonymous);
        return {
          id: r.id,
          topicId: r.topicId,
          twitterId: r.twitterId,
          voterDisplayName: isAnon ? "匿名选民" : (userInfo.displayName || comment?.displayName || null),
          voterHandle: isAnon ? null : (userInfo.userName || comment?.userName || null),
          voterAvatar: isAnon ? null : (userInfo.avatar || comment?.userAvatar || null),
          optionId: r.optionId,
          optionName: optionMap[r.optionId] || r.optionId,
          previousOptionId: r.previousOptionId,
          revoteCount: r.revoteCount,
          voteWeight: r.voteWeight || 1,
          voterRankSnapshot: r.voterRankSnapshot || null,
          isAnonymous: isAnon,
          clientIp: r.clientIp,
          commentContent: comment ? sanitizeCommentPlainText(comment.content, 200) : null,
          commentDeleted: comment ? Boolean(comment.isDeleted) : false,
          commentId: comment ? comment.id : null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      });

      const responseData = {
        success: true,
        data: {
          summary: {
            totalParticipants,
            totalWeight,
            distribution,
          },
          list,
          pagination: {
            page,
            pageSize,
            total: count,
            totalPages: Math.ceil(count / pageSize),
          },
        },
      };

      if (handleNegotiatedCache(req, res, responseData, { isPrivate: true, maxAge: 0, staleWhileRevalidate: 300 })) {
        return;
      }

      return res.json(responseData);
    } catch (err) {
      console.error("[HotVoteAdmin] GET /votes error:", err);
      return res.status(500).json({ success: false, error: "获取投票情况失败" });
    }
  }
);

/**
 * DELETE /topics/:topicId/votes/:recordId
 * 管理员删除单条投票流水记录（如清理刷票、测试票）
 */
router.delete(
  "/topics/:topicId/votes/:recordId",
  [
    param("topicId").isUUID().withMessage("无效的议题ID"),
    param("recordId").isUUID().withMessage("无效的投票记录ID"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const { topicId, recordId } = req.params;
      const record = await XHuntHotVoteRecord.findOne({
        where: { id: recordId, topicId },
      });

      if (!record) {
        return res.status(404).json({ success: false, error: "投票记录不存在" });
      }

      const optionId = record.optionId;
      const twitterId = record.twitterId;

      await record.destroy();

      // 清除 Redis 票数缓存并递增版本号促使前端协商缓存立即刷新
      await invalidateTopicVotesCache(req.redisClient, topicId);

      await recordAdminAudit(req, "DELETE_HOT_VOTE_RECORD", recordId, {
        topicId,
        twitterId,
        optionId,
      });

      return res.json({ success: true, message: "投票记录已删除" });
    } catch (err) {
      console.error("[HotVoteAdmin] DELETE /votes error:", err);
      return res.status(500).json({ success: false, error: "删除投票记录失败" });
    }
  }
);

module.exports = router;
