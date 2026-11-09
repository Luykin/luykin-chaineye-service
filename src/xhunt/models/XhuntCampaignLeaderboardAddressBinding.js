const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "XhuntCampaignLeaderboardAddressBinding",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    campaignKey: { type: DataTypes.STRING(128), allowNull: false },
    leaderboardKey: { type: DataTypes.STRING(128), allowNull: false },
    campaignRegistrationId: { type: DataTypes.UUID, allowNull: false },
    xHuntUserId: { type: DataTypes.UUID, allowNull: false },
    authCenterUserId: { type: DataTypes.UUID, allowNull: true },
    twitterId: { type: DataTypes.STRING(64), allowNull: true },
    chain: { type: DataTypes.STRING(32), allowNull: false },
    address: { type: DataTypes.STRING(256), allowNull: false },
    addressNormalized: { type: DataTypes.STRING(256), allowNull: false },
    promptSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    lockedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    tableName: "XhuntCampaignLeaderboardAddressBindings",
    timestamps: true,
    indexes: [
      {
        name: "ux_xhunt_campaign_leaderboard_address_user",
        fields: ["campaignKey", "leaderboardKey", "xHuntUserId"],
        unique: true,
      },
      { name: "idx_xhunt_campaign_leaderboard_address_registration", fields: ["campaignRegistrationId"] },
      { name: "idx_xhunt_campaign_leaderboard_address_normalized", fields: ["campaignKey", "leaderboardKey", "chain", "addressNormalized"] },
    ],
  }
);
