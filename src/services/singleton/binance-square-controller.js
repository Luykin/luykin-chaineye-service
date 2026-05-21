const initBinanceSquareModels = require("../../binance-square/models");
const { BinanceSquareScheduler } = require("../../binance-square/services/scheduler");
const { BinanceSquareTaskManager } = require("../../binance-square/scraper/taskManager");

const BS_SCHEDULER_KEY = "binance_square:scheduler:control";
const BS_POST_COMMAND_KEY = "binance_square:task:command:post";

function createBinanceSquareController({ redisClient, pgInstance }) {
  let bsDb = null;
  let taskManager = null;
  let bsScheduler = null;
  let isChecking = false;

  function ensureTaskManager() {
    if (!taskManager) {
      bsDb = bsDb || initBinanceSquareModels(pgInstance);
      taskManager = new BinanceSquareTaskManager(bsDb);
      console.log("[BinanceSquare] 任务管理器实例已创建");
    }
    return taskManager;
  }

  function ensureScheduler() {
    if (!bsScheduler) {
      const manager = ensureTaskManager();
      bsScheduler = new BinanceSquareScheduler(bsDb, manager);
      console.log("[BinanceSquare] 调度器实例已创建");
    }
    return bsScheduler;
  }

  async function consumePostCommand() {
    const rawCommand = await redisClient.get(BS_POST_COMMAND_KEY);
    if (!rawCommand) return;

    // 先删除命令，避免长任务期间被下一轮重复消费；执行状态通过 progress/log 查看。
    await redisClient.del(BS_POST_COMMAND_KEY);

    let command;
    try {
      command = JSON.parse(rawCommand);
    } catch (e) {
      console.warn(`[BinanceSquare] 帖子抓取命令解析失败: ${e.message}`);
      return;
    }

    const options = command?.options || {};
    const requestedBy = command?.requestedBy || "unknown";
    console.log(`[BinanceSquare] 收到帖子抓取命令 requestId=${command?.requestId || "-"} requestedBy=${requestedBy}`);

    const manager = ensureTaskManager();
    try {
      const result = await manager.runPostCrawl({
        ...options,
        skipIfRunning: true,
        enforceCooldown: false,
      });
      if (result?.status === "skipped") {
        console.log(`[BinanceSquare] 帖子抓取命令跳过: ${result.reason}`);
      } else {
        console.log(`[BinanceSquare] 帖子抓取命令完成 snapshotId=${result?.snapshotId || "-"} status=${result?.status || "-"}`);
      }
    } catch (e) {
      console.error("[BinanceSquare] ❌ 帖子抓取命令执行失败:", e.message);
      try {
        await ensureTaskManager().db.BinanceSquareCrawlLog.create({
          taskType: "post",
          status: "failed",
          targetId: "manual_command",
          itemsCount: 0,
          durationMs: 0,
          failedDetails: {
            command,
            error: e.message,
            stack: e.stack,
          },
        });
      } catch (logError) {
        console.warn("[BinanceSquare] 写入失败日志失败:", logError.message);
      }
    }
  }

  async function check() {
    if (isChecking) {
      console.log("[BinanceSquare] 上一轮检查仍在执行，跳过本轮");
      return;
    }
    isChecking = true;

    try {
      const changedConfigKey = await redisClient.get("binance_square:config:changed");
      if (changedConfigKey) {
        if (bsScheduler?.configService) {
          bsScheduler.configService.clearCache(changedConfigKey);
          console.log(`[BinanceSquare] 配置缓存已清除: ${changedConfigKey}`);
        }
        await redisClient.del("binance_square:config:changed");
      }

      // 手动帖子抓取命令：即使定时调度处于 stop，也允许独立爬虫服务消费执行。
      await consumePostCommand();

      const control = await redisClient.get(BS_SCHEDULER_KEY);

      if (control === "start") {
        let scheduler;
        try {
          scheduler = ensureScheduler();
        } catch (e) {
          console.error("[BinanceSquare] ❌ 创建调度器失败:", e.message);
          return;
        }

        if (!scheduler.isRunning) {
          await scheduler.start();
          console.log("[BinanceSquare] ✅ 调度器已启动");
        } else {
          const status = await scheduler.getStatus();
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
            scheduler.stop();
            await scheduler.start();
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
    } finally {
      isChecking = false;
    }
  }

  function startControlLoop(intervalMs = 30000) {
    check();
    setInterval(check, intervalMs);
    console.log(`✅ 币安广场独立爬虫控制已启动（每${Math.round(intervalMs / 1000)}秒轮询 Redis）`);
  }

  return {
    check,
    startControlLoop,
  };
}

module.exports = {
  createBinanceSquareController,
  BS_POST_COMMAND_KEY,
};
