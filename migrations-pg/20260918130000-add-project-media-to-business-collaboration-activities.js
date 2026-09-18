"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("BusinessCollaborationActivities");
    if (!table.projectTwitterAvatarUrl) {
      await queryInterface.addColumn("BusinessCollaborationActivities", "projectTwitterAvatarUrl", {
        type: Sequelize.STRING(2048),
        allowNull: true,
        comment: "创建活动时查询到的项目 X 头像 URL",
      });
    }
    if (!table.projectTwitterBannerUrl) {
      await queryInterface.addColumn("BusinessCollaborationActivities", "projectTwitterBannerUrl", {
        type: Sequelize.STRING(2048),
        allowNull: true,
        comment: "创建活动时查询到的项目 X 背景图 URL",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("BusinessCollaborationActivities");
    if (table.projectTwitterBannerUrl) await queryInterface.removeColumn("BusinessCollaborationActivities", "projectTwitterBannerUrl");
    if (table.projectTwitterAvatarUrl) await queryInterface.removeColumn("BusinessCollaborationActivities", "projectTwitterAvatarUrl");
  },
};
