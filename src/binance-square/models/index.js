const fs = require("fs");
const path = require("path");

/**
 * 初始化币安广场模型
 * @param {Sequelize} sequelize —— 复用 rootdatapro 的 sequelize 实例
 * @returns {Object} db —— 包含所有模型的对象
 */
function initModels(sequelize) {
  const db = {};

  // 自动加载当前目录下的所有模型文件（排除 index.js）
  fs.readdirSync(__dirname)
    .filter((file) => {
      return (
        file.indexOf(".") !== 0 && file !== "index.js" && file.slice(-3) === ".js"
      );
    })
    .forEach((file) => {
      const modelFactory = require(path.join(__dirname, file));
      const model = modelFactory(sequelize);
      db[model.name] = model;
    });

  // 定义关联关系
  // 用户 ↔ 关注关系（谁关注了别人）
  db.BinanceSquareUser.hasMany(db.BinanceSquareFollowing, {
    foreignKey: "followerUsername",
    sourceKey: "username",
    as: "Followings",
  });

  // 用户 ↔ 帖子
  db.BinanceSquareUser.hasMany(db.BinanceSquarePost, {
    foreignKey: "username",
    sourceKey: "username",
    as: "Posts",
  });

  // 帖子 ↔ 镜像
  db.BinanceSquarePost.hasMany(db.BinanceSquarePostSnapshot, {
    foreignKey: "postId",
    sourceKey: "postId",
    as: "Snapshots",
  });

  return db;
}

module.exports = initModels;
