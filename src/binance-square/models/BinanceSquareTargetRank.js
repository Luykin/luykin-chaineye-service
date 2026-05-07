const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "BinanceSquareTargetRank",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "目标用户用户名",
      },
      rank: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: "排名(1-50)",
      },
      followerCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: "被种子用户关注次数",
      },
      lastCalculatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: "最后计算时间",
      },
      seedFollowers: {
        type: DataTypes.JSONB,
        comment: "关注该用户的种子用户列表[{username,displayName}] —— 聚合时生成",
      },
    },
    {
      tableName: "BinanceSquareTargetRanks",
      timestamps: true,
      indexes: [
        { fields: ["rank"], name: "idx_binance_square_target_ranks_rank" },
        { fields: ["lastCalculatedAt"], name: "idx_binance_square_target_ranks_calc_time" },
      ],
    }
  );
};
