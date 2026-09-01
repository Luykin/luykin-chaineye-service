const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "EchohuntSocialListeningSnapshot",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, comment: "聚合快照 ID" },
      boardId: { type: DataTypes.UUID, allowNull: false, comment: "关联 EchohuntSocialListeningBoards.id" },
      rangeKey: { type: DataTypes.STRING(16), allowNull: false, comment: "时间范围：24H/7D/30D" },
      bucketSize: { type: DataTypes.STRING(16), allowNull: false, comment: "聚合桶粒度：hour/day" },
      windowStartAt: { type: DataTypes.DATE, allowNull: false, comment: "聚合窗口开始时间" },
      windowEndAt: { type: DataTypes.DATE, allowNull: false, comment: "聚合窗口结束时间" },
      processedThrough: { type: DataTypes.DATE, allowNull: true, comment: "生成快照时看板已处理到的时间游标" },
      metrics: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, comment: "概览指标 JSON：讨论量、参与账号、曝光、互动、历史不足等" },
      volumeSeries: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], comment: "讨论量趋势序列" },
      sentimentSeries: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], comment: "情绪趋势序列" },
      sentimentComposition: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, comment: "情绪占比与样本数统计" },
      topics: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], comment: "主题榜聚合结果" },
      topicTrends: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], comment: "Top 3 主题在当前范围内的趋势序列" },
      wordCloud: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], comment: "词云聚合结果" },
      viewpoints: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, comment: "当前范围正面/负面观点聚合摘要" },
      accountSummary: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, comment: "关键账号动态摘要" },
      alertSummary: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, comment: "预警摘要统计" },
      generatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, comment: "快照生成时间" },
    },
    {
      tableName: "EchohuntSocialListeningSnapshots",
      timestamps: true,
      indexes: [
        { name: "idx_echohunt_sl_snapshots_board_range_generated", fields: ["boardId", "rangeKey", "generatedAt"] },
      ],
    }
  );
};
