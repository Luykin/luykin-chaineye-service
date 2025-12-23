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
  // 近 N 天（含当日），按用户活跃天数倒序
  const rows = await pgInstance.query(
    `SELECT "userId", COUNT(*) AS active_days
     FROM "DailyActiveUsers"
     WHERE "date" >= CURRENT_DATE - INTERVAL '${days} day'
     GROUP BY "userId"
     ORDER BY active_days DESC, "userId" ASC
     LIMIT ${limit}`,
    { type: Sequelize.QueryTypes.SELECT }
  );

  // 转换为 { username: days } 的对象
  const result = {};
  for (const r of rows) {
    // COUNT(*) 返回字符串或数字，统一转为 Number
    result[r.userId] = Number(r.active_days);
  }
  return result;
}

async function close() {
  try { await pgInstance.close(); } catch (_) {}
}

module.exports = { getTopActiveUsers, close, pgInstance };
