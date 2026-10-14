const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "XhuntCampaignTweetSubmission",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    campaignKey: { type: DataTypes.STRING(128), allowNull: false },
    leaderboardKey: { type: DataTypes.STRING(128), allowNull: false },
    campaignRegistrationId: { type: DataTypes.UUID, allowNull: true },
    xHuntUserId: { type: DataTypes.UUID, allowNull: false },
    authCenterUserId: { type: DataTypes.UUID, allowNull: true },
    twitterId: { type: DataTypes.STRING(64), allowNull: true },
    twitterUsername: { type: DataTypes.STRING(255), allowNull: true },
    tweetId: { type: DataTypes.STRING(32), allowNull: false },
    tweetUrl: { type: DataTypes.TEXT, allowNull: false },
    submittedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    tableName: "XhuntCampaignTweetSubmissions",
    timestamps: true,
    indexes: [
      {
        name: "ux_xhunt_campaign_tweet_submission_user_tweet",
        fields: ["campaignKey", "leaderboardKey", "xHuntUserId", "tweetId"],
        unique: true,
      },
      {
        name: "idx_xhunt_campaign_tweet_submission_user_time",
        fields: ["campaignKey", "leaderboardKey", "xHuntUserId", "submittedAt"],
      },
      {
        name: "idx_xhunt_campaign_tweet_submission_campaign_time",
        fields: ["campaignKey", "leaderboardKey", "submittedAt"],
      },
      { name: "idx_xhunt_campaign_tweet_submission_registration", fields: ["campaignRegistrationId"] },
    ],
  }
);
