const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");

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
const { setupPostgres, DailyActiveUser } = require("../models/postgres-start");

/**
 * 数据迁移脚本：将 dau-all-users.json 的历史数据导入到数据库
 * 标记所有历史用户为昨天活跃
 */
async function migrateDauHistory() {
  console.log("🚀 开始数据迁移：从dau-all-users.json导入历史数据");

  try {
    // 初始化数据库连接（会自动创建不存在的表）
    console.log("📊 正在同步数据库结构（如果表不存在会自动创建）...");
    await setupPostgres();
    console.log("✅ 数据库结构同步完成");

    // 验证 DailyActiveUsers 表是否存在
    try {
      await DailyActiveUser.findOne({ limit: 1 });
      console.log("✅ DailyActiveUsers 表已存在");
    } catch (error) {
      console.error("❌ DailyActiveUsers 表创建失败:", error.message);
      throw error;
    }

    // 读取备份文件
    const backupFilePath = path.join(
      __dirname,
      "../../data/dau-backups/dau-all-users.json"
    );

    let backupData;
    try {
      const fileContent = await fsPromises.readFile(backupFilePath, "utf8");
      backupData = JSON.parse(fileContent);
      console.log(
        `✅ 成功读取备份文件，包含 ${backupData.users?.length || 0} 个用户`
      );
    } catch (error) {
      if (error.code === "ENOENT") {
        console.log("⚠️  备份文件不存在，跳过迁移");
        return;
      }
      throw error;
    }

    if (!backupData.users || backupData.users.length === 0) {
      console.log("ℹ️  备份文件中没有用户数据，跳过迁移");
      return;
    }

    // 将历史用户标记为 2025-10-17 活跃（真实 DAU 追踪从 10-18 开始）
    const historicalDate = "2025-10-17";

    console.log(`📅 将历史用户标记为 ${historicalDate} 活跃`);

    // 批量插入数据（优化性能）
    const batchSize = 1000; // 每次批量插入1000条
    let totalProcessed = 0;
    let errorCount = 0;

    for (let i = 0; i < backupData.users.length; i += batchSize) {
      const batch = backupData.users.slice(i, i + batchSize);

      try {
        // 准备批量插入的数据
        const recordsToInsert = batch.map((userId) => ({
          userId: userId,
          date: historicalDate,
        }));

        // 使用 bulkCreate 批量插入，ignoreDuplicates 会自动跳过已存在的记录
        const result = await DailyActiveUser.bulkCreate(recordsToInsert, {
          ignoreDuplicates: true, // 如果记录已存在则忽略，不会报错
          validate: true, // 验证数据
        });

        totalProcessed += batch.length;

        // 显示进度（每处理一批或到达末尾时显示）
        console.log(
          `📊 进度: ${totalProcessed}/${backupData.users.length} (${(
            (totalProcessed / backupData.users.length) *
            100
          ).toFixed(1)}%)`
        );
      } catch (error) {
        errorCount++;
        console.error(
          `❌ 批量插入失败（批次 ${i}-${i + batch.length - 1}）:`,
          error.message
        );

        // 如果批量插入失败，可以尝试逐条插入（降级策略）
        if (errorCount >= 3) {
          console.log("⚠️  批量插入失败次数过多，尝试逐条插入...");
          for (const userId of batch) {
            try {
              await DailyActiveUser.findOrCreate({
                where: {
                  userId: userId,
                  date: historicalDate,
                },
                defaults: {
                  userId: userId,
                  date: historicalDate,
                },
              });
            } catch (singleError) {
              console.error(`❌ 插入用户 ${userId} 失败:`, singleError.message);
            }
          }
        }
      }
    }

    console.log(`\n✅ 数据迁移完成！`);
    console.log(`📈 总计: ${backupData.users.length} 个用户`);
    console.log(`📊 处理完成: ${totalProcessed} 条记录`);
    if (errorCount > 0) {
      console.log(`⚠️  失败批次: ${errorCount} 个`);
    }

    // 显示数据库中的总记录数
    const totalCount = await DailyActiveUser.count();
    console.log(`\n💾 数据库中总记录数: ${totalCount}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ 数据迁移失败:", error);
    process.exit(1);
  }
}

// 执行迁移
migrateDauHistory();
