const { Sequelize } = require("sequelize");

// 与 test-pg-query.js 一致的连接方式（支持环境变量 + 默认值）
const pgInstance = new Sequelize({
  dialect: "postgres",
  host: process.env.PG_HOST || "150.5.158.179",
  port: parseInt(process.env.PG_PORT || "5432", 10),
  database: process.env.PG_DATABASE || "luykindatabase",
  username: process.env.PG_USERNAME || "luykin",
  password: process.env.PG_PASSWORD || "wtf.0813",
  logging: process.env.PG_LOGGING === "true" ? console.log : false,
  timezone: "+00:00",
});

async function getTopActiveUsers(days = 30, limit = 500) {
  await pgInstance.authenticate();
  // 近 N 天（含当日），联表 XHuntUsers 补齐字段
  const rows = await pgInstance.query(
    `SELECT
        u."username" AS handler,
        MIN(u."twitterId") AS twid,
        MIN(u."displayName") AS "displayName",
        MIN(u."avatar") AS avatar,
        MIN(u."createdAt") AS createdtime,
        (array_agg(u."evmAddresses"))[1] AS "evmAddresses",
        COUNT(d."date") AS activedays
     FROM "DailyActiveUsers" d
     JOIN "XHuntUsers" u ON u."username" = d."userId"
     WHERE d."date" >= CURRENT_DATE - (:days::int) * INTERVAL '1 day'
     GROUP BY u."username"
     ORDER BY activedays DESC, handler ASC
     LIMIT :limit`,
    { type: Sequelize.QueryTypes.SELECT, replacements: { days, limit } }
  );

  // 结果映射为 { handler: { activedays, twid, handler, displayName, avatar, createdtime, evmAddresses } }
  const result = {};
  for (const r of rows) {
    result[r.handler] = {
      activedays: Number(r.activedays),
      twid: r.twid || null,
      handler: r.handler,
      displayName: r.displayName || null,
      avatar: r.avatar || null,
      createdtime: r.createdtime,
      evmAddresses: r.evmAddresses ?? null,
    };
  }
  return result;
}

async function close() {
  try { await pgInstance.close(); } catch (_) {}
}

module.exports = { getTopActiveUsers, close, pgInstance };
