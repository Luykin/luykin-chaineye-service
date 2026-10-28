"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable("EchohuntE2eScoringSettings", {
        scope: { type: Sequelize.STRING(32), allowNull: false, primaryKey: true },
        config: { type: Sequelize.JSONB, allowNull: false },
        updated_by: { type: Sequelize.BIGINT, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      }, { transaction });

      await queryInterface.bulkInsert("EchohuntE2eScoringSettings", [{
        scope: "global",
        config: JSON.stringify({
          timeDecayFloor: 0.7,
          replyBase: 5,
          quoteBase: 15,
          lengthCharsPerPoint: 12,
          lengthBonusCap: 25,
          likeMultiplier: 1.5,
          replyMultiplier: 2,
          retweetReceivedMultiplier: 2,
          viewsPerPoint: 200,
          viewBonusCap: 10,
          engagementBonusCap: 30,
          maxReplies: 1,
          maxQuotes: 1,
          rankThreshold1: 1000,
          rankThreshold2: 5000,
          rankThreshold3: 20000,
          rankThreshold4: 50000,
          rankThreshold5: 100000,
          rankThreshold6: 200000,
          rankWeightTop1000: 2.5,
          rankWeightTop5000: 2,
          rankWeightTop20000: 1.6,
          rankWeightTop50000: 1.35,
          rankWeightTop100000: 1.15,
          rankWeightTop200000: 1,
          rankWeightDefault: 0.5,
        }),
        created_at: new Date(),
        updated_at: new Date(),
      }], { transaction, ignoreDuplicates: true });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("EchohuntE2eScoringSettings", { transaction });
    });
  },
};
