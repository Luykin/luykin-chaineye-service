"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("EchohuntE2eRecords", "score_breakdown", {
      type: Sequelize.JSONB,
      allowNull: true,
    });
    await queryInterface.addColumn("EchohuntE2eLogs", "address", {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn("EchohuntE2eLogs", "score_breakdown", {
      type: Sequelize.JSONB,
      allowNull: true,
    });

    await queryInterface.createTable("EchohuntE2eSettlements", {
      id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
      campaign_address: { type: Sequelize.STRING, allowNull: false },
      revision: { type: Sequelize.INTEGER, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: "draft" },
      reward_pool: { type: Sequelize.DECIMAL(20, 6), allowNull: false },
      fee_amount: { type: Sequelize.DECIMAL(20, 6), allowNull: false },
      deposit_amount: { type: Sequelize.DECIMAL(20, 6), allowNull: false },
      winner_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      excluded_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      unique_recipient_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      calculation_config: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      distribution_recipients: { type: Sequelize.JSONB, allowNull: true },
      generated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      payout_due_at: { type: Sequelize.DATE, allowNull: false },
      approved_by: { type: Sequelize.BIGINT, allowNull: true },
      approved_by_email: { type: Sequelize.STRING, allowNull: true },
      approved_at: { type: Sequelize.DATE, allowNull: true },
      submitted_by: { type: Sequelize.BIGINT, allowNull: true },
      submitted_by_email: { type: Sequelize.STRING, allowNull: true },
      submitted_at: { type: Sequelize.DATE, allowNull: true },
      distribution_status: { type: Sequelize.STRING, allowNull: false, defaultValue: "pending" },
      tx_hash: { type: Sequelize.STRING, allowNull: true },
      confirmed_at: { type: Sequelize.DATE, allowNull: true },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      provider_response: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("EchohuntE2eSettlements", ["campaign_address", "revision"], {
      name: "ux_echohunt_e2e_settlements_campaign_revision",
      unique: true,
    });
    await queryInterface.addIndex("EchohuntE2eSettlements", ["campaign_address", "status"], {
      name: "idx_echohunt_e2e_settlements_campaign_status",
    });
    await queryInterface.addIndex("EchohuntE2eSettlements", ["distribution_status"], {
      name: "idx_echohunt_e2e_settlements_distribution_status",
    });

    await queryInterface.createTable("EchohuntE2eSettlementItems", {
      id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
      settlement_id: { type: Sequelize.BIGINT, allowNull: false },
      campaign_address: { type: Sequelize.STRING, allowNull: false },
      user_id: { type: Sequelize.STRING, allowNull: false },
      username: { type: Sequelize.STRING, allowNull: true },
      name: { type: Sequelize.STRING, allowNull: true },
      profile_image_url: { type: Sequelize.STRING, allowNull: true },
      payout_address: { type: Sequelize.STRING, allowNull: true },
      fan_rank: { type: Sequelize.BIGINT, allowNull: true },
      point: { type: Sequelize.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
      rank: { type: Sequelize.INTEGER, allowNull: true },
      reward_amount: { type: Sequelize.DECIMAL(20, 6), allowNull: false, defaultValue: 0 },
      is_winner: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      excluded: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      exclusion_reason: { type: Sequelize.TEXT, allowNull: true },
      excluded_by: { type: Sequelize.BIGINT, allowNull: true },
      excluded_by_email: { type: Sequelize.STRING, allowNull: true },
      excluded_at: { type: Sequelize.DATE, allowNull: true },
      score_breakdown: { type: Sequelize.JSONB, allowNull: true },
      interactions: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("EchohuntE2eSettlementItems", ["settlement_id", "user_id"], {
      name: "ux_echohunt_e2e_settlement_items_settlement_user",
      unique: true,
    });
    await queryInterface.addIndex("EchohuntE2eSettlementItems", ["campaign_address", "settlement_id"], {
      name: "idx_echohunt_e2e_settlement_items_campaign",
    });

    await queryInterface.createTable("EchohuntE2eCrawlRuns", {
      id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
      tweet_id: { type: Sequelize.STRING, allowNull: false },
      campaign_address: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false },
      started_at: { type: Sequelize.DATE, allowNull: false },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      reply_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      quote_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      retweeter_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      endpoint_details: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      error: { type: Sequelize.TEXT, allowNull: true },
    });
    await queryInterface.addIndex("EchohuntE2eCrawlRuns", ["tweet_id", "started_at"], {
      name: "idx_echohunt_e2e_crawl_runs_tweet_started",
    });
    await queryInterface.addIndex("EchohuntE2eCrawlRuns", ["campaign_address", "started_at"], {
      name: "idx_echohunt_e2e_crawl_runs_campaign_started",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("EchohuntE2eCrawlRuns");
    await queryInterface.dropTable("EchohuntE2eSettlementItems");
    await queryInterface.dropTable("EchohuntE2eSettlements");
    await queryInterface.removeColumn("EchohuntE2eLogs", "score_breakdown");
    await queryInterface.removeColumn("EchohuntE2eLogs", "address");
    await queryInterface.removeColumn("EchohuntE2eRecords", "score_breakdown");
  },
};
