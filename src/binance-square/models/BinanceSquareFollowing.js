const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "BinanceSquareFollowing",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      followerUsername: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "关注者用户名（Seed/Top50/Top100/Top300扩展源）",
      },
      followerSquareUid: {
        type: DataTypes.STRING(64),
        comment: "关注者SquareUid —— 可能缺失",
      },
      followingUsername: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "被关注者用户名",
      },
      followingSquareUid: {
        type: DataTypes.STRING(64),
        comment: "被关注者SquareUid —— API返回，可能缺失",
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "当前关系是否仍有效 —— 每次同步关注列表后维护",
      },
      firstSeenAt: {
        type: DataTypes.DATE,
        comment: "首次发现该关注关系的时间",
      },
      lastSeenAt: {
        type: DataTypes.DATE,
        comment: "最近一次同步仍看到该关注关系的时间",
      },
      lastSyncRunId: {
        type: DataTypes.STRING(64),
        comment: "最近一次关注同步批次ID",
      },
    },
    {
      tableName: "BinanceSquareFollowings",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["followerUsername", "followingUsername"], name: "idx_binance_square_followings_unique" },
        { fields: ["followerUsername"], name: "idx_binance_square_followings_follower" },
        { fields: ["followingUsername"], name: "idx_binance_square_followings_following" },
        { fields: ["isActive", "followingUsername"], name: "idx_binance_square_followings_active_following" },
        { fields: ["followerUsername", "isActive"], name: "idx_binance_square_followings_follower_active" },
        { fields: ["lastSyncRunId"], name: "idx_binance_square_followings_sync_run" },
      ],
    }
  );
};
