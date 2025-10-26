const fs = require("fs");
const path = require("path");
const redis = require("redis");

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
 * 修复 2025-10-25 的 DAU 数据
 * 1. 删除数据库中 2025-10-25 的所有数据
 * 2. 从 Redis 读取 2025-10-25, 2025-10-24, ... 直到没有数据
 * 3. 重新写入到数据库
 */
async function fixDauData() {
  console.log("🚀 开始修复 DAU 数据");

  const targetDate = "2025-10-25";

  try {
    // 初始化 Redis 连接
    const redisClient = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: parseInt(process.env.REDIS_PORT) || 6379,
      },
    });

    redisClient.on("error", (err) => console.log("Redis Client Error", err));
    await redisClient.connect();
    console.log("✅ Redis 连接成功");

    // 初始化数据库连接
    console.log("📊 正在同步数据库结构...");
    await setupPostgres();
    console.log("✅ 数据库结构同步完成");

    // 1. 删除数据库中 2025-10-25 的所有数据
    console.log(`\n🗑️  开始删除数据库中 ${targetDate} 的所有数据...`);
    const deletedCount = await DailyActiveUser.destroy({
      where: {
        date: targetDate,
      },
    });
    console.log(`✅ 已删除 ${deletedCount} 条记录`);

    // 2. 从 Redis 读取数据
    console.log("\n📖 开始从 Redis 读取历史数据...");

    let currentDate = targetDate;
    const dateObj = new Date(currentDate);
    const allRecords = [];

    // 往前读取直到没有数据
    while (true) {
      const dauKey = `dau:${currentDate}`;
      const dauMembers = await redisClient.sMembers(dauKey);

      if (!dauMembers || dauMembers.length === 0) {
        console.log(`⚠️  Redis 中没有 ${currentDate} 的数据，停止读取`);
        break;
      }

      console.log(
        `📊 从 Redis 读取 ${currentDate}: ${dauMembers.length} 条记录`
      );

      // 解析数据，只提取有 xUserId 的记录
      let validRecords = 0;
      for (const member of dauMembers) {
        // Redis 中的格式是 "fingerprint,xUserId"
        const parts = member.split(",");

        // 只提取有 xUserId 的记录（parts.length === 2 表示有 xUserId）
        if (parts.length === 2) {
          const userId = parts[1]; // 使用 xUserId
          allRecords.push({
            userId: userId,
            date: currentDate,
          });
          validRecords++;
        }
      }

      console.log(
        `✅ ${currentDate} 有效记录: ${validRecords}/${dauMembers.length}`
      );

      // 往前推一天
      dateObj.setDate(dateObj.getDate() - 1);
      currentDate = dateObj.toISOString().split("T")[0];
    }

    if (allRecords.length === 0) {
      console.log("⚠️  没有找到任何有效的历史数据");
      await redisClient.disconnect();
      process.exit(0);
    }

    console.log(`\n📊 准备写入数据库，共 ${allRecords.length} 条记录`);

    // 3. 按日期分组并批量写入数据库
    const recordsByDate = new Map();
    for (const record of allRecords) {
      if (!recordsByDate.has(record.date)) {
        recordsByDate.set(record.date, []);
      }
      recordsByDate.get(record.date).push(record);
    }

    const batchSize = 1000;
    let totalInserted = 0;

    // 按日期倒序处理（从最新的开始）
    const sortedDates = Array.from(recordsByDate.keys()).sort().reverse();

    for (const date of sortedDates) {
      const records = recordsByDate.get(date);
      console.log(`\n📅 正在处理 ${date}: ${records.length} 条记录`);

      // 按批次插入
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);

        try {
          await DailyActiveUser.bulkCreate(batch, {
            ignoreDuplicates: true,
            validate: true,
          });

          totalInserted += batch.length;
          console.log(
            `  ✅ 已处理 ${totalInserted}/${allRecords.length} (${(
              (totalInserted / allRecords.length) *
              100
            ).toFixed(1)}%)`
          );
        } catch (error) {
          console.error(`  ❌ 批量插入失败 (${date}):`, error.message);
        }
      }
    }

    console.log(`\n✅ 数据修复完成！`);
    console.log(`📊 总计处理: ${allRecords.length} 条记录`);
    console.log(`📊 实际插入: ${totalInserted} 条记录`);

    // 显示最终数据库中的记录数
    const totalCount = await DailyActiveUser.count();
    const targetDateCount = await DailyActiveUser.count({
      where: { date: targetDate },
    });
    console.log(`\n💾 数据库中总记录数: ${totalCount}`);
    console.log(`💾 ${targetDate} 的记录数: ${targetDateCount}`);

    // 关闭 Redis 连接
    await redisClient.disconnect();
    console.log("✅ Redis 连接已关闭");

    process.exit(0);
  } catch (error) {
    console.error("❌ 数据修复失败:", error);
    process.exit(1);
  }
}

// 执行修复
fixDauData();
