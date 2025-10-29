/**
 * 迁移脚本（SQLite 版本）：添加 twitterUrl 字段并填充数据
 * 从 socialLinks.x 提取 Twitter 链接到独立字段
 */

const { Sequelize } = require("sequelize");
const FundraisingModel = require("../models/fundraising");

// 连接 SQLite 数据库
const sqliteInstance = new Sequelize({
  dialect: "sqlite",
  storage: "./database.sqlite",
  logging: false,
});

const Fundraising = FundraisingModel(sqliteInstance);

async function migrateTwitterUrlSQLite() {
  try {
    console.log("🔌 连接 SQLite 数据库...");
    await sqliteInstance.authenticate();
    console.log("✅ SQLite 连接成功\n");

    // 1. 同步表结构（添加新字段）
    console.log("📋 同步表结构（添加 twitterUrl 字段）...");
    await sqliteInstance.sync({ alter: true });
    console.log("✅ 表结构同步完成\n");

    // 2. 获取所有有 socialLinks 的项目
    console.log("📊 读取需要更新的数据...");
    const projects = await Fundraising.Project.findAll({
      where: {
        socialLinks: {
          [Sequelize.Op.ne]: null,
        },
      },
      raw: false, // 需要实例对象才能使用 update
    });

    console.log(`   找到 ${projects.length} 条记录\n`);

    // 3. 逐条更新（SQLite 不支持 JSON 操作符，需要在应用层处理）
    console.log("🔄 开始更新 twitterUrl 字段...");
    let updatedCount = 0;

    for (const project of projects) {
      try {
        const socialLinks = project.socialLinks;

        // 支持多种可能的 key
        const possibleKeys = ["x", "X", "twitter", "Twitter"];
        let twitterUrl = null;

        for (const key of possibleKeys) {
          if (socialLinks && socialLinks[key]) {
            twitterUrl = socialLinks[key];
            break;
          }
        }

        if (twitterUrl && twitterUrl !== project.twitterUrl) {
          await project.update({ twitterUrl });
          updatedCount++;

          if (updatedCount % 100 === 0) {
            console.log(`   已更新 ${updatedCount}/${projects.length} 条记录`);
          }
        }
      } catch (error) {
        console.error(`   ❌ 更新失败 (ID: ${project.id}):`, error.message);
      }
    }

    console.log(`✅ 更新完成！成功更新 ${updatedCount} 条记录\n`);

    // 4. 验证结果
    console.log("🔍 验证更新结果...");
    const verifyCount = await Fundraising.Project.count({
      where: {
        twitterUrl: {
          [Sequelize.Op.ne]: null,
        },
      },
    });
    console.log(`   成功设置 twitterUrl 的记录数: ${verifyCount}`);

    // 5. 显示示例数据
    console.log("\n📝 示例数据（前 5 条）:");
    const samples = await Fundraising.Project.findAll({
      where: {
        twitterUrl: {
          [Sequelize.Op.ne]: null,
        },
      },
      limit: 5,
      raw: true,
    });

    samples.forEach((s, idx) => {
      console.log(`\n${idx + 1}. ${s.projectName}`);
      console.log(`   twitterUrl: ${s.twitterUrl}`);
      const socialLinks =
        typeof s.socialLinks === "string"
          ? JSON.parse(s.socialLinks)
          : s.socialLinks;
      console.log(`   socialLinks.x: ${socialLinks?.x || "N/A"}`);
    });

    console.log("\n" + "=".repeat(60));
    console.log("✅ 迁移完成！");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ 迁移失败:", error);
    throw error;
  } finally {
    await sqliteInstance.close();
    console.log("\n🔌 数据库连接已关闭");
  }
}

// 执行迁移
if (require.main === module) {
  migrateTwitterUrlSQLite()
    .then(() => {
      console.log("\n✨ 所有操作完成");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 发生错误:", error);
      process.exit(1);
    });
}

module.exports = { migrateTwitterUrlSQLite };
