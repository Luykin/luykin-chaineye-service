"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_echohunt_sl_boards_active_twitter_id"
      ON "EchohuntSocialListeningBoards" ("officialTwitterId")
      WHERE "officialTwitterId" IS NOT NULL AND "status" <> 'deleted'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS "ux_echohunt_sl_boards_active_twitter_id"
    `);
  },
};
