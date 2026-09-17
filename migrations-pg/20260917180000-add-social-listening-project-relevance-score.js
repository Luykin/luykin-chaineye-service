"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("EchohuntSocialListeningPosts");
    if (!table.projectRelevanceScore) {
      await queryInterface.addColumn("EchohuntSocialListeningPosts", "projectRelevanceScore", {
        type: Sequelize.DECIMAL(8, 4),
        allowNull: true,
        comment: "项目相关性 AI 分数，1–10 分，数值越高越直接相关",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("EchohuntSocialListeningPosts");
    if (table.projectRelevanceScore) {
      await queryInterface.removeColumn("EchohuntSocialListeningPosts", "projectRelevanceScore");
    }
  },
};
