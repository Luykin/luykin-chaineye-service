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

const { DailyActiveUser, setupPostgres } = require(path.resolve(
  __dirname,
  "../models/postgres-start"
));

/**
 * 清理错误的DAU数据
 * 删除 userId 是 UUID 格式（带有连字符的）的记录
 * 正确的 userId 应该是 Twitter username（字符串，不包含连字符）
 */
async function cleanupWrongDauData() {
  try {
    console.log("🧹 开始清理错误的DAU数据...");
    await setupPostgres();
    console.log("✅ 数据库连接成功\n");

    // 获取所有 DailyActiveUser 记录
    const allRecords = await DailyActiveUser.findAll({
      attributes: ["id", "userId", "date"],
      raw: true,
    });

    console.log(`📊 共找到 ${allRecords.length} 条 DailyActiveUser 记录\n`);

    // UUID 格式的正则表达式
    // 格式: 8-4-4-4-12 (例如: 7f628545-f3bc-4f71-a50d-204cf166f523)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const wrongRecords = [];
    const correctRecords = [];

    for (const record of allRecords) {
      if (uuidRegex.test(record.userId)) {
        wrongRecords.push(record);
      } else {
        correctRecords.push(record);
      }
    }

    console.log("📈 数据分析结果：");
    console.log(
      `   ✅ 正确的记录（username格式）: ${correctRecords.length} 条`
    );
    console.log(`   ❌ 错误的记录（UUID格式）: ${wrongRecords.length} 条\n`);

    if (wrongRecords.length === 0) {
      console.log("🎉 没有发现错误数据，无需清理！");
      process.exit(0);
    }

    // 显示一些样例
    console.log("❌ 错误记录样例（前10条）：");
    wrongRecords.slice(0, 10).forEach((record, index) => {
      console.log(
        `   ${index + 1}. userId: ${record.userId}, date: ${record.date}`
      );
    });
    console.log();

    console.log("⚠️  准备删除这些错误记录...");
    console.log("⏳ 开始删除...\n");

    // 批量删除错误记录
    const wrongIds = wrongRecords.map((r) => r.id);
    const deleteCount = await DailyActiveUser.destroy({
      where: {
        id: wrongIds,
      },
    });

    console.log(`✅ 删除完成！共删除 ${deleteCount} 条错误记录\n`);

    // 显示清理后的统计
    const remainingCount = await DailyActiveUser.count();
    console.log("📊 清理后的数据统计：");
    console.log(`   - 剩余记录: ${remainingCount} 条`);
    console.log(`   - 删除记录: ${deleteCount} 条`);
    console.log(`   - 预期剩余: ${correctRecords.length} 条`);

    if (remainingCount === correctRecords.length) {
      console.log("\n✅ 数据一致性检查通过！");
    } else {
      console.warn("\n⚠️  警告：数据数量不一致，请检查！");
    }

    console.log("\n🎉 清理完成！现在可以重新运行正确的迁移脚本。");
    process.exit(0);
  } catch (error) {
    console.error("❌ 清理失败:", error);
    process.exit(1);
  }
}

cleanupWrongDauData();

// 运行方式：
// node ./src/script/cleanup-wrong-dau-data.js
