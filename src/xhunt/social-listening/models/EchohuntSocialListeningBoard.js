const { DataTypes, Op } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "EchohuntSocialListeningBoard",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "Social Listening 看板 ID，每个被监控官方 X 账号对应一个看板",
      },
      officialTwitterId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: "被监控官方账号的 Twitter user id；账号解析成功后写入",
      },
      officialHandle: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: "被监控官方账号 handle，去 @ 后统一小写；未删除看板内唯一",
      },
      projectName: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "项目或品牌展示名称，用于前台看板标题和 AI 项目态度输入",
      },
      projectDescription: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "项目简介快照，来自官方 X profile 或运营手动维护",
      },
      projectAvatar: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "项目头像 URL 快照，来自官方 X profile",
      },
      verified: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        comment: "官方账号认证状态快照，可能来自 verified 或 is_blue_verified",
      },
      followersCount: {
        type: DataTypes.BIGINT,
        allowNull: true,
        comment: "官方账号粉丝数快照",
      },
      globalRank: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "官方账号全球 KOL 排名快照；优先 feature.rank.kolRank",
      },
      cnRank: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "官方账号华语 KOL 排名快照；优先 feature.rank.kolCnRank",
      },
      brandColor: {
        type: DataTypes.STRING(32),
        allowNull: true,
        comment: "看板品牌色，十六进制或前端约定色值",
      },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "paused",
        comment: "看板状态：initializing/monitoring/paused/deleting/deleted/failed",
      },
      coverageStartAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "当前已覆盖的最早帖子发布时间，用于判断 7D/30D 历史是否完整",
      },
      processedThrough: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "后台任务已处理到的时间游标；增量任务从该时间附近重叠扫描",
      },
      lastSuccessAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "最近一次任务成功完成时间",
      },
      lastFailureAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "最近一次任务失败时间",
      },
      lastFailureReason: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "最近一次任务失败原因，前台/后台用于提示和排查",
      },
      createdByAdminId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "创建该看板的管理员 ID",
      },
      updatedByAdminId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "最近更新该看板配置的管理员 ID",
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: "扩展配置：keywords/aliases/token/notes/profileSnapshot/rankSource 等",
      },
    },
    {
      tableName: "EchohuntSocialListeningBoards",
      timestamps: true,
      indexes: [
        { name: "idx_echohunt_sl_boards_status", fields: ["status"] },
        { name: "idx_echohunt_sl_boards_processed_through", fields: ["processedThrough"] },
        {
          name: "ux_echohunt_sl_boards_active_twitter_id",
          fields: ["officialTwitterId"],
          unique: true,
          where: { officialTwitterId: { [Op.ne]: null }, status: { [Op.ne]: "deleted" } },
        },
      ],
    }
  );
};
