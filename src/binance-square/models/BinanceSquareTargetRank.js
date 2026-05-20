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
      rankSet: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "top50",
        comment: "排名集合：top50/top100/top300/top1000",
      },
      rank: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: "当前rankSet内排名",
      },
      followerCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: "被来源用户关注次数",
      },
      sourceRankSet: {
        type: DataTypes.STRING(32),
        comment: "来源集合：seed/top50/top100/top300",
      },
      sourceUserCount: {
        type: DataTypes.INTEGER,
        comment: "本次计算使用的来源用户数量",
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
      sourceFollowers: {
        type: DataTypes.JSONB,
        comment: "关注该用户的来源用户列表[{username,displayName}] —— 聚合时生成",
      },
      includedRankSets: {
        type: DataTypes.JSONB,
        comment: "该用户命中的层级集合，例如['top50','top100']",
      },
      calculationRunId: {
        type: DataTypes.STRING(64),
        comment: "目标用户计算批次ID",
      },
    },
    {
      tableName: "BinanceSquareTargetRanks",
      timestamps: true,
      indexes: [
        { fields: ["rank"], name: "idx_binance_square_target_ranks_rank" },
        { fields: ["rankSet", "rank"], name: "idx_binance_square_target_ranks_rankset_rank" },
        { unique: true, fields: ["rankSet", "username"], name: "idx_binance_square_target_ranks_rankset_username_unique" },
        { fields: ["lastCalculatedAt"], name: "idx_binance_square_target_ranks_calc_time" },
        { fields: ["calculationRunId"], name: "idx_binance_square_target_ranks_calc_run" },
      ],
    }
  );
};
