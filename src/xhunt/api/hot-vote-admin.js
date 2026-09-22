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
    body("title").trim().isLength({ min: 1, max: 100 }).withMessage("标题必须在 1-100 字之间"),
    body("titleEn").optional().trim().isLength({ max: 100 }).withMessage("英文标题不能超过 100 字"),
    body("titleHtml").optional().trim().isLength({ max: 1000 }).withMessage("富文本标题不能超过 1000 字符"),
    body("summary").trim().isLength({ min: 1, max: 100 }).withMessage("核心冲突介绍必须在 1-100 字之间"),
    body("summaryEn").optional().trim().isLength({ max: 100 }).withMessage("英文核心冲突介绍不能超过 100 字"),
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
        summary,
        summaryEn,
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

      // XSS 安全清洗
      const cleanTitle = sanitizePlainText(title, 100);
      const cleanTitleEn = titleEn ? sanitizePlainText(titleEn, 100) : "";
      const cleanTitleHtml = titleHtml ? sanitizeVoteTitleHtml(titleHtml, 1000) : null;
      const cleanSummary = sanitizePlainText(summary, 100);
      const cleanSummaryEn = summaryEn ? sanitizePlainText(summaryEn, 100) : "";

      // 清洗选项（含 id 字符集校验与自动补吃瓜选项）
      const cleanOptions = buildCleanOptions(options);
      if (!cleanOptions) {
        return res.status(400).json({ success: false, error: "选项ID仅支持字母、数字、下划线和中划线（1-32字符）" });
      }

      const cleanTestList = Array.isArray(testList)
        ? testList.map((item) => sanitizePlainText(String(item || "").trim().toLowerCase().replace(/^@/, ""), 50)).filter(Boolean)
        : [];

      const topic = await XHuntHotVoteTopic.create({
        title: cleanTitle,
        titleI18n: buildI18nField(cleanTitle, cleanTitleEn),
        titleHtml: cleanTitleHtml,
        summary: cleanSummary,
        summaryI18n: buildI18nField(cleanSummary, cleanSummaryEn),
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
    body("titleHtml").optional().trim().isLength({ max: 1000 }),
    body("summary").optional().trim().isLength({ min: 1, max: 100 }),
    body("summaryEn").optional().trim().isLength({ max: 100 }),
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
      if (req.body.title !== undefined || req.body.titleEn !== undefined) {
        const cleanTitle = req.body.title !== undefined ? sanitizePlainText(req.body.title, 100) : undefined;
        const cleanTitleEn = req.body.titleEn !== undefined ? sanitizePlainText(req.body.titleEn, 100) : undefined;
        if (cleanTitle !== undefined) updates.title = cleanTitle;
        updates.titleI18n = mergeI18nField(topic.titleI18n || { zh: topic.title }, cleanTitle, cleanTitleEn);
      }
      if (req.body.titleHtml !== undefined) updates.titleHtml = sanitizeVoteTitleHtml(req.body.titleHtml, 1000);
      if (req.body.summary !== undefined || req.body.summaryEn !== undefined) {
        const cleanSummary = req.body.summary !== undefined ? sanitizePlainText(req.body.summary, 100) : undefined;
        const cleanSummaryEn = req.body.summaryEn !== undefined ? sanitizePlainText(req.body.summaryEn, 100) : undefined;
        if (cleanSummary !== undefined) updates.summary = cleanSummary;
        updates.summaryI18n = mergeI18nField(topic.summaryI18n || { zh: topic.summary }, cleanSummary, cleanSummaryEn);
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

      const list = rows.map((r) => ({
        id: r.id,
        topicId: r.topicId,
        twitterId: r.twitterId,
        optionId: r.optionId,
        optionName: optionMap[r.optionId] || r.optionId,
        previousOptionId: r.previousOptionId,
        revoteCount: r.revoteCount,
        isAnonymous: Boolean(r.isAnonymous),
        clientIp: r.clientIp,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));

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
