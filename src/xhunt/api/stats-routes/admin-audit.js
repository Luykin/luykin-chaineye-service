const express = require("express");
const { Op } = require("sequelize");
const { XhuntAdminAuditLog } = require("../../../models/postgres-start");
const { adminAuth } = require("../../../admin/middleware/adminAuth");

const router = express.Router();

router.get("/admin-audit/logs", adminAuth, async (req, res) => {
  try {
    if (!req.user || req.user.role !== "super") {
      console.log(
        `[管理员操作记录] ❌ 权限不足: 用户=${
          req.user?.username || "unknown"
        }, 角色=${req.user?.role || "unknown"}`
      );
      return res.status(403).json({
        success: false,
        error: "权限不足",
        message: "仅 luykin 用户可以查看管理员操作记录",
      });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitQuery = parseInt(req.query.limit, 10) || 50;
    const limit = Math.min(Math.max(limitQuery, 1), 100);
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.email && req.query.email.trim()) {
      where.email = {
        [Op.iLike]: `%${req.query.email.trim()}%`,
      };
    }
    if (req.query.action && req.query.action.trim()) {
      where.action = {
        [Op.iLike]: `%${req.query.action.trim()}%`,
      };
    }

    const { rows, count } = await XhuntAdminAuditLog.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      offset,
      limit,
      attributes: [
        "id",
        "createdAt",
        "email",
        "action",
        "method",
        "route",
        "success",
        "message",
        "ip",
      ],
    });

    res.json({
      success: true,
      data: rows.map((row) => row.toJSON()),
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.max(Math.ceil(count / limit), 1),
      },
    });
  } catch (error) {
    console.error("[管理员操作记录] ❌ 查询失败:", error);
    res.status(500).json({
      success: false,
      error: "查询失败",
      message: error.message,
    });
  }
});

module.exports = router;
