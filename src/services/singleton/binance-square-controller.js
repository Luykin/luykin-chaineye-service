const initBinanceSquareModels = require("../../binance-square/models");
const { BinanceSquareScheduler } = require("../../binance-square/services/scheduler");
const { BinanceSquareTaskManager } = require("../../binance-square/scraper/taskManager");

const BS_SCHEDULER_KEY = "binance_square:scheduler:control";

function createBinanceSquareController({ redisClient, pgInstance }) {
  let bsScheduler = null;

  async function check() {
    try {
      const changedConfigKey = await redisClient.get("binance_square:config:changed");
      if (changedConfigKey && bsScheduler?.configService) {
        bsScheduler.configService.clearCache(changedConfigKey);
        console.log(`[BinanceSquare] 配置缓存已清除: ${changedConfigKey}`);
        await redisClient.del("binance_square:config:changed");
      }

      const control = await redisClient.get(BS_SCHEDULER_KEY);

      if (control === "start") {
        if (!bsScheduler) {
          try {
            const bsDb = initBinanceSquareModels(pgInstance);
            const taskManager = new BinanceSquareTaskManager(bsDb);
            bsScheduler = new BinanceSquareScheduler(bsDb, taskManager);
            console.log("[BinanceSquare] 调度器实例已创建");
          } catch (e) {
            console.error("[BinanceSquare] ❌ 创建调度器失败:", e.message);
            return;
          }
        }
        if (!bsScheduler.isRunning) {
          await bsScheduler.start();
          console.log("[BinanceSquare] ✅ 调度器已启动");
        } else {
          const status = await bsScheduler.getStatus();
          const nextTime = status.nextIncrementalCrawl
            ? new Date(status.nextIncrementalCrawl)
            : null;
          const now = new Date();
          if (!nextTime || nextTime.getTime() < now.getTime() - 5 * 60 * 1000) {
            console.warn(
              `[BinanceSquare] ⚠️ 调度器健康检查异常，下次增量触发时间=${
                nextTime?.toISOString() || "无"
              }，即将重启`
            );
            bsScheduler.stop();
            await bsScheduler.start();
            console.log("[BinanceSquare] ✅ 调度器已重启");
          }
        }
      } else if (control === "stop") {
        if (bsScheduler && bsScheduler.isRunning) {
          bsScheduler.stop();
          console.log("[BinanceSquare] ⏸️ 调度器已停止");
        }
      }
    } catch (e) {
      console.error("[BinanceSquare] ❌ 调度器检查失败:", e.message);
    }
  }

  function startControlLoop(intervalMs = 30000) {
    check();
    setInterval(check, intervalMs);
    console.log("✅ 币安广场调度器控制已启动（每30秒轮询 Redis）");
  }

  return {
    check,
    startControlLoop,
  };
}

module.exports = {
  createBinanceSquareController,
};
