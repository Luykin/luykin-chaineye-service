const { Sequelize } = require("sequelize");
const FundraisingModel = require("./fundraising");

// 复用统一的 Sequelize 实例，避免重复创建连接
const { pgInstance } = require("./postgres-start");

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
