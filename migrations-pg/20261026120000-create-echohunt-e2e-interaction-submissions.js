"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("EchohuntE2eInteractionSubmissions", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      campaign_address: { type: Sequelize.STRING, allowNull: false },
      campaign_tweet_id: { type: Sequelize.STRING, allowNull: false },
      interaction_tweet_id: { type: Sequelize.STRING, allowNull: false },
      interaction_type: { type: Sequelize.STRING, allowNull: false },
      interaction_url: { type: Sequelize.TEXT, allowNull: false },
      user_id: { type: Sequelize.STRING, allowNull: false },
      username: { type: Sequelize.STRING, allowNull: true },
      name: { type: Sequelize.STRING, allowNull: true },
      profile_image_url: { type: Sequelize.STRING, allowNull: true },
      text: { type: Sequelize.TEXT, allowNull: true },
      interaction_created_at: { type: Sequelize.DATE, allowNull: false },
      likes: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      replies: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      retweets: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      quotes: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      views: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: "verified" },
      verified_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      last_refreshed_at: { type: Sequelize.DATE, allowNull: true },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      submitted_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });

    await queryInterface.addConstraint("EchohuntE2eInteractionSubmissions", {
      fields: ["interaction_type"],
      type: "check",
      where: { interaction_type: ["reply", "quote"] },
      name: "ck_echohunt_e2e_interaction_submission_type",
    });
    await queryInterface.addConstraint("EchohuntE2eInteractionSubmissions", {
      fields: ["status"],
      type: "check",
      where: { status: ["verified", "unavailable"] },
      name: "ck_echohunt_e2e_interaction_submission_status",
    });
    await queryInterface.addIndex(
      "EchohuntE2eInteractionSubmissions",
      ["campaign_address", "interaction_tweet_id"],
      { name: "ux_echohunt_e2e_interaction_submission_tweet", unique: true }
    );
    await queryInterface.addIndex(
      "EchohuntE2eInteractionSubmissions",
      ["campaign_address", "user_id", "status"],
      { name: "idx_echohunt_e2e_interaction_submission_user" }
    );
    await queryInterface.addIndex(
      "EchohuntE2eInteractionSubmissions",
      ["campaign_address", "interaction_type", "interaction_created_at"],
      { name: "idx_echohunt_e2e_interaction_submission_campaign_type" }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("EchohuntE2eInteractionSubmissions");
  },
};
