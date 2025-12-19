/*
  一次性修复脚本：
  - 仅修复包含 "/member/detail" 的 projectLink
  - 将所有出现的 "/member/detail" 统一替换为 "/member"
*/

const { pgInstance } = require("../models/postgres-fundraising");

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

    // 单步替换：将任意位置出现的 /member/detail 替换为 /member
    const updateSql = `
      UPDATE "Projects"
      SET "projectLink" = replace("projectLink", '/member/detail', '/member')
      WHERE "projectLink" LIKE '%/member/detail%'
    `;

    const [, meta] = await pgInstance.query(updateSql);
    const affected = meta?.rowCount ?? 0;
    console.log(`[fix] 实际修复记录数: ${affected}`);

    // 复查
    const [afterRows] = await pgInstance.query(`
      SELECT COUNT(*)::int AS cnt
      FROM "Projects"
      WHERE "projectLink" LIKE '%/member/detail%'
    `);
    const remain = afterRows?.[0]?.cnt ?? 0;
    console.log(`[fix] 修复后仍需处理的记录数: ${remain}`);
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
