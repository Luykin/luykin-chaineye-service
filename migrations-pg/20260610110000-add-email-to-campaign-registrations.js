"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("CampaignRegistrations");
    if (!table.email) {
      await queryInterface.addColumn("CampaignRegistrations", "email", {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "可选：Email 报名地址（允许 Email 报名的活动可填写）",
      });
    }

    await queryInterface
      .addIndex("CampaignRegistrations", ["campaign", "email"], {
        name: "idx_campaign_reg_campaign_email",
        concurrently: true,
      })
      .catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface
      .removeIndex("CampaignRegistrations", "idx_campaign_reg_campaign_email")
      .catch(() => {});
    const table = await queryInterface.describeTable("CampaignRegistrations");
    if (table.email) {
      await queryInterface.removeColumn("CampaignRegistrations", "email");
    }
  },
};
