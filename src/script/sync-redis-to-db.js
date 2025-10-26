const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");

// 加载环境变量
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

const redis = require("redis");
const { setupPostgres, DailyActiveUser } = require("../models/postgres-start");

/**
 * 从Redis同步今日DAU数据到PostgreSQL
 */
async function syncRedisToDb() {
  console.log("🚀 开始同步Redis数据到数据库");

  try {
    // 初始化Redis连接
    const redisClient = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: parseInt(process.env.REDIS_PORT) || 6379,
      },
    });

    redisClient.on("error", (err) => console.log("Redis Client Error", err));
    await redisClient.connect();
    console.log("✅ Redis连接成功");

    // 初始化数据库连接
    console.log("📊 正在同步数据库结构...");
    await setupPostgres();
    console.log("✅ 数据库结构同步完成");

    // 获取今天的日期（北京时间）
    const today = new Date().toISOString().split("T")[0];

    console.log(`📅 开始同步 ${today} 的数据`);

    // 从Redis读取今日DAU数据
    const dauKey = `dau:${today}`;
    const dauMembers = await redisClient.sMembers(dauKey);

    if (!dauMembers || dauMembers.length === 0) {
      console.log(`⚠️  Redis中没有找到 ${today} 的DAU数据`);
      process.exit(0);
    }

    console.log(`✅ 从Redis读取到 ${dauMembers.length} 条记录`);

    // 准备批量插入数据
    const recordsToInsert = [];
    for (const member of dauMembers) {
      // Redis中的格式是 "fingerprint,xUserId"
      const parts = member.split(",");
      const userId = parts.length > 1 ? parts[1] : parts[0]; // 使用 xUserId 或 fingerprint

      recordsToInsert.push({
        userId: userId,
        date: today,
      });
    }

    console.log(`📝 准备批量插入 ${recordsToInsert.length} 条记录到数据库...`);

    // 使用 bulkCreate 批量插入
    const result = await DailyActiveUser.bulkCreate(recordsToInsert, {
      ignoreDuplicates: true, // 如果记录已存在则忽略
      validate: true,
    });

    console.log(`\n✅ 数据同步完成！`);
    console.log(`📊 从Redis读取: ${dauMembers.length} 条`);
    console.log(`💾 已插入数据库: ${result.length} 条新记录`);

    // 显示数据库中的总记录数
    const totalCount = await DailyActiveUser.count();
    console.log(`\n💾 数据库中总记录数: ${totalCount}`);

    // 关闭Redis连接
    await redisClient.disconnect();
    console.log("✅ Redis连接已关闭");

    process.exit(0);
  } catch (error) {
    console.error("❌ 数据同步失败:", error);
    process.exit(1);
  }
}

// 执行同步
syncRedisToDb();
