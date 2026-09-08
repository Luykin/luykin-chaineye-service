"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("EchohuntSocialListeningPosts");
    if (!table.metricsRefreshedAt) {
      await queryInterface.addColumn("EchohuntSocialListeningPosts", "metricsRefreshedAt", {
        type: Sequelize.DATE,
        allowNull: true,
        comment: "互动指标最后一次完成源库回查的时间",
      });
    }
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_echohunt_sl_posts_board_metrics_refreshed
      ON "EchohuntSocialListeningPosts" ("boardId", "metricsRefreshedAt", "postCreatedAt" DESC)
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_echohunt_sl_posts_board_metrics_refreshed`);
    const table = await queryInterface.describeTable("EchohuntSocialListeningPosts");
    if (table.metricsRefreshedAt) await queryInterface.removeColumn("EchohuntSocialListeningPosts", "metricsRefreshedAt");
  },
};
