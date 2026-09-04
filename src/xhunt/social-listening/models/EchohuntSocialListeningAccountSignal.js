const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "EchohuntSocialListeningAccountSignal",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, comment: "关键账号动态记录 ID" },
      boardId: { type: DataTypes.UUID, allowNull: false, comment: "关联 EchohuntSocialListeningBoards.id" },
      twitterId: { type: DataTypes.STRING(64), allowNull: false, comment: "动态相关账号 Twitter user id" },
      handle: { type: DataTypes.STRING(128), allowNull: true, comment: "动态相关账号 handle 快照" },
      name: { type: DataTypes.STRING(255), allowNull: true, comment: "动态相关账号展示名快照" },
      avatar: { type: DataTypes.TEXT, allowNull: true, comment: "动态相关账号头像 URL 快照" },
      followersCount: { type: DataTypes.BIGINT, allowNull: true, comment: "动态相关账号粉丝数快照" },
      globalRank: { type: DataTypes.INTEGER, allowNull: true, comment: "动态相关账号全球 KOL 排名快照" },
      cnRank: { type: DataTypes.INTEGER, allowNull: true, comment: "动态相关账号华语 KOL 排名快照" },
      signalType: { type: DataTypes.STRING(64), allowNull: false, comment: "动态类型：高排名提及/关注/取关等" },
      occurredAt: { type: DataTypes.DATE, allowNull: false, comment: "动态发生时间" },
      mentionCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, comment: "相关账号在窗口内提及次数" },
      viewsCount: { type: DataTypes.BIGINT, allowNull: true, comment: "相关帖子曝光量合计" },
      engagementCount: { type: DataTypes.BIGINT, allowNull: true, comment: "相关帖子互动量合计" },
      sentiment: { type: DataTypes.STRING(32), allowNull: true, comment: "相关动态主要情绪" },
      topics: { type: DataTypes.JSONB, allowNull: true, comment: "相关动态主题摘要" },
      postIds: { type: DataTypes.JSONB, allowNull: true, comment: "相关 Social Listening post id 或 tweet id 列表" },
      summaryZh: { type: DataTypes.TEXT, allowNull: true, comment: "动态中文摘要" },
      summaryEn: { type: DataTypes.TEXT, allowNull: true, comment: "动态英文摘要" },
      rankSnapshot: { type: DataTypes.JSONB, allowNull: true, comment: "排名快照与来源详情" },
    },
    {
      tableName: "EchohuntSocialListeningAccountSignals",
      timestamps: true,
      indexes: [
        { name: "ux_echohunt_sl_signals_board_type_twitter_occurred", fields: ["boardId", "signalType", "twitterId", "occurredAt"], unique: true },
        { name: "idx_echohunt_sl_signals_board_type_occurred", fields: ["boardId", "signalType", "occurredAt"] },
        { name: "idx_echohunt_sl_signals_board_twitter_occurred", fields: ["boardId", "twitterId", "occurredAt"] },
      ],
    }
  );
};
