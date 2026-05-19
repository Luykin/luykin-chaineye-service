const { scanKeys, deleteKeysInChunks } = require("../../lib/redisClient");

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

function createRequestStatsMaintenance({
  redisClient,
  requestStatsManager,
  VersionRequestStats,
  UrlRequestStats,
}) {
  async function flushStats() {
    try {
      console.log(`
⏰ [${new Date().toISOString()}] 开始执行统计数据定时任务...`);

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

      const prevWindow = getPrev5MinWindow();

      await Promise.all([
        (async () => {
          try {
            const pattern = `version_stats:${prevWindow}:*`;
            const keys = await scanKeys(redisClient, pattern);

            if (keys.length === 0) {
              console.log(`[版本统计] 上一个窗口 ${prevWindow} 没有数据，跳过`);
              return;
            }

            const statsData = [];
            for (const key of keys) {
              const count = await redisClient.get(key);
              if (count) {
                const version = key.split(":").pop();
                statsData.push({
                  timeWindow: new Date(prevWindow),
                  version,
                  requestCount: parseInt(count, 10),
                });
              }
            }

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

            if (keys.length > 0) {
              await deleteKeysInChunks(redisClient, keys);
              console.log(`[版本统计] ✅ 已删除Redis中的 ${keys.length} 个key`);
            }
          } catch (error) {
            console.error("[版本统计] ❌ 处理失败:", error);
          }
        })(),
        (async () => {
          try {
            const pattern = `url_stats:${prevWindow}|*`;
            const keys = await scanKeys(redisClient, pattern);

            if (keys.length === 0) {
              console.log(`[URL统计] 上一个窗口 ${prevWindow} 没有数据，跳过`);
              return;
            }

            const statsData = [];
            for (const key of keys) {
              const count = await redisClient.get(key);
              if (count) {
                const separatorIndex = key.indexOf("|");
                if (separatorIndex > 0) {
                  const urlPath = key.substring(separatorIndex + 1);
                  statsData.push({
                    timeWindow: new Date(prevWindow),
                    urlPath,
                    requestCount: parseInt(count, 10),
                  });
                }
              }
            }

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

            if (keys.length > 0) {
              await deleteKeysInChunks(redisClient, keys);
              console.log(`[URL统计] ✅ 已删除Redis中的 ${keys.length} 个key`);
            }
          } catch (error) {
            console.error("[URL统计] ❌ 处理失败:", error);
          }
        })(),
      ]);

      const now = new Date();
      const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000);
      const oldWindows = [];
      for (let i = 0; i < 20; i++) {
        const oldWindow = new Date(
          twentyMinutesAgo.getTime() - i * 5 * 60 * 1000
        );
        oldWindows.push(get5MinWindow(oldWindow));
      }

      let versionCleanedCount = 0;
      let urlCleanedCount = 0;

      for (const oldWindow of oldWindows) {
        const versionPattern = `version_stats:${oldWindow}:*`;
        const urlPattern = `url_stats:${oldWindow}|*`;

        const [versionKeys, urlKeys] = await Promise.all([
          scanKeys(redisClient, versionPattern),
          scanKeys(redisClient, urlPattern),
        ]);

        if (versionKeys.length > 0) {
          await deleteKeysInChunks(redisClient, versionKeys);
          versionCleanedCount += versionKeys.length;
        }
        if (urlKeys.length > 0) {
          await deleteKeysInChunks(redisClient, urlKeys);
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

  async function cleanupOldStats() {
    try {
      const { Op } = require("sequelize");
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
      sevenDaysAgo.setUTCHours(0, 0, 0, 0);

      const [versionDeletedCount, urlDeletedCount] = await Promise.all([
        VersionRequestStats.destroy({
          where: {
            timeWindow: {
              [Op.lt]: sevenDaysAgo,
            },
          },
        }),
        UrlRequestStats.destroy({
          where: {
            timeWindow: {
              [Op.lt]: sevenDaysAgo,
            },
          },
        }),
      ]);

      console.log(
        `[统计数据清理] ✅ 已清理 ${versionDeletedCount} 条版本统计数据，${urlDeletedCount} 条URL统计数据（7天前）`
      );
    } catch (error) {
      console.error("[统计数据清理] ❌ 清理旧数据失败:", error);
    }
  }

  return {
    flushStats,
    cleanupOldStats,
  };
}

module.exports = {
  createRequestStatsMaintenance,
};
