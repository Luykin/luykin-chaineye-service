"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("XhuntCampaignTweetSubmissions", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      campaignKey: { type: Sequelize.STRING(128), allowNull: false },
      leaderboardKey: { type: Sequelize.STRING(128), allowNull: false },
      campaignRegistrationId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "CampaignRegistrations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      xHuntUserId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "XHuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      authCenterUserId: { type: Sequelize.UUID, allowNull: true },
      twitterId: { type: Sequelize.STRING(64), allowNull: true },
      twitterUsername: { type: Sequelize.STRING(255), allowNull: true },
      tweetId: { type: Sequelize.STRING(32), allowNull: false },
      tweetUrl: { type: Sequelize.TEXT, allowNull: false },
      submittedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });

    await queryInterface.addIndex(
      "XhuntCampaignTweetSubmissions",
      ["campaignKey", "leaderboardKey", "xHuntUserId", "tweetId"],
      { name: "ux_xhunt_campaign_tweet_submission_user_tweet", unique: true }
    );
    await queryInterface.addIndex(
      "XhuntCampaignTweetSubmissions",
      ["campaignKey", "leaderboardKey", "xHuntUserId", "submittedAt"],
      { name: "idx_xhunt_campaign_tweet_submission_user_time" }
    );
    await queryInterface.addIndex(
      "XhuntCampaignTweetSubmissions",
      ["campaignKey", "leaderboardKey", "submittedAt"],
      { name: "idx_xhunt_campaign_tweet_submission_campaign_time" }
    );
    await queryInterface.addIndex(
      "XhuntCampaignTweetSubmissions",
      ["campaignRegistrationId"],
      { name: "idx_xhunt_campaign_tweet_submission_registration" }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("XhuntCampaignTweetSubmissions");
  },
};
