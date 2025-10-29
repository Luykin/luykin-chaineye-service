const { Sequelize } = require("sequelize");
const FundraisingModel = require("./fundraising");

// 连接 PostgreSQL 数据库（添加默认值，与迁移脚本保持一致）
const pgInstance = new Sequelize({
  dialect: "postgres",
  host: process.env.PG_HOST || "150.5.158.179",
  port: parseInt(process.env.PG_PORT || "5432", 10),
  database: process.env.PG_DATABASE || "luykindatabase",
  username: process.env.PG_USERNAME || "luykin",
  password: process.env.PG_PASSWORD || "wtf.0813",
  logging: process.env.PG_LOGGING === "true",
  timezone: "+00:00",
});

// 初始化 Fundraising 模型
const Fundraising = FundraisingModel(pgInstance);

// 测试连接
async function setupPostgresFundraising() {
  try {
    await pgInstance.authenticate();
    console.log("PostgreSQL Fundraising connection established.");
    await pgInstance.sync({ alter: false });
    console.log("PostgreSQL Fundraising synchronized.");
  } catch (error) {
    console.error("PostgreSQL Fundraising setup error:", error);
    throw error;
  }
}

module.exports = {
  Fundraising,
  setupPostgresFundraising,
  pgInstance,
};
