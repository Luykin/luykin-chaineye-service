/**
 * 从 luykindatabase2 旧表（e2e_list, e2e, e2e_log, e2e_tweet）只读导入主库 EchohuntE2eLists / EchohuntE2eRecords / EchohuntE2eLogs / EchohuntE2eTweets
 * 用法：
 *   node src/echohunt/e2e/scripts/importFromDb2.js
 * 可选环境变量：
 *   PG2_DATABASE=luykindatabase2 PG2_USERNAME=luykin2 PG2_PASSWORD=xxx
 */

const { Sequelize, QueryTypes } = require("sequelize");
const { ensureEnvLoaded } = require("../../../utils/load-env");
ensureEnvLoaded();

const {
  pgInstance,
  E2eList,
  E2eRecord,
  E2eLog,
  E2eTweet,
} = require("../../../models/postgres-start");
const dbAdminService = require("../../../admin/db-admin/service");

async function createSourceDbConnection() {
  // 若通过后台 DB Admin 配置过 luykindatabase2 账号密码（保存在 Redis 中），也可以直接通过环境变量或 DB Admin 连接
  const dialectOptions = {};
  if (process.env.PG_SSL === "true") {
    dialectOptions.ssl = {
      require: true,
      rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false",
    };
  }
  return new Sequelize({
    dialect: process.env.PG_DIALECT || "postgres",
    host: process.env.PG2_HOST || process.env.PG_HOST,
    port: parseInt(process.env.PG2_PORT || process.env.PG_PORT || "5432", 10),
    database: process.env.PG2_DATABASE || "luykindatabase2",
    username: process.env.PG2_USERNAME || process.env.PG_USERNAME || "luykin2",
    password: process.env.PG2_PASSWORD || process.env.PG_PASSWORD,
    logging: false,
    timezone: "+00:00",
    dialectOptions,
  });
}

async function runImport() {
  const sourceDb = await createSourceDbConnection();
  try {
    await pgInstance.authenticate();
    await sourceDb.authenticate();
    console.log("✅ 已连接主库 (luykindatabase) 与源库 (luykindatabase2)");

    const [tweetRows, listRows, recordRows, logRows] = await Promise.all([
      sourceDb.query("SELECT * FROM public.e2e_tweet", { type: QueryTypes.SELECT }),
      sourceDb.query("SELECT * FROM public.e2e_list", { type: QueryTypes.SELECT }),
      sourceDb.query("SELECT * FROM public.e2e", { type: QueryTypes.SELECT }),
      sourceDb.query("SELECT * FROM public.e2e_log", { type: QueryTypes.SELECT }),
    ]);

    console.log(
      `📦 从 luykindatabase2 读取到: e2e_tweet=${tweetRows.length}, e2e_list=${listRows.length}, e2e=${recordRows.length}, e2e_log=${logRows.length}`
    );

    if (tweetRows.length) {
      await E2eTweet.bulkCreate(tweetRows, {
        updateOnDuplicate: [
          "text",
          "summary_cn",
          "summary_en",
          "owner_handle",
          "owner_image_url",
          "owner_user_id",
          "political",
          "sexual",
          "violence",
          "abusive",
          "explanation",
          "passed",
          "html",
        ],
      });
      console.log(`✅ 已同步 e2e_tweet: ${tweetRows.length} 条`);
    }

    if (listRows.length) {
      await E2eList.bulkCreate(listRows, {
        updateOnDuplicate: [
          "tweet_id",
          "user_id",
          "rewards",
          "start_time",
          "end_time",
          "target",
          "winners",
          "text",
          "summary_cn",
          "summary_en",
          "owner_handle",
          "owner_image_url",
          "owner_user_id",
          "status",
          "complete_tx",
          "type",
          "fees",
          "lang",
          "retro",
        ],
      });
      console.log(`✅ 已同步 e2e_list: ${listRows.length} 条`);
    }

    if (recordRows.length) {
      await E2eRecord.bulkCreate(recordRows, {
        updateOnDuplicate: [
          "tweet_id",
          "fan_rank",
          "username",
          "name",
          "point",
          "profile_image_url",
          "rewards",
          "user_address",
          "create_time",
          "update_time",
          "explaination",
        ],
      });
      console.log(`✅ 已同步 e2e: ${recordRows.length} 条`);
    }

    if (logRows.length) {
      await E2eLog.bulkCreate(logRows, {
        ignoreDuplicates: true,
      });
      console.log(`✅ 已同步 e2e_log: ${logRows.length} 条`);
    }

    console.log("🎉 历史数据从 luykindatabase2 导入 luykindatabase 完成！");
  } finally {
    await sourceDb.close().catch(() => {});
    await pgInstance.close().catch(() => {});
  }
}

if (require.main === module) {
  runImport().catch((error) => {
    console.error("❌ 导入失败:", error.message || error);
    process.exit(1);
  });
}

module.exports = {
  runImport,
};
