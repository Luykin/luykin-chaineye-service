/**
 * 迁移脚本：添加 twitterUrl 字段并填充数据
 * 从 socialLinks.x 提取 Twitter 链接到独立字段
 */

const { Sequelize } = require("sequelize");
const FundraisingModel = require("../models/fundraising");

// 连接 PostgreSQL 数据库
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

const Fundraising = FundraisingModel(pgInstance);

async function migrateTwitterUrl() {
  try {
    console.log("🔌 连接 PostgreSQL 数据库...");
    await pgInstance.authenticate();
    console.log("✅ PostgreSQL 连接成功\n");

    // 1. 同步表结构（添加新字段和索引）
    console.log("📋 同步表结构（添加 twitterUrl 字段）...");
    await pgInstance.sync({ alter: true });
    console.log("✅ 表结构同步完成\n");

    // 2. 统计需要更新的记录
    console.log("📊 统计数据...");
    const totalCount = await pgInstance.query(
      `SELECT COUNT(*) as count 
       FROM "Projects" 
       WHERE "socialLinks" IS NOT NULL 
       AND "socialLinks"::text LIKE '%"x"%'`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    console.log(`   总共有 ${totalCount[0].count} 条记录包含 Twitter 链接\n`);

    // 3. 批量更新 twitterUrl 字段
    console.log("🔄 开始更新 twitterUrl 字段...");

    // 使用 PostgreSQL 的 JSON 函数批量更新
    const updateResult = await pgInstance.query(`
      UPDATE "Projects"
      SET "twitterUrl" = "socialLinks"::json->>'x'
      WHERE "socialLinks" IS NOT NULL 
      AND "socialLinks"::json->>'x' IS NOT NULL
      AND "socialLinks"::json->>'x' != ''
    `);

    console.log(`✅ 更新完成！影响 ${updateResult[1].rowCount} 条记录\n`);

    // 4. 验证结果
    console.log("🔍 验证更新结果...");
    const verifyCount = await pgInstance.query(
      `SELECT COUNT(*) as count 
       FROM "Projects" 
       WHERE "twitterUrl" IS NOT NULL`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    console.log(`   成功设置 twitterUrl 的记录数: ${verifyCount[0].count}`);

    // 5. 显示示例数据
    console.log("\n📝 示例数据（前 5 条）:");
    const samples = await pgInstance.query(
      `SELECT id, "projectName", "twitterUrl", "socialLinks"
       FROM "Projects" 
       WHERE "twitterUrl" IS NOT NULL
       LIMIT 5`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    samples.forEach((s, idx) => {
      console.log(`\n${idx + 1}. ${s.projectName}`);
      console.log(`   twitterUrl: ${s.twitterUrl}`);
      console.log(`   socialLinks.x: ${s.socialLinks?.x || "N/A"}`);
    });

    console.log("\n" + "=".repeat(60));
    console.log("✅ 迁移完成！");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ 迁移失败:", error);
    throw error;
  } finally {
    await pgInstance.close();
    console.log("\n🔌 数据库连接已关闭");
  }
}

// 执行迁移
if (require.main === module) {
  migrateTwitterUrl()
    .then(() => {
      console.log("\n✨ 所有操作完成");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 发生错误:", error);
      process.exit(1);
    });
}

module.exports = { migrateTwitterUrl };
