const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "XhuntExternalLeaderboardAdapter",
  {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    campaignKey: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "活动 business key",
    },
    leaderboardKey: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "customLeaderboards 项目的稳定 key；每个榜单独立维护一套适配器",
    },
    draftConfig: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    publishedConfig: { type: DataTypes.JSONB, allowNull: true },
    lastSample: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    lastPreview: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    publishedVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "draft" },
    publishedAt: { type: DataTypes.DATE, allowNull: true },
    publishedByAdminId: { type: DataTypes.BIGINT, allowNull: true },
  },
  {
    tableName: "XhuntExternalLeaderboardAdapters",
    timestamps: true,
    indexes: [
      {
        name: "uq_xhunt_external_leaderboard_adapters_campaign_leaderboard",
        fields: ["campaignKey", "leaderboardKey"],
        unique: true,
      },
      { name: "idx_xhunt_external_leaderboard_adapters_campaign_key", fields: ["campaignKey"] },
      { name: "idx_xhunt_external_leaderboard_adapters_status", fields: ["status"] },
    ],
  }
);
