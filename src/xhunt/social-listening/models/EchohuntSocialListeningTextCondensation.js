const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "EchohuntSocialListeningTextCondensation",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, comment: "长文精简缓存 ID" },
    tweetId: { type: DataTypes.STRING(64), allowNull: false, comment: "来源 X/Twitter tweet id；跨看板复用" },
    sourceTextHash: { type: DataTypes.STRING(64), allowNull: false, comment: "归一化原文 SHA-256；原文变化时缓存失效" },
    sourceTextLength: { type: DataTypes.INTEGER, allowNull: false, comment: "归一化原文字符数" },
    condensedText: { type: DataTypes.TEXT, allowNull: false, comment: "默认模型生成的长文精简内容" },
    model: { type: DataTypes.STRING(255), allowNull: true, comment: "生成精简内容所用的默认模型" },
    condensedAt: { type: DataTypes.DATE, allowNull: false, comment: "最近一次精简完成时间" },
  },
  {
    tableName: "EchohuntSocialListeningTextCondensations",
    timestamps: true,
    indexes: [
      { name: "ux_echohunt_sl_text_condensations_tweet", fields: ["tweetId"], unique: true },
      { name: "idx_echohunt_sl_text_condensations_retention_condensed", fields: ["condensedAt"] },
    ],
  }
);
