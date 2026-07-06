const express = require("express");
const { getFullStats, getSimpleStats } = require("../../services/statsService");
const {
  adminAuth,
  requirePermission,
} = require("../../../admin/middleware/adminAuth");

const router = express.Router();

router.get("/json", adminAuth, async (req, res) => {
  try {
    const stats = await getSimpleStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching JSON stats:", error);
    res.status(500).json({
      success: false,
      error: "获取统计数据失败",
    });
  }
});

router.get(
  "/overview",
  adminAuth,
  requirePermission("overview"),
  async (req, res) => {
    try {
      const stats = await getFullStats(req.redisClient, {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("Error fetching overview stats:", error);
      res.status(500).json({
        success: false,
        error: "获取数据概览失败",
      });
    }
  }
);

module.exports = router;
