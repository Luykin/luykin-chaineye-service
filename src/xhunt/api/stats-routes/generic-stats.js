const express = require("express");
const { Op } = require("sequelize");
const {
  adminAuth,
  requirePermission,
} = require("../../../admin/middleware/adminAuth");
const { GenericStatEvent, pgInstance } = require("../../../models/postgres-start");
const { parseDateOrNull } = require("./shared");

const router = express.Router();

router.get(
  "/generic-stats/types",
  adminAuth,
  requirePermission("generic-stats"),
  async (req, res) => {
    try {
      const types = await GenericStatEvent.findAll({
        attributes: [
          "type",
          [pgInstance.fn("COUNT", pgInstance.col("id")), "count"],
          [pgInstance.fn("MAX", pgInstance.col("event_at")), "lastEventAt"],
        ],
        group: ["type"],
        order: [
          [pgInstance.literal("count"), "DESC"],
          [pgInstance.literal("\"lastEventAt\""), "DESC"],
        ],
        raw: true,
      });

      res.json({
        success: true,
        data: types.map((item) => ({
          type: item.type,
          count: Number(item.count || 0),
          lastEventAt: item.lastEventAt || null,
        })),
      });
    } catch (error) {
      console.error("[generic-stats/types] 获取失败:", error);
      res.status(500).json({ success: false, error: "获取 type 列表失败" });
    }
  }
);

router.get(
  "/generic-stats/events",
  adminAuth,
  requirePermission("generic-stats"),
  async (req, res) => {
    try {
      const {
        type,
        subjectType,
        subjectId,
        actorId,
        dateFrom,
        dateTo,
        page = 1,
        pageSize = 20,
      } = req.query;

      const where = {};

      if (type) where.type = String(type).trim();
      if (subjectType) where.subjectType = String(subjectType).trim();
      if (subjectId) where.subjectId = String(subjectId).trim();
      if (actorId) where.actorId = String(actorId).trim();

      const eventAtRange = {};
      const parsedFrom = parseDateOrNull(dateFrom);
      const parsedTo = parseDateOrNull(dateTo);
      if (parsedFrom) eventAtRange[Op.gte] = parsedFrom;
      if (parsedTo) eventAtRange[Op.lte] = parsedTo;
      if (Object.keys(eventAtRange).length > 0) {
        where.eventAt = eventAtRange;
      }

      const safePage = Math.max(1, parseInt(page, 10) || 1);
      const safePageSize = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

      const result = await GenericStatEvent.findAndCountAll({
        where,
        order: [["eventAt", "DESC"], ["id", "DESC"]],
        offset: (safePage - 1) * safePageSize,
        limit: safePageSize,
      });

      res.json({
        success: true,
        data: {
          items: result.rows,
          pagination: {
            page: safePage,
            pageSize: safePageSize,
            total: result.count,
            totalPages: Math.max(1, Math.ceil(result.count / safePageSize)),
          },
        },
      });
    } catch (error) {
      console.error("[generic-stats/events] 获取失败:", error);
      res.status(500).json({ success: false, error: "获取统计事件失败" });
    }
  }
);

router.get(
  "/generic-stats/aggregate",
  adminAuth,
  requirePermission("generic-stats"),
  async (req, res) => {
    try {
      const { type, dateFrom, dateTo, subjectId } = req.query;

      if (!type) {
        return res.status(400).json({ success: false, error: "type 不能为空" });
      }

      const where = { type: String(type).trim() };
      if (subjectId) where.subjectId = String(subjectId).trim();

      const eventAtRange = {};
      const parsedFrom = parseDateOrNull(dateFrom);
      const parsedTo = parseDateOrNull(dateTo);
      if (parsedFrom) eventAtRange[Op.gte] = parsedFrom;
      if (parsedTo) eventAtRange[Op.lte] = parsedTo;
      if (Object.keys(eventAtRange).length > 0) {
        where.eventAt = eventAtRange;
      }

      if (where.type !== "xhunt.kol_chat.chat") {
        return res.status(400).json({
          success: false,
          error: "当前仅支持 xhunt.kol_chat.chat 的聚合分析",
        });
      }

      const rows = await GenericStatEvent.findAll({
        where,
        attributes: [
          "subjectId",
          "subjectName",
          [pgInstance.fn("COUNT", pgInstance.col("id")), "callCount"],
          [pgInstance.fn("SUM", pgInstance.col("count_value")), "questionCount"],
          [pgInstance.literal('COUNT(DISTINCT "actor_id")'), "uniqueUserCount"],
        ],
        group: ["subjectId", "subjectName"],
        order: [
          [pgInstance.literal('"callCount"'), "DESC"],
          [pgInstance.literal('"uniqueUserCount"'), "DESC"],
          ["subjectId", "ASC"],
        ],
        raw: true,
      });

      const summaryRow = await GenericStatEvent.findOne({
        where,
        attributes: [
          [pgInstance.fn("COUNT", pgInstance.col("id")), "totalCallCount"],
          [pgInstance.fn("SUM", pgInstance.col("count_value")), "totalQuestionCount"],
          [pgInstance.literal('COUNT(DISTINCT "actor_id")'), "totalUniqueUserCount"],
        ],
        raw: true,
      });

      res.json({
        success: true,
        data: {
          type: where.type,
          summary: {
            totalKols: rows.length,
            totalCallCount: Number(summaryRow?.totalCallCount || 0),
            totalQuestionCount: Number(summaryRow?.totalQuestionCount || 0),
            totalUniqueUserCount: Number(summaryRow?.totalUniqueUserCount || 0),
          },
          items: rows.map((item) => ({
            subjectId: item.subjectId,
            subjectName: item.subjectName || item.subjectId,
            callCount: Number(item.callCount || 0),
            questionCount: Number(item.questionCount || 0),
            uniqueUserCount: Number(item.uniqueUserCount || 0),
          })),
        },
      });
    } catch (error) {
      console.error("[generic-stats/aggregate] 获取失败:", error);
      res.status(500).json({ success: false, error: "获取聚合统计失败" });
    }
  }
);

module.exports = router;
