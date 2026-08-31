const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "EchohuntSocialListeningKeyEvent",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, comment: "用户关键事件 ID" },
      boardId: { type: DataTypes.UUID, allowNull: false, comment: "关联 EchohuntSocialListeningBoards.id" },
      authCenterUserId: { type: DataTypes.UUID, allowNull: false, comment: "事件所属 AuthCenter 用户 ID，用于用户隔离" },
      xhuntUserId: { type: DataTypes.UUID, allowNull: true, comment: "兼容关联旧 XHuntUsers.id" },
      tweetUrl: { type: DataTypes.TEXT, allowNull: false, comment: "用户录入的 X 帖子链接或标准化链接" },
      tweetId: { type: DataTypes.STRING(64), allowNull: false, comment: "关键事件关联 tweet id；同一用户同一看板唯一" },
      eventType: { type: DataTypes.STRING(64), allowNull: false, comment: "关键事件类型，由前端/产品枚举定义" },
      title: { type: DataTypes.STRING(255), allowNull: true, comment: "用户自定义事件标题" },
      authorTwitterId: { type: DataTypes.STRING(64), allowNull: true, comment: "事件帖子作者 Twitter user id 快照" },
      authorHandle: { type: DataTypes.STRING(128), allowNull: true, comment: "事件帖子作者 handle 快照" },
      authorName: { type: DataTypes.STRING(255), allowNull: true, comment: "事件帖子作者展示名快照" },
      authorAvatar: { type: DataTypes.TEXT, allowNull: true, comment: "事件帖子作者头像 URL 快照" },
      authorGlobalRank: { type: DataTypes.INTEGER, allowNull: true, comment: "事件帖子作者全球 KOL 排名快照" },
      eventAt: { type: DataTypes.DATE, allowNull: false, comment: "事件发生/帖子发布时间" },
      metadata: { type: DataTypes.JSONB, allowNull: true, comment: "事件扩展信息，例如备注、前端标签、原始解析结果" },
    },
    {
      tableName: "EchohuntSocialListeningKeyEvents",
      timestamps: true,
      indexes: [
        { name: "ux_echohunt_sl_events_board_user_tweet", fields: ["boardId", "authCenterUserId", "tweetId"], unique: true },
        { name: "idx_echohunt_sl_events_board_user_event_at", fields: ["boardId", "authCenterUserId", "eventAt"] },
      ],
    }
  );
};
