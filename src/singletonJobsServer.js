require("dotenv").config({
  path: `${process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro"}`,
});

const schedule = require("node-schedule");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");

// 将所有需要单实例运行的定时任务集中到这里启动（备份、日志清理等）
const pgBackupService = require("./services/pg-backup-service");

// 清理 PM2 日志（删除 3 天前的日志文件），每 30 分钟执行一次
async function cleanupPm2Logs() {
  try {
    const home = os.homedir();
    const logsDir = path.join(home, ".pm2", "logs");

    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const cutoff = now - threeDaysMs;

    const exists = fs.existsSync(logsDir);
    if (!exists) {
      console.log(`[PM2 Logs] 目录不存在: ${logsDir}`);
      return;
    }

    const entries = await fsp.readdir(logsDir, { withFileTypes: true });
    let deleted = 0;
    let scanned = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(logsDir, entry.name);
      try {
        const st = await fsp.stat(full);
        scanned++;
        if (st.mtimeMs < cutoff) {
          await fsp.unlink(full);
          deleted++;
        }
      } catch (e) {
        console.warn(`[PM2 Logs] 处理失败: ${full} -> ${e.message}`);
      }
    }

    console.log(`[PM2 Logs] 扫描 ${scanned} 个文件，删除 ${deleted} 个（阈值：3 天前）`);
  } catch (err) {
    console.error("[PM2 Logs] 清理出错:", err);
  }
}

(async () => {
  try {
    await pgBackupService.start();
    console.log("单例任务服务运行中...（备份/日志清理等）");

    // 立即执行一次清理
    cleanupPm2Logs();

    // 每 30 分钟执行一次：*/30 * * * *
    schedule.scheduleJob("*/30 * * * *", cleanupPm2Logs);
  } catch (err) {
    console.error("单例任务进程启动失败:", err);
    process.exit(1);
  }
})();
