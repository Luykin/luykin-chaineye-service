const path = require("path");
const fs = require("fs");

// 加载环境变量（优先使用 .env-pro，然后 .env-dev，最后 .env）
const envProFile = path.join(__dirname, "../../.env-pro");
const envDevFile = path.join(__dirname, "../../.env-dev");
const envFile = path.join(__dirname, "../../.env");

if (fs.existsSync(envProFile)) {
  require("dotenv").config({ path: envProFile });
  console.log("📝 使用 .env-pro 配置文件");
} else if (fs.existsSync(envDevFile)) {
  require("dotenv").config({ path: envDevFile });
  console.log("📝 使用 .env-dev 配置文件");
} else if (fs.existsSync(envFile)) {
  require("dotenv").config({ path: envFile });
  console.log("📝 使用 .env 配置文件");
} else {
  require("dotenv").config();
  console.log("📝 尝试默认环境变量配置");
}

const fsPromises = fs.promises;
const {
  pgInstance: sequelize,
  XHuntUser,
  DailyActiveUser,
  setupPostgres,
} = require(path.resolve(__dirname, "../models/postgres-start"));

/**
 * 迁移历史DAU数据
 * 1. 先处理 XHuntUser 表，使用 createdAt 作为首次活跃日期
 * 2. 再处理 dau-all-users.json，未在 DailyActiveUser 中的用户写入 2025-10-12
 */
async function migrateDauHistory() {
  try {
    console.log("🚀 开始迁移历史DAU数据...");
    await setupPostgres();
    console.log("✅ 数据库连接成功\n");

    let totalProcessed = 0;
    let totalCreated = 0;
    let totalSkipped = 0;

    // ==================== 第一步：处理 XHuntUser 表 ====================
    console.log("📊 第一步：处理 XHuntUser 表（使用真实的注册时间）");
    console.log("─".repeat(60));

    const xhuntUsers = await XHuntUser.findAll({
      attributes: ["id", "username", "createdAt"],
      raw: true,
    });

    console.log(`🔍 找到 ${xhuntUsers.length} 个 XHuntUser 用户\n`);

    for (const user of xhuntUsers) {
      totalProcessed++;

      // ⚠️ 跳过没有 username 的用户
      if (!user.username) {
        console.warn(`⚠️  跳过没有 username 的用户: id=${user.id}`);
        totalSkipped++;
        continue;
      }

      // 检查是否已经有 DailyActiveUser 记录
      const existingRecord = await DailyActiveUser.findOne({
        where: { userId: user.username }, // 🔥 使用 username，不是 id
      });

      if (existingRecord) {
        totalSkipped++;
        if (totalProcessed % 500 === 0) {
          console.log(
            `⏭️  已处理 ${totalProcessed}/${xhuntUsers.length}，跳过 ${totalSkipped} 个已有记录的用户`
          );
        }
        continue;
      }

      // 使用 createdAt 作为首次活跃日期
      const firstActiveDate = user.createdAt.toISOString().split("T")[0];

      await DailyActiveUser.create({
        userId: user.username, // 🔥 关键修复：使用 username 而不是 id
        date: firstActiveDate,
      });

      totalCreated++;

      if (totalCreated % 100 === 0) {
        console.log(
          `✅ 已创建 ${totalCreated} 条记录（用户: ${user.username}, 日期: ${firstActiveDate}）`
        );
      }
    }

    console.log(`\n✅ XHuntUser 处理完成：`);
    console.log(`   - 总用户数: ${xhuntUsers.length}`);
    console.log(`   - 新增记录: ${totalCreated}`);
    console.log(`   - 跳过用户: ${totalSkipped}`);
    console.log("─".repeat(60));
    console.log();

    // ==================== 第二步：处理 dau-all-users.json ====================
    console.log(
      "📊 第二步：处理 dau-all-users.json（补充历史数据到 2025-10-12）"
    );
    console.log("─".repeat(60));

    const dauFilePath = path.resolve(
      __dirname,
      "../../data/dau-backups/dau-all-users.json"
    );

    let dauData;
    try {
      const fileContent = await fsPromises.readFile(dauFilePath, "utf8");
      dauData = JSON.parse(fileContent);
    } catch (error) {
      console.error("❌ 读取 dau-all-users.json 失败:", error.message);
      console.log("⚠️  跳过第二步，完成已有的迁移");
      process.exit(0);
    }

    console.log(
      `🔍 找到 ${dauData.totalUniqueUsers} 个用户（来自 ${
        dauData.sourceDates?.length || 0
      } 个日期）\n`
    );

    const FALLBACK_DATE = "2025-10-12"; // 历史数据归档日
    let dauProcessed = 0;
    let dauCreated = 0;
    let dauSkipped = 0;

    for (const userId of dauData.users) {
      dauProcessed++;

      // 检查是否已经有 DailyActiveUser 记录
      const existingRecord = await DailyActiveUser.findOne({
        where: { userId },
      });

      if (existingRecord) {
        dauSkipped++;
        if (dauProcessed % 500 === 0) {
          console.log(
            `⏭️  已处理 ${dauProcessed}/${dauData.totalUniqueUsers}，跳过 ${dauSkipped} 个已有记录的用户`
          );
        }
        continue;
      }

      // 写入历史归档日期 2025-10-12
      await DailyActiveUser.create({
        userId: userId,
        date: FALLBACK_DATE,
      });

      dauCreated++;

      if (dauCreated % 100 === 0) {
        console.log(
          `✅ 已创建 ${dauCreated} 条记录（用户: ${userId.substring(
            0,
            20
          )}..., 日期: ${FALLBACK_DATE}）`
        );
      }
    }

    console.log(`\n✅ dau-all-users.json 处理完成：`);
    console.log(`   - 总用户数: ${dauData.totalUniqueUsers}`);
    console.log(`   - 新增记录: ${dauCreated}`);
    console.log(`   - 跳过用户: ${dauSkipped}`);
    console.log("─".repeat(60));
    console.log();

    // ==================== 总结 ====================
    console.log("🎉 迁移完成！总结：");
    console.log(`   - XHuntUser 新增: ${totalCreated} 条`);
    console.log(`   - dau-all-users.json 新增: ${dauCreated} 条`);
    console.log(
      `   - 总计新增: ${totalCreated + dauCreated} 条 DailyActiveUser 记录`
    );
    console.log();

    process.exit(0);
  } catch (error) {
    console.error("❌ 迁移失败:", error);
    process.exit(1);
  }
}

migrateDauHistory();

// 运行方式：
// node ./src/script/migrate-dau-history.js
//
// 脚本会自动按优先级查找配置文件：
// 1. .env-pro
// 2. .env-dev
// 3. .env
