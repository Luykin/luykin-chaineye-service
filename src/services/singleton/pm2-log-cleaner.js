const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");

// 清理 PM2 日志（删除 2 天前的日志文件）
async function cleanupPm2Logs() {
  try {
    const home = os.homedir();
    const logsDir = path.join(home, ".pm2", "logs");

    const now = Date.now();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    const cutoff = now - twoDaysMs;

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

    console.log(
      `[PM2 Logs] 扫描 ${scanned} 个文件，删除 ${deleted} 个（阈值：2 天前）`
    );
  } catch (err) {
    console.error("[PM2 Logs] 清理出错:", err);
  }
}

module.exports = {
  cleanupPm2Logs,
};
