const express = require("express");
const router = express.Router();
const { getDAUBackupService } = require("../middleware/security");

/**
 * 获取DAU备份服务状态
 */
router.get("/status", async (req, res) => {
  try {
    const backupService = getDAUBackupService();

    if (!backupService) {
      return res.status(503).json({
        success: false,
        message: "DAU备份服务未初始化",
      });
    }

    const status = backupService.getStatus();
    const backupFiles = await backupService.getBackupFiles();

    res.json({
      success: true,
      data: {
        service: status,
        backupFiles: backupFiles,
        totalBackups: backupFiles.length,
      },
    });
  } catch (error) {
    console.error("获取DAU备份状态失败:", error);
    res.status(500).json({
      success: false,
      message: "获取备份状态失败",
      error: error.message,
    });
  }
});

/**
 * 手动触发指定日期的备份
 */
router.post("/backup/:date", async (req, res) => {
  try {
    const { date } = req.params;

    // 验证日期格式
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        message: "日期格式不正确，请使用 YYYY-MM-DD 格式",
      });
    }

    const backupService = getDAUBackupService();

    if (!backupService) {
      return res.status(503).json({
        success: false,
        message: "DAU备份服务未初始化",
      });
    }

    await backupService.manualBackup(date);

    res.json({
      success: true,
      message: `成功触发 ${date} 的DAU数据备份`,
    });
  } catch (error) {
    console.error("手动备份失败:", error);
    res.status(500).json({
      success: false,
      message: "备份失败",
      error: error.message,
    });
  }
});

/**
 * 获取指定日期的备份数据
 */
router.get("/data/:date", async (req, res) => {
  try {
    const { date } = req.params;

    // 验证日期格式
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        message: "日期格式不正确，请使用 YYYY-MM-DD 格式",
      });
    }

    const backupService = getDAUBackupService();

    if (!backupService) {
      return res.status(503).json({
        success: false,
        message: "DAU备份服务未初始化",
      });
    }

    const backupData = await backupService.readBackupData(date);

    res.json({
      success: true,
      data: backupData,
    });
  } catch (error) {
    console.error("读取备份数据失败:", error);

    if (error.message.includes("备份文件不存在")) {
      return res.status(404).json({
        success: false,
        message: `未找到 ${date} 的备份数据`,
      });
    }

    res.status(500).json({
      success: false,
      message: "读取备份数据失败",
      error: error.message,
    });
  }
});

/**
 * 清理过期的备份文件
 */
router.post("/cleanup", async (req, res) => {
  try {
    const backupService = getDAUBackupService();

    if (!backupService) {
      return res.status(503).json({
        success: false,
        message: "DAU备份服务未初始化",
      });
    }

    await backupService.cleanupOldBackups();

    res.json({
      success: true,
      message: "过期备份文件清理完成",
    });
  } catch (error) {
    console.error("清理过期备份失败:", error);
    res.status(500).json({
      success: false,
      message: "清理失败",
      error: error.message,
    });
  }
});

/**
 * 获取备份文件列表
 */
router.get("/files", async (req, res) => {
  try {
    const backupService = getDAUBackupService();

    if (!backupService) {
      return res.status(503).json({
        success: false,
        message: "DAU备份服务未初始化",
      });
    }

    const backupFiles = await backupService.getBackupFiles();

    res.json({
      success: true,
      data: {
        files: backupFiles,
        total: backupFiles.length,
      },
    });
  } catch (error) {
    console.error("获取备份文件列表失败:", error);
    res.status(500).json({
      success: false,
      message: "获取文件列表失败",
      error: error.message,
    });
  }
});

module.exports = router;
