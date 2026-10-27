"use strict";

const INDEX_NAME = "ux_echohunt_e2e_records_campaign_payout_address";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX_NAME}"
      ON "EchohuntE2eRecords" ("address", LOWER("user_address"))
      WHERE "user_address" IS NOT NULL AND BTRIM("user_address") <> '';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS "${INDEX_NAME}";`
    );
  },
};
