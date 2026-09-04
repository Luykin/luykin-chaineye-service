"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("EchohuntSocialListeningAlerts", "titleEn", {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: "英文预警标题",
    });
    await queryInterface.addColumn("EchohuntSocialListeningAlerts", "messageEn", {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: "英文预警描述",
    });
    await queryInterface.addColumn("EchohuntSocialListeningAccountSignals", "summaryEn", {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: "动态英文摘要",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("EchohuntSocialListeningAccountSignals", "summaryEn");
    await queryInterface.removeColumn("EchohuntSocialListeningAlerts", "messageEn");
    await queryInterface.removeColumn("EchohuntSocialListeningAlerts", "titleEn");
  },
};
