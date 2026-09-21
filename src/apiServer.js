// This line must come before importing any instrumented module.
// const tracer = require("dd-trace").init({
//   logInjection: true,
// });

require("dotenv").config({
  path: `${process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro"}`,
});
console.log(process.env.NODE_ENV, "process.env.NODE_ENV运行环境");

const {
  enhanceConsoleWithRequestId,
} = require("./xhunt/utils/request-id");

// 全局增强 console：注入 requestId，并做日志级别、限流、截断，降低 PM2 日志 IO 压力。
enhanceConsoleWithRequestId();

// ============================================
// 启动时模块预加载检查 - 防止运行时路径错误导致崩溃
// ============================================
const { preloadCriticalModules } = require("./apiServer/boot/preload");
preloadCriticalModules();

const express = require("express");
const { getRedisClient } = require("./lib/redisClient");
const { initPerfMonitor } = require("./lib/perf-monitor");
const { setupMiddlewares } = require("./apiServer/middlewares");
const { registerRoutes } = require("./apiServer/routes");
const { setupErrorHandlers } = require("./apiServer/middlewares/error-handler");
const { initDatabasesAndServices } = require("./apiServer/boot/services-init");

const app = express();
const PORT = process.env.PORT || 8090;

// 将 Express 应用的设置和启动逻辑封装在一个异步函数中
async function initializeAndStartServer() {
  let redisClient;
  try {
    // 首先获取 Redis 客户端
    redisClient = await getRedisClient();
    console.log("Redis 客户端已在 apiServer 中成功获取");

    // 全局暴露，便于旧模块兼容
    global.__xhuntRedis = redisClient;
  } catch (error) {
    console.error(
      "在 apiServer 中获取 Redis 客户端失败，服务器无法启动:",
      error
    );
    process.exit(1); // Redis 是关键依赖，获取失败则退出
  }

  // --- Performance Monitor Initialization ---
  const { middleware: perfMiddleware, apiRouter: perfApiRouter } =
    initPerfMonitor({
      redisClient: redisClient,
      enabled: process.env.PERF_MONITOR_ENABLED !== "false",
      logSuccess: process.env.PERF_MONITOR_LOG_SUCCESS === "true",
      // --- Data Extraction Config ---
      requestIdFrom: ["headers", "x-request-id"],
      userIdFrom: ["headers", "x-user-id"],
      collectDetailedInfo: {
        version: ["headers", "x-extension-version"],
        twId: ["headers", "x-tw-id"],
        ua: ["get", "user-agent"],
      },
      // --- Operational Config ---
      flushThreshold: parseInt(process.env.PERF_MONITOR_FLUSH_THRESHOLD || "100", 10),
      flushIntervalMs: parseInt(process.env.PERF_MONITOR_FLUSH_INTERVAL_MS || "5000", 10),
      maxBufferSize: parseInt(process.env.PERF_MONITOR_MAX_BUFFER_SIZE || "1000", 10),
      maxQueueLength: parseInt(process.env.PERF_MONITOR_MAX_QUEUE_LENGTH || "5000", 10),
      trimQueueToLength: parseInt(process.env.PERF_MONITOR_TRIM_QUEUE_TO_LENGTH || "1000", 10),
      dropOnFlushError: process.env.PERF_MONITOR_DROP_ON_FLUSH_ERROR !== "false",
      trace: {
        sampleRate: parseFloat(process.env.PERF_MONITOR_TRACE_SAMPLE_RATE || "0.03"),
        slowThresholdMs: parseInt(process.env.PERF_MONITOR_SLOW_THRESHOLD_MS || "500", 10),
        retentionHours: parseInt(process.env.PERF_MONITOR_RETENTION_HOURS || "30", 10),
        indexAllRequests: process.env.PERF_MONITOR_INDEX_ALL_REQUESTS === "true",
      },
      metrics: {
        timeWindowSecs: 60, // Aggregate metrics every minute
        retentionHours: parseInt(process.env.PERF_MONITOR_RETENTION_HOURS || "30", 10),
      },
    });

  // 1. 严格按顺序装配前置中间件
  setupMiddlewares(app, { redisClient, perfMiddleware });

  // 2. 注册业务与管理路由
  registerRoutes(app, { perfApiRouter });

  // 3. 错误处理与 404 兜底
  setupErrorHandlers(app);

  // 4. 初始化底层数据库连接与缓存服务
  await initDatabasesAndServices();

  // 5. 启动服务器监听
  app.listen(PORT, () => console.log(`API 服务器运行在端口 ${PORT}`));
}

// 启动服务器
initializeAndStartServer();
