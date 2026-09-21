const { pgInstance, setupPostgres } = require("./connection");
const { initModels } = require("./registry");
const { setupAllAssociations } = require("./associations");

// 初始化所有模型
const models = initModels(pgInstance);

// 建立各业务域模型关联关系
setupAllAssociations(models);

module.exports = {
  // 数据库初始化
  setupPostgres,

  // 数据库实例
  pgInstance,

  // 所有模型实例
  ...models,
};
