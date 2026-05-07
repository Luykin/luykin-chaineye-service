const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "BinanceSquareUser",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        comment: "自增主键",
      },
      username: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "用户名（如 CZ）—— 程序传入的查询key",
      },
      isSeedUser: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: "是否为种子用户",
      },
      isTargetUser: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: "是否为目标用户(Top50)",
      },
      followScore: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: "被关注分数（种子用户关注次数）",
      },
      lastCrawledAt: {
        type: DataTypes.DATE,
        comment: "最后抓取时间 —— 帖子抓取时更新，关注同步时不更新",
      },
      squareUid: {
        type: DataTypes.STRING(64),
        comment: "币安广场用户UID —— API返回，可能缺失",
      },
      displayName: {
        type: DataTypes.STRING(256),
        comment: "显示名称 —— API返回，可能缺失",
      },
      avatar: {
        type: DataTypes.TEXT,
        comment: "头像URL —— API返回，可能缺失",
      },
      biography: {
        type: DataTypes.TEXT,
        comment: "个人简介 —— API返回，可能缺失",
      },
      role: {
        type: DataTypes.INTEGER,
        comment: "角色标识 —— API返回，可能缺失",
      },
      verificationType: {
        type: DataTypes.INTEGER,
        comment: "认证类型 —— API返回，可能缺失",
      },
      verificationDescription: {
        type: DataTypes.STRING(256),
        comment: "认证描述 —— API返回，可能缺失",
      },
      totalFollowerCount: {
        type: DataTypes.INTEGER,
        comment: "粉丝总数 —— API返回，可能缺失",
      },
      totalFollowingCount: {
        type: DataTypes.INTEGER,
        comment: "关注总数 —— API返回，可能缺失",
      },
      totalPostCount: {
        type: DataTypes.INTEGER,
        comment: "帖子总数 —— API返回，可能缺失",
      },
      totalLikeCount: {
        type: DataTypes.INTEGER,
        comment: "获赞总数 —— API返回，可能缺失",
      },
      totalShareCount: {
        type: DataTypes.INTEGER,
        comment: "被分享总数 —— API返回，可能缺失",
      },
      accountLang: {
        type: DataTypes.STRING(16),
        comment: "账号语言 —— API返回，可能缺失",
      },
      isKol: {
        type: DataTypes.BOOLEAN,
        comment: "是否KOL —— API返回，可能缺失",
      },
      userStatus: {
        type: DataTypes.INTEGER,
        comment: "用户状态 —— API返回，可能缺失",
      },
      level: {
        type: DataTypes.INTEGER,
        comment: "用户等级 —— API返回，可能缺失",
      },
      rawData: {
        type: DataTypes.JSONB,
        comment: "原始API响应数据（完整备份）—— API异常时用于排查",
      },
    },
    {
      tableName: "BinanceSquareUsers",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["username"], name: "idx_binance_square_users_username_unique" },
        { fields: ["squareUid"], name: "idx_binance_square_users_square_uid" },
        { fields: ["isSeedUser"], name: "idx_binance_square_users_is_seed" },
        { fields: ["isTargetUser"], name: "idx_binance_square_users_is_target" },
        { fields: ["followScore"], name: "idx_binance_square_users_follow_score" },
        { fields: ["lastCrawledAt"], name: "idx_binance_square_users_last_crawled" },
      ],
    }
  );
};
