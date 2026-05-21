require("dotenv").config({
  path: `${process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro"}`,
});

const { enhanceConsoleWithRequestId } = require("./xhunt/utils/request-id");
enhanceConsoleWithRequestId();

const { setupPostgres, pgInstance } = require("./models/postgres-start");
const { getRedisClient } = require("./lib/redisClient");
const { createBinanceSquareController } = require("./services/singleton/binance-square-controller");

(async () => {
  try {
    await setupPostgres();
    console.log("✅ PostgreSQL 连接成功（币安广场独立爬虫）");

    const redisClient = await getRedisClient();
    console.log("✅ Redis 连接成功（币安广场独立爬虫）");

    const controller = createBinanceSquareController({ redisClient, pgInstance });
    const intervalMs = parseInt(process.env.BINANCE_SQUARE_CONTROL_INTERVAL_MS || "30000", 10);
    controller.startControlLoop(Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 30000);

    console.log("✅ 币安广场独立爬虫服务已启动");
  } catch (err) {
    console.error("币安广场独立爬虫服务启动失败:", err);
    process.exit(1);
  }
})();
