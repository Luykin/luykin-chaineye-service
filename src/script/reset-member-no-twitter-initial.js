/*
  脚本目的：
  - 将所有满足条件的 Project（projectLink 包含 '/member' 且 twitterUrl 为空）
    的 detailFailuresNumber 置为 0，isInitial 置为 true
*/

const { Sequelize } = require("sequelize");

// 在脚本内直接初始化 PostgreSQL 连接（与其它脚本保持一致）
const pgInstance = new Sequelize({
  dialect: "postgres",
  host: process.env.PG_HOST || "150.5.158.179",
  port: parseInt(process.env.PG_PORT || "5432", 10),
  database: process.env.PG_DATABASE || "luykindatabase",
  username: process.env.PG_USERNAME || "luykin",
  password: process.env.PG_PASSWORD || "wtf.0813",
  logging: false,
  timezone: "+00:00",
});

async function main() {
  try {
    await pgInstance.authenticate();

    // 统计目标行数
    const [countRows] = await pgInstance.query(`
      SELECT COUNT(*)::int AS cnt
      FROM "Projects"
      WHERE "projectLink" LIKE '%/member%'
        AND ("twitterUrl" IS NULL OR btrim(COALESCE("twitterUrl", '')) = '')
    `);
    const total = countRows?.[0]?.cnt ?? 0;
    console.log(`[reset] 目标记录数: ${total}`);
    if (total === 0) {
      console.log("[reset] 无需处理，退出。");
      process.exit(0);
    }

    // 执行更新（仅更新需要变更的行，避免无意义写入）
    const updateSql = `
      UPDATE "Projects"
      SET "detailFailuresNumber" = 0,
          "isInitial" = TRUE
      WHERE "projectLink" LIKE '%/member%'
        AND ("twitterUrl" IS NULL OR btrim(COALESCE("twitterUrl", '')) = '')
        AND ("detailFailuresNumber" IS DISTINCT FROM 0 OR "isInitial" IS DISTINCT FROM TRUE)
    `;

    const [, meta] = await pgInstance.query(updateSql);
    const affected = meta?.rowCount ?? 0;
    console.log(`[reset] 实际更新记录数: ${affected}`);

    // 复查
    const [afterRows] = await pgInstance.query(`
      SELECT COUNT(*)::int AS cnt
      FROM "Projects"
      WHERE "projectLink" LIKE '%/member%'
        AND ("twitterUrl" IS NULL OR btrim(COALESCE("twitterUrl", '')) = '')
        AND ("detailFailuresNumber" IS DISTINCT FROM 0 OR "isInitial" IS DISTINCT FROM TRUE)
    `);
    const remain = afterRows?.[0]?.cnt ?? 0;
    console.log(`[reset] 仍需处理的记录数: ${remain}`);
  } catch (err) {
    console.error("[reset] 执行失败:", err);
    process.exitCode = 1;
  } finally {
    try { await pgInstance.close(); } catch (_) {}
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
