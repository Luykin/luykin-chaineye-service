const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define("E2eSettlementItem", {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    settlement_id: { type: DataTypes.BIGINT, allowNull: false },
    campaign_address: { type: DataTypes.STRING, allowNull: false },
    user_id: { type: DataTypes.STRING, allowNull: false },
    username: { type: DataTypes.STRING, allowNull: true },
    name: { type: DataTypes.STRING, allowNull: true },
    profile_image_url: { type: DataTypes.STRING, allowNull: true },
    payout_address: { type: DataTypes.STRING, allowNull: true },
    fan_rank: { type: DataTypes.BIGINT, allowNull: true },
    point: { type: DataTypes.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
    rank: { type: DataTypes.INTEGER, allowNull: true },
    reward_amount: { type: DataTypes.DECIMAL(20, 6), allowNull: false, defaultValue: 0 },
    is_winner: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    excluded: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    exclusion_reason: { type: DataTypes.TEXT, allowNull: true },
    excluded_by: { type: DataTypes.BIGINT, allowNull: true },
    excluded_by_email: { type: DataTypes.STRING, allowNull: true },
    excluded_at: { type: DataTypes.DATE, allowNull: true },
    score_breakdown: { type: DataTypes.JSONB, allowNull: true },
    interactions: { type: DataTypes.JSONB, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, { tableName: "EchohuntE2eSettlementItems", timestamps: false });
