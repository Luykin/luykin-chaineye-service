"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_echohunt_sl_posts_board_views_effective
      ON "EchohuntSocialListeningPosts" ("boardId", "viewsCount" DESC, "postCreatedAt" DESC)
      WHERE sentiment IN ('positive', 'neutral', 'negative') AND "viewsCount" > 0
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_echohunt_sl_signals_board_occurred
      ON "EchohuntSocialListeningAccountSignals" ("boardId", "occurredAt" DESC)
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_echohunt_sl_alerts_board_triggered
      ON "EchohuntSocialListeningAlerts" ("boardId", "triggeredAt" DESC)
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_echohunt_sl_alerts_board_triggered`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_echohunt_sl_signals_board_occurred`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_echohunt_sl_posts_board_views_effective`);
  },
};
