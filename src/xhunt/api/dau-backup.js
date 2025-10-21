const express = require("express");
const router = express.Router();
const { getDAUBackupService } = require("../middleware/security");
const DAUBackupService = require("../../services/dauBackupService");

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

// 已删除不需要的接口：
// - /backup/:date (按日期备份)
// - /data/:date (按日期读取数据)
// - /cleanup (清理过期文件)

/**
 * 获取主备份文件状态
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

    const mainBackupFile = await backupService.getLatestBackupFile();
    const hasBackup = !!mainBackupFile;
    const fileName = "dau-all-users.json"; // 固定文件名

    res.json({
      success: true,
      data: {
        hasBackup: hasBackup,
        fileName: fileName,
        message: hasBackup
          ? "主备份文件存在"
          : "主备份文件不存在，请先执行备份",
      },
    });
  } catch (error) {
    console.error("获取备份文件状态失败:", error);
    res.status(500).json({
      success: false,
      message: "获取文件状态失败",
      error: error.message,
    });
  }
});

/**
 * 手动备份所有DAU数据
 */
router.post("/backup-all", async (req, res) => {
  try {
    console.log("🔄 收到手动备份所有DAU数据的请求");

    // 直接使用请求中的Redis客户端创建备份服务
    const backupService = new DAUBackupService(req.redisClient);
    const result = await backupService.backupAllDAUData();

    res.json({
      success: result.success,
      message: result.message,
      data: {
        fileName: result.fileName,
        totalUsers: result.totalUsers,
        totalRecords: result.totalRecords,
        addedUsers: result.addedUsers,
        updatedUsers: result.updatedUsers,
        newRecords: result.newRecords,
        errorCount: result.errorCount,
      },
    });
  } catch (error) {
    console.error("手动备份所有DAU数据失败:", error);
    res.status(500).json({
      success: false,
      message: "备份失败",
      error: error.message,
    });
  }
});

/**
 * 下载最新的累加备份文件
 */
router.get("/download-latest", async (req, res) => {
  try {
    // 直接使用请求中的Redis客户端创建备份服务
    const backupService = new DAUBackupService(req.redisClient);
    const backupData = await backupService.readLatestBackupData();
    const fileName = "dau-all-users.json"; // 固定文件名

    // 设置响应头
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"`
    );

    // 发送文件
    res.json(backupData);
  } catch (error) {
    console.error("下载最新备份文件失败:", error);

    if (
      error.message.includes("备份文件不存在") ||
      error.message.includes("没有找到")
    ) {
      return res.status(404).json({
        success: false,
        message: "没有找到备份文件，请先执行备份操作",
      });
    }

    res.status(500).json({
      success: false,
      message: "下载备份文件失败",
      error: error.message,
    });
  }
});

module.exports = router;
