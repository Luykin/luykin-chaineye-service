/**
 * 清空定向合作（Business Collaboration）业务数据。
 *
 * 清理范围仅限以下 8 张定向合作表：
 * - BusinessCollaborationActivities
 * - BusinessCollaborationActivityAccesses
 * - BusinessCollaborationInvitations
 * - BusinessCollaborations
 * - BusinessCollaborationBudgetLedgers
 * - BusinessCollaborationAuditLogs
 * - BusinessCollaborationReviewRounds
 * - BusinessCollaborationDeliveries
 *
 * 明确不会清理：
 * - XHuntKolCollaborations（KOL 营销资料及默认收款地址）
 * - 任何 AuthCenter、XHuntUser、Admin 用户数据
 * - marketing_profiles 中的 collaboration_* 字段
 *
 * 默认仅预览各表记录数：
 *   NODE_ENV=production node src/script/clear-business-collaboration-data.js
 *
 * 真正执行（必须同时带确认口令）：
 *   NODE_ENV=production node src/script/clear-business-collaboration-data.js \
 *     --apply --confirm=DELETE_DIRECTIONAL_COLLABORATION_DATA
 *
 * 可用 CLEAR_BUSINESS_COLLABORATION_ENV_FILE 指定环境文件；未指定时开发环境使用
 * .env-dev，其余环境使用 .env-pro。
 */

const path = require("path");
const { Sequelize, QueryTypes } = require("sequelize");

const CONFIRMATION_TOKEN = "DELETE_DIRECTIONAL_COLLABORATION_DATA";

// 顺序由外键约束决定：先删最末端的交付、审核、账本和审计记录，再删主业务记录。
const TABLES_IN_DELETE_ORDER = [
  "BusinessCollaborationDeliveries",
  "BusinessCollaborationReviewRounds",
  "BusinessCollaborationBudgetLedgers",
  "BusinessCollaborationAuditLogs",
  "BusinessCollaborations",
  "BusinessCollaborationInvitations",
  "BusinessCollaborationActivityAccesses",
  "BusinessCollaborationActivities",
];

function loadEnv() {
  const envFile =
    process.env.CLEAR_BUSINESS_COLLABORATION_ENV_FILE ||
    (process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro");
  const result = require("dotenv").config({ path: path.resolve(process.cwd(), envFile) });

  if (result.error) {
    console.warn(`[clear-business-collaboration] unable to load ${envFile}: ${result.error.message}`);
  } else {
    console.log(`[clear-business-collaboration] loaded env: ${envFile}`);
  }
}

function getArgValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function createPgInstance() {
  const pgHost = process.env.PG_HOST;
  const pgPort = process.env.PG_PORT ? parseInt(process.env.PG_PORT, 10) : undefined;
  const pgDatabase = process.env.PG_DATABASE;
  const pgUsername = process.env.PG_USERNAME;
  const pgPassword = process.env.PG_PASSWORD;

  if (!pgHost || !pgDatabase || !pgUsername || !pgPassword) {
    throw new Error("PostgreSQL env incomplete: require PG_HOST, PG_DATABASE, PG_USERNAME, PG_PASSWORD");
  }

  const dialectOptions = {};
  if (process.env.PG_SSL === "true") {
    dialectOptions.ssl = {
      require: true,
      rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false",
    };
  }

  return new Sequelize({
    dialect: process.env.PG_DIALECT || "postgres",
    host: pgHost,
    port: pgPort,
    database: pgDatabase,
    username: pgUsername,
    password: pgPassword,
    logging: process.env.PG_LOGGING === "true",
    timezone: "+00:00",
    pool: { max: 3, min: 0, idle: 10000, acquire: 20000 },
    dialectOptions,
  });
}

async function getCounts(pgInstance, options = {}) {
  const counts = {};
  for (const tableName of TABLES_IN_DELETE_ORDER) {
    const [row] = await pgInstance.query(
      `SELECT COUNT(*)::int AS "count" FROM "${tableName}"`,
      { type: QueryTypes.SELECT, ...options }
    );
    counts[tableName] = row.count;
  }
  return counts;
}

function logCounts(title, counts) {
  console.log(`\n${title}`);
  let total = 0;
  for (const tableName of TABLES_IN_DELETE_ORDER) {
    const count = Number(counts[tableName] || 0);
    total += count;
    console.log(`  ${tableName}: ${count}`);
  }
  console.log(`  total: ${total}`);
}

async function main() {
  loadEnv();
  const pgInstance = createPgInstance();
  const apply = hasFlag("--apply");
  const confirmed = getArgValue("--confirm") === CONFIRMATION_TOKEN;

  try {
    await pgInstance.authenticate();
    const beforeCounts = await getCounts(pgInstance);
    logCounts("定向合作表当前记录数：", beforeCounts);

    if (!apply || !confirmed) {
      console.log("\n这是预览模式，未删除任何数据。");
      console.log(
        `如确认清空上述定向合作表，请执行：--apply --confirm=${CONFIRMATION_TOKEN}`
      );
      return;
    }

    const deletedCounts = await pgInstance.transaction(async (transaction) => {
      const result = {};
      for (const tableName of TABLES_IN_DELETE_ORDER) {
        const [, metadata] = await pgInstance.query(`DELETE FROM "${tableName}"`, { transaction });
        result[tableName] = metadata.rowCount;
      }
      return result;
    });

    logCounts("\n已删除记录数：", deletedCounts);
    const afterCounts = await getCounts(pgInstance);
    logCounts("\n删除后记录数：", afterCounts);
    console.log("\n定向合作业务数据已清空；未触碰其他业务表。");
  } finally {
    await pgInstance.close();
  }
}

main().catch((error) => {
  console.error("[clear-business-collaboration] failed:", error.message);
  process.exitCode = 1;
});
