const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "E2eInteractionSubmission",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      campaign_address: { type: DataTypes.STRING, allowNull: false },
      campaign_tweet_id: { type: DataTypes.STRING, allowNull: false },
      interaction_tweet_id: { type: DataTypes.STRING, allowNull: false },
      interaction_type: { type: DataTypes.STRING, allowNull: false },
      interaction_url: { type: DataTypes.TEXT, allowNull: false },
      user_id: { type: DataTypes.STRING, allowNull: false },
      username: { type: DataTypes.STRING, allowNull: true },
      name: { type: DataTypes.STRING, allowNull: true },
      profile_image_url: { type: DataTypes.STRING, allowNull: true },
      text: { type: DataTypes.TEXT, allowNull: true },
      interaction_created_at: { type: DataTypes.DATE, allowNull: false },
      likes: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      replies: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      retweets: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      quotes: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      views: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "verified" },
      verified_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      last_refreshed_at: { type: DataTypes.DATE, allowNull: true },
      last_error: { type: DataTypes.TEXT, allowNull: true },
      submitted_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "EchohuntE2eInteractionSubmissions",
      timestamps: false,
      indexes: [
        {
          name: "ux_echohunt_e2e_interaction_submission_tweet",
          fields: ["campaign_address", "interaction_tweet_id"],
          unique: true,
        },
        {
          name: "idx_echohunt_e2e_interaction_submission_user",
          fields: ["campaign_address", "user_id", "status"],
        },
        {
          name: "idx_echohunt_e2e_interaction_submission_campaign_type",
          fields: ["campaign_address", "interaction_type", "interaction_created_at"],
        },
      ],
    }
  );
