"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("EchohuntE2eLists", {
      tweet_id: { type: Sequelize.STRING, allowNull: false },
      user_id: { type: Sequelize.STRING, allowNull: false },
      rewards: { type: Sequelize.DECIMAL, allowNull: true },
      address: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      start_time: { type: Sequelize.DATE, allowNull: true },
      end_time: { type: Sequelize.DATE, allowNull: true },
      target: { type: Sequelize.BIGINT, allowNull: true },
      winners: { type: Sequelize.INTEGER, allowNull: true },
      text: { type: Sequelize.TEXT, allowNull: true },
      summary_cn: { type: Sequelize.TEXT, allowNull: true },
      owner_handle: { type: Sequelize.STRING, allowNull: true },
      owner_image_url: { type: Sequelize.STRING, allowNull: true },
      owner_user_id: { type: Sequelize.STRING, allowNull: true },
      summary_en: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: true },
      complete_tx: { type: Sequelize.STRING, allowNull: true },
      type: { type: Sequelize.STRING, allowNull: true },
      fees: { type: Sequelize.DECIMAL, allowNull: true },
      lang: { type: Sequelize.STRING, allowNull: true },
      retro: { type: Sequelize.BOOLEAN, allowNull: true },
    });

    await queryInterface.addIndex("EchohuntE2eLists", ["tweet_id"], {
      name: "idx_echohunt_e2e_lists_tweet_id",
    });
    await queryInterface.addIndex("EchohuntE2eLists", ["tweet_id"], {
      name: "ux_echohunt_e2e_lists_active_tweet_id",
      unique: true,
      where: { status: "active" },
    });
    await queryInterface.addIndex("EchohuntE2eLists", ["status"], {
      name: "idx_echohunt_e2e_lists_status",
    });

    await queryInterface.createTable("EchohuntE2eRecords", {
      tweet_id: { type: Sequelize.STRING, allowNull: false },
      user_id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      fan_rank: { type: Sequelize.BIGINT, allowNull: true },
      username: { type: Sequelize.STRING, allowNull: true },
      name: { type: Sequelize.STRING, allowNull: true },
      point: { type: Sequelize.DECIMAL, allowNull: true },
      profile_image_url: { type: Sequelize.STRING, allowNull: true },
      rewards: { type: Sequelize.DECIMAL, allowNull: true },
      address: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      user_address: { type: Sequelize.STRING, allowNull: true },
      create_time: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      update_time: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      explaination: { type: Sequelize.TEXT, allowNull: true },
    });

    await queryInterface.addIndex("EchohuntE2eRecords", ["address", "user_id"], {
      name: "ux_echohunt_e2e_records_address_user_id",
      unique: true,
    });
    await queryInterface.addIndex("EchohuntE2eRecords", ["tweet_id"], {
      name: "idx_echohunt_e2e_records_tweet_id",
    });
    await queryInterface.addIndex("EchohuntE2eRecords", ["user_id"], {
      name: "idx_echohunt_e2e_records_user_id",
    });

    await queryInterface.createTable("EchohuntE2eLogs", {
      tweet_id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      user_id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      calc_time: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        primaryKey: true,
      },
      username: { type: Sequelize.STRING, allowNull: true },
      point: { type: Sequelize.DECIMAL, allowNull: true },
      explanation: { type: Sequelize.TEXT, allowNull: true },
    });

    await queryInterface.addIndex("EchohuntE2eLogs", ["tweet_id", "user_id"], {
      name: "idx_echohunt_e2e_logs_tweet_user",
    });
    await queryInterface.addIndex("EchohuntE2eLogs", ["calc_time"], {
      name: "idx_echohunt_e2e_logs_calc_time",
    });

    await queryInterface.createTable("EchohuntE2eTweets", {
      tweet_id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      text: { type: Sequelize.TEXT, allowNull: true },
      summary_cn: { type: Sequelize.TEXT, allowNull: true },
      summary_en: { type: Sequelize.TEXT, allowNull: true },
      owner_handle: { type: Sequelize.STRING, allowNull: true },
      owner_image_url: { type: Sequelize.STRING, allowNull: true },
      owner_user_id: { type: Sequelize.STRING, allowNull: true },
      political: { type: Sequelize.BOOLEAN, allowNull: true },
      sexual: { type: Sequelize.BOOLEAN, allowNull: true },
      violence: { type: Sequelize.BOOLEAN, allowNull: true },
      abusive: { type: Sequelize.BOOLEAN, allowNull: true },
      explanation: { type: Sequelize.TEXT, allowNull: true },
      passed: { type: Sequelize.BOOLEAN, allowNull: true },
      html: { type: Sequelize.TEXT, allowNull: true },
      engage_data: { type: Sequelize.JSONB, allowNull: true },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("EchohuntE2eTweets");
    await queryInterface.dropTable("EchohuntE2eLogs");
    await queryInterface.dropTable("EchohuntE2eRecords");
    await queryInterface.dropTable("EchohuntE2eLists");
  },
};
