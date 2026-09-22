const express = require("express");
const { body, param, query } = require("express-validator");
const { fn, col } = require("sequelize");
const { validateRequest } = require("../middleware/validate-request");
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
  sanitizeSafeUrl,
} = require("../services/inputValidator");

const router = express.Router();

const OPTION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;

/**
 * 清洗选项数组；自动补默认"吃个瓜"选项。
 * 选项 id 不符合字符集要求时返回 null
 * name 为中文名（兼容旧字段），nameEn 可选，二者合并为 nameI18n 供多语言展示
 */
function buildCleanOptions(options) {
  let hasGua = false;
  const cleanOptions = options.map((opt, idx) => {
    const name = sanitizePlainText(opt.name || "", 30);
    const nameEn = opt.nameEn ? sanitizePlainText(opt.nameEn, 60) : "";
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

  // 确保包含吃瓜选项（若无，自动追加默认吃瓜选项）
  if (!cleanOptions.some((o) => o.isGua)) {
    cleanOptions.push({
      id: "opt_gua",
      name: "吃个瓜",
      nameI18n: { zh: "吃个瓜", en: "Just watching" },
      avatar: "",
      twitterHandle: "",
      color: "#94a3b8",
      isGua: true,
    });
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
    return res.json({ success: true, data: list });
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
      return res.json({ success: true, data: topic });
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
        testingPhase = false,
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
        return res.status(400).json({ success: false, error: "选项ID仅支持字母、数字、下划线和中划线（1-32字符）" });
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

      return res.json({ success: true, data: topic });
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
        const currentTitleI18n = topic.titleI18n || {};
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

        const nextTitleI18n = { ...(topic.titleI18n || {}) };
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
        const currentSummaryI18n = topic.summaryI18n || {};
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

        const nextSummaryI18n = { ...(topic.summaryI18n || {}) };
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
          return res.status(400).json({ success: false, error: "选项ID仅支持字母、数字、下划线和中划线（1-32字符）" });
        }

        // 校验历史投票数据：若该议题已有投票，新选项必须保留所有已产生投票的历史选项ID，防止票数孤儿化
        const existingVoteOptions = await XHuntHotVoteRecord.findAll({
          where: { topicId: topic.id },
          attributes: ["optionId"],
          group: ["optionId"],
          raw: true,
        });

        if (existingVoteOptions.length > 0) {
          const newOptionIds = new Set(cleanOptions.map((o) => o.id));
          const missingOption = existingVoteOptions.find((v) => !newOptionIds.has(v.optionId));
          if (missingOption) {
            return res.status(400).json({
              success: false,
              error: `选项 "${missingOption.optionId}" 已有历史投票记录，不能删除`,
            });
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

      // 清除 Redis 缓存促使前端刷新
      if (req.redisClient?.del) {
        await req.redisClient.del(`hotvote:counts:${topic.id}`);
      }

      await recordAdminAudit(req, "UPDATE_HOT_VOTE_TOPIC", topic.id, updates);

      return res.json({ success: true, data: topic });
    } catch (err) {
      console.error("[HotVoteAdmin] PUT /topics/:id error:", err);
      return res.status(500).json({ success: false, error: "更新议题失败" });
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

      const { count, rows } = await XHuntHotVoteComment.findAndCountAll({
        where,
        order: [["createdAt", "DESC"]],
        limit: pageSize,
        offset,
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

      // 统计总参与人数与各选项分布
      const totalParticipants = await XHuntHotVoteRecord.count({ where: { topicId } });
      const groupCounts = await XHuntHotVoteRecord.findAll({
        where: { topicId },
        attributes: ["optionId", [fn("COUNT", col("id")), "count"]],
        group: ["optionId"],
        raw: true,
      });

      const countMap = {};
      for (const g of groupCounts) {
        countMap[g.optionId] = parseInt(g.count || "0", 10);
      }

      const distribution = optionsList.map((opt) => {
        const count = countMap[opt.id] || 0;
        const percentage =
          totalParticipants > 0
            ? `${Math.round((count / totalParticipants) * 100)}%`
            : "0%";
        return {
          id: opt.id,
          name: opt.name || opt.id,
          color: opt.color || "#1677ff",
          isGua: !!opt.isGua,
          count,
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

      // 批量关联当前页选民的最近留言
      const voterTwitterIds = Array.from(new Set(rows.map((r) => r.twitterId).filter(Boolean)));
      const commentsByTwitterId = {};
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
      }

      const list = rows.map((r) => {
        const comment = commentsByTwitterId[r.twitterId];
        return {
          id: r.id,
          topicId: r.topicId,
          twitterId: r.twitterId,
          optionId: r.optionId,
          optionName: optionMap[r.optionId] || r.optionId,
          previousOptionId: r.previousOptionId,
          revoteCount: r.revoteCount,
          isAnonymous: Boolean(r.isAnonymous),
          clientIp: r.clientIp,
          commentContent: comment ? comment.content : null,
          commentDeleted: comment ? Boolean(comment.isDeleted) : false,
          commentId: comment ? comment.id : null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      });

      return res.json({
        success: true,
        data: {
          summary: {
            totalParticipants,
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
      });
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

      // 清除 Redis 票数缓存促使下一次请求重新精准聚合
      if (req.redisClient?.del) {
        await req.redisClient.del(`hotvote:counts:${topicId}`);
      }

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
