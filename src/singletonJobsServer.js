require("dotenv").config({
  path: `${process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro"}`,
});

const { enhanceConsoleWithRequestId } = require("./xhunt/utils/request-id");
enhanceConsoleWithRequestId();

const schedule = require("node-schedule");
const redis = require("redis");

// 将所有需要单实例运行的定时任务集中到这里启动（备份、日志清理等）
const pgBackupService = require("./services/pg-backup-service");
const {
  setupPostgres,
  pgInstance,
  VersionRequestStats,
  UrlRequestStats,
  XhuntAdminManager,
} = require("./models/postgres-start");
const { requestStatsManager } = require("./xhunt/middleware/security");
const { initPerfMonitor } = require("./lib/perf-monitor"); // 性能监控模块
const { recordGenericStat } = require("./xhunt/services/generic-stats-service");
const emailService = require("./services/emailService");
const { cleanupPm2Logs } = require("./services/singleton/pm2-log-cleaner");
const {
  createRequestStatsMaintenance,
} = require("./services/singleton/request-stats-maintenance");
const {
  createBackendHealthChecker,
} = require("./services/singleton/backend-health-checker");

// 初始化 Redis 客户端
const redisClient = redis.createClient({
  socket: {
    host: "127.0.0.1",
    port: 6379,
  },
});

(async () => {
  try {
    // 初始化PostgreSQL
    await setupPostgres();
    console.log("✅ PostgreSQL 连接成功");

    // 连接Redis
    await redisClient.connect();
    console.log("✅ Redis 连接成功");

    // --- Performance Monitor Initialization ---
    const { processor: perfProcessor } = initPerfMonitor({
      redisClient: redisClient,
      enabled: process.env.PERF_MONITOR_ENABLED !== "false",
      logSuccess: process.env.PERF_MONITOR_LOG_SUCCESS === "true",
      maxQueueLength: parseInt(process.env.PERF_MONITOR_MAX_QUEUE_LENGTH || "5000", 10),
      trimQueueToLength: parseInt(process.env.PERF_MONITOR_TRIM_QUEUE_TO_LENGTH || "1000", 10),
      trace: {
        sampleRate: parseFloat(process.env.PERF_MONITOR_TRACE_SAMPLE_RATE || "0.03"),
        slowThresholdMs: parseInt(process.env.PERF_MONITOR_SLOW_THRESHOLD_MS || "500", 10),
        retentionHours: parseInt(process.env.PERF_MONITOR_RETENTION_HOURS || "30", 10),
        indexAllRequests: process.env.PERF_MONITOR_INDEX_ALL_REQUESTS === "true",
      },
      metrics: {
        timeWindowSecs: 60,
        retentionHours: parseInt(process.env.PERF_MONITOR_RETENTION_HOURS || "30", 10),
      },
    });

    setInterval(() => {
      perfProcessor
        .run()
        .catch((err) =>
          console.error("[perf-monitor] Processor job failed:", err)
        );
    }, 5000);
    console.log(
      "✅ Performance monitor processor job started (every 5 seconds)."
    );
    // --- End Performance Monitor ---

    const requestStatsMaintenance = createRequestStatsMaintenance({
      redisClient,
      requestStatsManager,
      VersionRequestStats,
      UrlRequestStats,
    });

    const backendHealthChecker = createBackendHealthChecker({
      redisClient,
      pgInstance,
      XhuntAdminManager,
      emailService,
      recordGenericStat,
    });


    // 启动备份服务
    await pgBackupService.start();
    console.log("单例任务服务运行中...（备份/日志清理等）");

    // 立即执行一次清理
    cleanupPm2Logs();

    // 每 4 小时执行一次：0 */4 * * *
    schedule.scheduleJob("0 */4 * * *", cleanupPm2Logs);

    // 统计数据定时任务：每5分钟执行一次（版本统计 + URL统计）
    schedule.scheduleJob("*/5 * * * *", requestStatsMaintenance.flushStats);

    // 清理旧数据：每天凌晨2点执行（UTC时间，对应北京时间10点）
    schedule.scheduleJob("0 2 * * *", requestStatsMaintenance.cleanupOldStats);

    // 后端健康自检测：每 30 分钟执行一次，仅在发现风险时给超级管理员发送邮件
    schedule.scheduleJob("*/30 * * * *", backendHealthChecker.run);

    // 币安广场爬虫已迁移到独立进程/独立服务器：src/binanceSquareCrawlerServer.js

    console.log(
      "✅ 统计数据定时任务已启动（每5分钟执行一次，处理版本统计和URL统计）"
    );
    console.log(
      "✅ 统计数据清理任务已启动（每天执行一次，清理版本统计和URL统计）"
    );
    console.log("✅ 后端健康自检测任务已启动（每30分钟执行一次）");

  } catch (err) {
    console.error("单例任务进程启动失败:", err);
    process.exit(1);
  }
})();
