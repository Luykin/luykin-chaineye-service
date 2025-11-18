require("dotenv").config({
  path: `${process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro"}`,
});

const schedule = require("node-schedule");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const redis = require("redis");

// 将所有需要单实例运行的定时任务集中到这里启动（备份、日志清理等）
const pgBackupService = require("./services/pg-backup-service");
const { setupPostgres, VersionRequestStats, UrlRequestStats } = require("./models/postgres-start");
const { requestStatsManager } = require("./xhunt/middleware/security");

// 初始化 Redis 客户端
const redisClient = redis.createClient({
  socket: {
    host: "127.0.0.1",
    port: 6379,
  },
});

// 清理 PM2 日志（删除 2 天前的日志文件），每 4 小时执行一次
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

    console.log(`[PM2 Logs] 扫描 ${scanned} 个文件，删除 ${deleted} 个（阈值：2 天前）`);
  } catch (err) {
    console.error("[PM2 Logs] 清理出错:", err);
  }
}

// 获取5分钟时间窗口（向下取整到5分钟）
function get5MinWindow(date = new Date()) {
  const minutes = date.getUTCMinutes();
  const roundedMinutes = Math.floor(minutes / 5) * 5;
  const window = new Date(date);
  window.setUTCMinutes(roundedMinutes);
  window.setUTCSeconds(0);
  window.setUTCMilliseconds(0);
  return window.toISOString();
}

// 获取上一个5分钟窗口
function getPrev5MinWindow() {
  const now = new Date();
  const prev = new Date(now.getTime() - 5 * 60 * 1000);
  return get5MinWindow(prev);
}

// 统计数据定时任务：每5分钟执行一次（版本统计 + URL统计）
async function flushStats() {
  try {
    console.log(`\n⏰ [${new Date().toISOString()}] 开始执行统计数据定时任务...`);

    // 1. 先flush所有内存中的数据（防止丢失）
    const status = requestStatsManager.getStatus();
    await Promise.all([
      Promise.all(
        Object.keys(status.versionMemoryCounter || {}).map((timeWindow) =>
          requestStatsManager.flushVersionMemoryToRedis(timeWindow, redisClient)
        )
      ),
      Promise.all(
        Object.keys(status.urlMemoryCounter || {}).map((timeWindow) =>
          requestStatsManager.flushUrlMemoryToRedis(timeWindow, redisClient)
        )
      ),
    ]);

    // 2. 获取上一个5分钟窗口
    const prevWindow = getPrev5MinWindow();

    // 3. 并行处理版本统计和URL统计
    await Promise.all([
      // 版本统计
      (async () => {
        try {
          const pattern = `version_stats:${prevWindow}:*`;
          const keys = await redisClient.keys(pattern);

          if (keys.length === 0) {
            console.log(`[版本统计] 上一个窗口 ${prevWindow} 没有数据，跳过`);
            return;
          }

          // 批量读取数据
          const statsData = [];
          for (const key of keys) {
            const count = await redisClient.get(key);
            if (count) {
              const version = key.split(":").pop();
              statsData.push({
                timeWindow: new Date(prevWindow),
                version: version,
                requestCount: parseInt(count, 10),
              });
            }
          }

          // 批量写入PostgreSQL（使用 upsert）
          if (statsData.length > 0) {
            for (const data of statsData) {
              await VersionRequestStats.upsert({
                timeWindow: data.timeWindow,
                version: data.version,
                requestCount: data.requestCount,
              });
            }
            console.log(
              `[版本统计] ✅ 已写入 ${statsData.length} 条记录到PostgreSQL (窗口: ${prevWindow})`
            );
          }

          // 删除Redis中上一个窗口的数据
          if (keys.length > 0) {
            await redisClient.del(keys);
            console.log(`[版本统计] ✅ 已删除Redis中的 ${keys.length} 个key`);
          }
        } catch (error) {
          console.error("[版本统计] ❌ 处理失败:", error);
        }
      })(),
      // URL统计
      (async () => {
        try {
          const pattern = `url_stats:${prevWindow}|*`;
          const keys = await redisClient.keys(pattern);

          if (keys.length === 0) {
            console.log(`[URL统计] 上一个窗口 ${prevWindow} 没有数据，跳过`);
            return;
          }

          // 批量读取数据
          const statsData = [];
          for (const key of keys) {
            const count = await redisClient.get(key);
            if (count) {
              // 从key中提取URL路径
              // key格式: url_stats:${timeWindow}|${urlPath}
              const separatorIndex = key.indexOf("|");
              if (separatorIndex > 0) {
                const urlPath = key.substring(separatorIndex + 1);
                statsData.push({
                  timeWindow: new Date(prevWindow),
                  urlPath: urlPath,
                  requestCount: parseInt(count, 10),
                });
              }
            }
          }

          // 批量写入PostgreSQL（使用 upsert）
          if (statsData.length > 0) {
            for (const data of statsData) {
              await UrlRequestStats.upsert({
                timeWindow: data.timeWindow,
                urlPath: data.urlPath,
                requestCount: data.requestCount,
              });
            }
            console.log(
              `[URL统计] ✅ 已写入 ${statsData.length} 条记录到PostgreSQL (窗口: ${prevWindow})`
            );
          }

          // 删除Redis中上一个窗口的数据
          if (keys.length > 0) {
            await redisClient.del(keys);
            console.log(`[URL统计] ✅ 已删除Redis中的 ${keys.length} 个key`);
          }
        } catch (error) {
          console.error("[URL统计] ❌ 处理失败:", error);
        }
      })(),
    ]);

    // 4. 清理超过20分钟的Redis数据
    const now = new Date();
    const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000);
    const oldWindows = [];
    for (let i = 0; i < 20; i++) {
      const oldWindow = new Date(twentyMinutesAgo.getTime() - i * 5 * 60 * 1000);
      oldWindows.push(get5MinWindow(oldWindow));
    }

    let versionCleanedCount = 0;
    let urlCleanedCount = 0;

    for (const oldWindow of oldWindows) {
      const versionPattern = `version_stats:${oldWindow}:*`;
      const urlPattern = `url_stats:${oldWindow}|*`;
      
      const [versionKeys, urlKeys] = await Promise.all([
        redisClient.keys(versionPattern),
        redisClient.keys(urlPattern),
      ]);

      if (versionKeys.length > 0) {
        await redisClient.del(versionKeys);
        versionCleanedCount += versionKeys.length;
      }
      if (urlKeys.length > 0) {
        await redisClient.del(urlKeys);
        urlCleanedCount += urlKeys.length;
      }
    }

    if (versionCleanedCount > 0 || urlCleanedCount > 0) {
      console.log(
        `[统计数据清理] ✅ 已清理 ${versionCleanedCount} 个版本统计Redis key，${urlCleanedCount} 个URL统计Redis key（超过20分钟）`
      );
    }
  } catch (error) {
    console.error("[统计数据] ❌ 定时任务执行失败:", error);
  }
}

