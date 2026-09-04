const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "EchohuntSocialListeningAlert",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, comment: "预警记录 ID" },
      boardId: { type: DataTypes.UUID, allowNull: false, comment: "关联 EchohuntSocialListeningBoards.id" },
      alertType: { type: DataTypes.STRING(64), allowNull: false, comment: "预警类型：influential_mention/negative_content/volume_spike/negative_share_spike" },
      severity: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "info", comment: "预警严重程度：high/medium/info" },
      dedupeKey: { type: DataTypes.STRING(255), allowNull: false, comment: "预警去重键，同一看板内唯一，用于合并连续异常" },
      triggeredAt: { type: DataTypes.DATE, allowNull: false, comment: "首次触发时间" },
      lastSeenAt: { type: DataTypes.DATE, allowNull: false, comment: "最近一次命中该预警的时间" },
      titleZh: { type: DataTypes.STRING(255), allowNull: false, comment: "中文预警标题" },
      titleEn: { type: DataTypes.STRING(255), allowNull: true, comment: "英文预警标题" },
      messageZh: { type: DataTypes.TEXT, allowNull: false, comment: "中文预警描述" },
      messageEn: { type: DataTypes.TEXT, allowNull: true, comment: "英文预警描述" },
      currentValue: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, comment: "当前异常值 JSON" },
      baselineValue: { type: DataTypes.JSONB, allowNull: true, comment: "历史基线值 JSON" },
      sampleSize: { type: DataTypes.INTEGER, allowNull: true, comment: "触发预警时参与计算的样本量" },
      reason: { type: DataTypes.TEXT, allowNull: true, comment: "预警触发原因说明" },
      evidenceTweetIds: { type: DataTypes.JSONB, allowNull: true, comment: "证据 tweet id 列表" },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "active", comment: "技术状态：active/merged/expired；V1 前台不做处置态" },
    },
    {
      tableName: "EchohuntSocialListeningAlerts",
      timestamps: true,
      indexes: [
        { name: "ux_echohunt_sl_alerts_board_dedupe", fields: ["boardId", "dedupeKey"], unique: true },
        { name: "idx_echohunt_sl_alerts_board_type_triggered", fields: ["boardId", "alertType", "triggeredAt"] },
      ],
    }
  );
};
