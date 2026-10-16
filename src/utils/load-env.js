const path = require("path");
const dotenv = require("dotenv");

const PROJECT_ROOT = path.resolve(__dirname, "../..");

/**
 * 加载项目根目录下的环境文件（优先按 NODE_ENV 选择 .env-dev 或 .env-pro；
 * 若未注入 PG_HOST/PG_PASSWORD，则回退尝试加载 .env-dev）。
 */
function ensureEnvLoaded() {
  if (!process.env.PG_HOST || !process.env.PG_PASSWORD) {
    const primaryEnvFile =
      process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro";
    dotenv.config({ path: path.join(PROJECT_ROOT, primaryEnvFile) });

    if (!process.env.PG_HOST || !process.env.PG_PASSWORD) {
      dotenv.config({ path: path.join(PROJECT_ROOT, ".env-dev") });
    }
  }
}

/**
 * 构建统一的 PostgreSQL Sequelize 连接配置
 * @param {{ defaultPort?: number, database?: string, logging?: boolean | Function }} options
 */
function buildPgConfig({
  defaultPort = 5432,
  database = process.env.PG_DATABASE,
  logging = false,
} = {}) {
  ensureEnvLoaded();

  const dialectOptions = {};
  if (process.env.PG_SSL === "true") {
    dialectOptions.ssl = {
      require: true,
      rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false",
    };
  }

  return {
    dialect: process.env.PG_DIALECT || "postgres",
    host: process.env.PG_HOST,
    port: process.env.PG_PORT
      ? parseInt(process.env.PG_PORT, 10)
      : defaultPort,
    database,
    username: process.env.PG_USERNAME,
    password: process.env.PG_PASSWORD,
    logging,
    timezone: "+00:00",
    dialectOptions,
  };
}

module.exports = {
  ensureEnvLoaded,
  buildPgConfig,
};
