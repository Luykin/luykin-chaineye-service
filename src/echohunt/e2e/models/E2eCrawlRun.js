const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define("E2eCrawlRun", {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    tweet_id: { type: DataTypes.STRING, allowNull: false },
    campaign_address: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false },
    started_at: { type: DataTypes.DATE, allowNull: false },
    finished_at: { type: DataTypes.DATE, allowNull: true },
    reply_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    quote_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    retweeter_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    endpoint_details: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    error: { type: DataTypes.TEXT, allowNull: true },
  }, { tableName: "EchohuntE2eCrawlRuns", timestamps: false });
