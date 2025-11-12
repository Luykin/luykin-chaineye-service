"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // 安全检查：如果不存在再添加
    const table = await queryInterface.describeTable("EngageToEarnSignups");
    if (!table.twitterId) {
      await queryInterface.addColumn("EngageToEarnSignups", "twitterId", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("EngageToEarnSignups");
    if (table.twitterId) {
      await queryInterface.removeColumn("EngageToEarnSignups", "twitterId");
    }
  },
};
