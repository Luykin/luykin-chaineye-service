"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. 添加 participantCount 字段到 EngageToEarnActivities 表
    await queryInterface.addColumn("EngageToEarnActivities", "participantCount", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: "报名人数统计",
    });

    // 2. 统计现有活动的报名人数并更新
    await queryInterface.sequelize.query(`
      UPDATE "EngageToEarnActivities" AS a
      SET "participantCount" = COALESCE(
        (
          SELECT COUNT(*)
          FROM "EngageToEarnSignups" AS s
          WHERE s."activityId" = a.id
        ),
        0
      )
    `);
  },

  async down(queryInterface, Sequelize) {
    // 删除 participantCount 字段
    await queryInterface.removeColumn("EngageToEarnActivities", "participantCount");
  },
};
