/*
  一次性修复脚本：
  - 仅修复包含 "/member/detail" 的 projectLink
  - 将所有出现的 "/member/detail" 统一替换为 "/member"
*/

const { Sequelize } = require("sequelize");

// 在脚本内直接初始化 PostgreSQL 连接（与 fix-phyrex-investments.js 保持一致）
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

    const [countRows] = await pgInstance.query(`
      SELECT COUNT(*)::int AS cnt
      FROM "Projects"
      WHERE "projectLink" LIKE '%/member/detail%'
    `);
    const toFix = countRows?.[0]?.cnt ?? 0;
    console.log(`[fix] 待修复记录数: ${toFix}`);
    if (toFix === 0) {
      console.log("[fix] 无需修复，退出。");
      process.exit(0);
    }

    // 统计会产生唯一键冲突的记录数量
    const [conflictCountRows] = await pgInstance.query(`
      SELECT COUNT(*)::int AS cnt
      FROM "Projects" p
      WHERE p."projectLink" LIKE '%/member/detail%'
        AND EXISTS (
          SELECT 1 FROM "Projects" x
          WHERE x."projectLink" = replace(p."projectLink", '/member/detail', '/member')
            AND x.id <> p.id
        )
    `);
    const conflict = conflictCountRows?.[0]?.cnt ?? 0;
    console.log(`[fix] 可能产生唯一键冲突的记录数: ${conflict}`);

    // 单步替换：将任意位置出现的 /member/detail 替换为 /member
    // 仅更新不会与现有记录冲突的行
    const updateSql = `
      WITH candidates AS (
        SELECT id, replace("projectLink", '/member/detail', '/member') AS new_link
        FROM "Projects"
        WHERE "projectLink" LIKE '%/member/detail%'
      ), safe AS (
        SELECT c.id, c.new_link
        FROM candidates c
        LEFT JOIN "Projects" p2
          ON p2."projectLink" = c.new_link AND p2.id <> c.id
        WHERE p2.id IS NULL
      )
      UPDATE "Projects" p
      SET "projectLink" = s.new_link
      FROM safe s
      WHERE p.id = s.id
    `;

    const [, meta] = await pgInstance.query(updateSql);
    const affected = meta?.rowCount ?? 0;
    console.log(`[fix] 实际修复记录数: ${affected}`);

    // 合并仍然冲突的记录（同一 canonical 链接存在多个 Project）
    console.log("[fix] 开始处理冲突合并...");
    const [groups] = await pgInstance.query(`
      SELECT canonical_link
      FROM (
        SELECT replace("projectLink", '/member/detail', '/member') AS canonical_link
        FROM "Projects"
        WHERE "projectLink" LIKE '%/member%'
      ) t
      GROUP BY canonical_link
      HAVING COUNT(*) > 1
    `);

    for (const g of groups) {
      const canonical = g.canonical_link;
      const [rows] = await pgInstance.query(
        `SELECT id, "projectLink", "twitterUrl", "createdAt" FROM "Projects"
         WHERE replace("projectLink", '/member/detail', '/member') = :canonical
         ORDER BY "createdAt" ASC`,
        { replacements: { canonical } }
      );

      if (!rows || rows.length < 2) continue;

      // 选择保留项：优先有 twitterUrl，其次创建时间最早
      const withTwitter = rows.filter(r => r.twitterUrl && String(r.twitterUrl).trim() !== "");
      const keeper = (withTwitter.length > 0 ? withTwitter : rows)[0];
      const keeperId = keeper.id;
      const losers = rows.filter(r => r.id !== keeperId);

      // 事务处理每个冲突组
      await pgInstance.transaction(async (t) => {
        for (const loser of losers) {
          const loserId = loser.id;

          // InvestmentRelationships: investor 侧 - 先删除将产生重复的，再更新
          await pgInstance.query(
            `DELETE FROM "InvestmentRelationships" ir
             USING "InvestmentRelationships" other
             WHERE ir."investorProjectId" = :loserId
               AND other."investorProjectId" = :keeperId
               AND other."fundedProjectId" = ir."fundedProjectId"
               AND COALESCE(other."round", '--') = COALESCE(ir."round", '--')`,
            { transaction: t, replacements: { loserId, keeperId } }
          );
          await pgInstance.query(
            `UPDATE "InvestmentRelationships"
             SET "investorProjectId" = :keeperId
             WHERE "investorProjectId" = :loserId`,
            { transaction: t, replacements: { loserId, keeperId } }
          );

          // InvestmentRelationships: funded 侧 - 先删除将产生重复的，再更新
          await pgInstance.query(
            `DELETE FROM "InvestmentRelationships" ir
             USING "InvestmentRelationships" other
             WHERE ir."fundedProjectId" = :loserId
               AND other."fundedProjectId" = :keeperId
               AND other."investorProjectId" = ir."investorProjectId"
               AND COALESCE(other."round", '--') = COALESCE(ir."round", '--')`,
            { transaction: t, replacements: { loserId, keeperId } }
          );
          await pgInstance.query(
            `UPDATE "InvestmentRelationships"
             SET "fundedProjectId" = :keeperId
             WHERE "fundedProjectId" = :loserId`,
            { transaction: t, replacements: { loserId, keeperId } }
          );

          // PositionRelationships: subject 侧 - 先删除将产生重复的，再更新
          await pgInstance.query(
            `DELETE FROM "PositionRelationships" pr
             USING "PositionRelationships" other
             WHERE pr."subjectProjectId" = :loserId
               AND other."subjectProjectId" = :keeperId
               AND other."objectProjectId" = pr."objectProjectId"
               AND other."position" IS NOT DISTINCT FROM pr."position"`,
            { transaction: t, replacements: { loserId, keeperId } }
          );
          await pgInstance.query(
            `UPDATE "PositionRelationships"
             SET "subjectProjectId" = :keeperId
             WHERE "subjectProjectId" = :loserId`,
            { transaction: t, replacements: { loserId, keeperId } }
          );

          // PositionRelationships: object 侧 - 先删除将产生重复的，再更新
          await pgInstance.query(
            `DELETE FROM "PositionRelationships" pr
             USING "PositionRelationships" other
             WHERE pr."objectProjectId" = :loserId
               AND other."objectProjectId" = :keeperId
               AND other."subjectProjectId" = pr."subjectProjectId"
               AND other."position" IS NOT DISTINCT FROM pr."position"`,
            { transaction: t, replacements: { loserId, keeperId } }
          );
          await pgInstance.query(
            `UPDATE "PositionRelationships"
             SET "objectProjectId" = :keeperId
             WHERE "objectProjectId" = :loserId`,
            { transaction: t, replacements: { loserId, keeperId } }
          );

          // 删除 loser 项目
          await pgInstance.query(
            `DELETE FROM "Projects" WHERE id = :loserId`,
            { transaction: t, replacements: { loserId } }
          );
        }

        // 确保保留项的链接为 canonical
        await pgInstance.query(
          `UPDATE "Projects" SET "projectLink" = :canonical
           WHERE id = :keeperId AND "projectLink" <> :canonical`,
          { transaction: t, replacements: { canonical, keeperId } }
        );
      });

      console.log(`[fix] 合并完成 canonical=${canonical}，保留 id=${keeperId}，删除 ${losers.length} 条`);
    }

    // 复查
    const [afterRows] = await pgInstance.query(`
      SELECT COUNT(*)::int AS cnt
      FROM "Projects"
      WHERE "projectLink" LIKE '%/member/detail%'
    `);
    const remain = afterRows?.[0]?.cnt ?? 0;
    console.log(`[fix] 修复后仍需处理的记录数: ${remain}（其中包含上述冲突的 ${conflict} 条）`);
  } catch (err) {
    console.error("[fix] 执行失败:", err);
    process.exitCode = 1;
  } finally {
    try { await pgInstance.close(); } catch (_) {}
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
