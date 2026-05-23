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
        comment: "是否为最终目标用户(finalTop1000)",
      },
      followScore: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: "被关注分数（当前目标rankSet来源用户关注次数）",
      },
      targetRank: {
        type: DataTypes.INTEGER,
        comment: "最终目标用户排名（finalTop1000）",
      },
      targetRankSet: {
        type: DataTypes.STRING(32),
        comment: "最终目标用户所属rankSet，一般为top1000",
      },
      lastCrawledAt: {
        type: DataTypes.DATE,
        comment: "最后抓取时间 —— 帖子抓取时更新，关注同步时不更新",
      },
      lastFollowingSyncedAt: {
        type: DataTypes.DATE,
        comment: "最后同步关注列表时间",
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
      aiOneLineIntro: {
        type: DataTypes.TEXT,
        comment: "AI生成的一句话用户介绍（兼容旧字段，展示优先使用aiOneLineIntroI18n）",
      },
      aiOneLineIntroI18n: {
        type: DataTypes.JSONB,
        comment: "AI生成的一句话用户介绍多语言内容，例如 { zh, en }",
      },
      aiIntroStatus: {
        type: DataTypes.STRING(32),
        comment: "AI介绍生成状态：pending/running/success/failed/skipped",
      },
      aiIntroModel: {
        type: DataTypes.STRING(128),
        comment: "AI介绍生成使用的大模型",
      },
      aiIntroPromptVersion: {
        type: DataTypes.STRING(64),
        comment: "AI介绍生成使用的Prompt版本",
      },
      aiIntroInputHash: {
        type: DataTypes.STRING(64),
        comment: "AI介绍生成输入内容hash，用于判断是否需要重算",
      },
      aiIntroGeneratedAt: {
        type: DataTypes.DATE,
        comment: "AI介绍生成时间",
      },
      aiIntroError: {
        type: DataTypes.TEXT,
        comment: "AI介绍生成失败原因",
      },
      aiIntroDetails: {
        type: DataTypes.JSONB,
        comment: "AI介绍生成元数据，例如帖子数量、输入长度、任务ID等",
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
        { fields: ["targetRankSet", "targetRank"], name: "idx_binance_square_users_target_rankset_rank" },
        { fields: ["lastFollowingSyncedAt"], name: "idx_binance_square_users_last_following_synced" },
      ],
    }
  );
};
