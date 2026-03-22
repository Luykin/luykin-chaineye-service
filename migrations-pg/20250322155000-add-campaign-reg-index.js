"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 索引 1：覆盖 (campaign + registeredAt 排序) 的列表查询场景
    await queryInterface
      .addIndex("CampaignRegistrations", ["campaign", "registeredAt"], {
        name: "idx_campaign_reg_list",
        concurrently: true,
      })
      .catch(() => {});

    // 索引 2：覆盖 (campaign + twitterId + registeredAt) 的筛选+排序场景
    await queryInterface
      .addIndex("CampaignRegistrations", ["campaign", "twitterId", "registeredAt"], {
        name: "idx_campaign_reg_filter",
        concurrently: true,
      })
      .catch(() => {});
  },

  async down(queryInterface, Sequelize) {
    try {
      await queryInterface.removeIndex(
        "CampaignRegistrations",
        "idx_campaign_reg_list"
      );
    } catch (e) {}
    try {
      await queryInterface.removeIndex(
        "CampaignRegistrations",
        "idx_campaign_reg_filter"
      );
    } catch (e) {}
  },
};
