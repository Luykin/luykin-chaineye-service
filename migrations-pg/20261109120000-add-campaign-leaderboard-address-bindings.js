"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("XhuntCampaignLeaderboardAddressBindings", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      campaignKey: { type: Sequelize.STRING(128), allowNull: false },
      leaderboardKey: { type: Sequelize.STRING(128), allowNull: false },
      campaignRegistrationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "CampaignRegistrations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
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
      chain: { type: Sequelize.STRING(32), allowNull: false },
      address: { type: Sequelize.STRING(256), allowNull: false },
      addressNormalized: { type: Sequelize.STRING(256), allowNull: false },
      promptSnapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      lockedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });

    await queryInterface.addIndex(
      "XhuntCampaignLeaderboardAddressBindings",
      ["campaignKey", "leaderboardKey", "xHuntUserId"],
      { name: "ux_xhunt_campaign_leaderboard_address_user", unique: true }
    );
    await queryInterface.addIndex(
      "XhuntCampaignLeaderboardAddressBindings",
      ["campaignRegistrationId"],
      { name: "idx_xhunt_campaign_leaderboard_address_registration" }
    );
    await queryInterface.addIndex(
      "XhuntCampaignLeaderboardAddressBindings",
      ["campaignKey", "leaderboardKey", "chain", "addressNormalized"],
      { name: "idx_xhunt_campaign_leaderboard_address_normalized" }
    );

    await queryInterface.addColumn("XhuntCampaignTweetSubmissions", "addressBindingId", {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: "XhuntCampaignLeaderboardAddressBindings", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });
    await queryInterface.addIndex("XhuntCampaignTweetSubmissions", ["addressBindingId"], {
      name: "idx_xhunt_campaign_tweet_submission_address_binding",
    });

    await queryInterface.sequelize.query(`
      CREATE FUNCTION prevent_xhunt_campaign_leaderboard_address_binding_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'campaign leaderboard address bindings are immutable';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_prevent_xhunt_campaign_leaderboard_address_binding_mutation
      BEFORE UPDATE OR DELETE ON "XhuntCampaignLeaderboardAddressBindings"
      FOR EACH ROW EXECUTE FUNCTION prevent_xhunt_campaign_leaderboard_address_binding_mutation();
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS trg_prevent_xhunt_campaign_leaderboard_address_binding_mutation
      ON "XhuntCampaignLeaderboardAddressBindings";
    `);
    await queryInterface.sequelize.query("DROP FUNCTION IF EXISTS prevent_xhunt_campaign_leaderboard_address_binding_mutation();");
    await queryInterface.removeIndex("XhuntCampaignTweetSubmissions", "idx_xhunt_campaign_tweet_submission_address_binding");
    await queryInterface.removeColumn("XhuntCampaignTweetSubmissions", "addressBindingId");
    await queryInterface.dropTable("XhuntCampaignLeaderboardAddressBindings");
  },
};