// 清理10天前的PostgreSQL统计数据（版本统计 + URL统计，每天执行一次）
async function cleanupOldStats() {
  try {
    const { Op } = require("sequelize");
    const tenDaysAgo = new Date();
    tenDaysAgo.setUTCDate(tenDaysAgo.getUTCDate() - 10);
    tenDaysAgo.setUTCHours(0, 0, 0, 0);

    // 并行清理两个表
    const [versionDeletedCount, urlDeletedCount] = await Promise.all([
      VersionRequestStats.destroy({
        where: {
          timeWindow: {
            [Op.lt]: tenDaysAgo,
          },
        },
      }),
      UrlRequestStats.destroy({
        where: {
          timeWindow: {
            [Op.lt]: tenDaysAgo,
          },
        },
      }),
    ]);

    console.log(
      `[统计数据清理] ✅ 已清理 ${versionDeletedCount} 条版本统计数据，${urlDeletedCount} 条URL统计数据（10天前）`
    );
  } catch (error) {
    console.error("[统计数据清理] ❌ 清理旧数据失败:", error);
  }
}

(async () => {
  try {
    // 初始化PostgreSQL
    await setupPostgres();
    console.log("✅ PostgreSQL 连接成功");

    // 连接Redis
    await redisClient.connect();
    console.log("✅ Redis 连接成功");

    // 启动备份服务
    await pgBackupService.start();
    console.log("单例任务服务运行中...（备份/日志清理等）");

    // 立即执行一次清理
    cleanupPm2Logs();

    // 每 4 小时执行一次：0 */4 * * *
    schedule.scheduleJob("0 */4 * * *", cleanupPm2Logs);

    // 统计数据定时任务：每5分钟执行一次（版本统计 + URL统计）
    schedule.scheduleJob("*/5 * * * *", flushStats);

    // 清理旧数据：每天凌晨2点执行（UTC时间，对应北京时间10点）
    schedule.scheduleJob("0 2 * * *", cleanupOldStats);

    console.log("✅ 统计数据定时任务已启动（每5分钟执行一次，处理版本统计和URL统计）");
    console.log("✅ 统计数据清理任务已启动（每天执行一次，清理版本统计和URL统计）");
  } catch (err) {
    console.error("单例任务进程启动失败:", err);
    process.exit(1);
  }
})();
