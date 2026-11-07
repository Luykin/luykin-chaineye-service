"use strict";

const TABLE_NAME = "CampaignRegistrations";
const UNIQUE_INDEX = "ux_campaign_reg_campaign_wallet";
const LOOKUP_INDEX = "idx_campaign_reg_campaign_wallet";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(TABLE_NAME, "walletChain", {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
    await queryInterface.addColumn(TABLE_NAME, "walletAddress", {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
    await queryInterface.addColumn(TABLE_NAME, "walletAddressNormalized", {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
    await queryInterface.addColumn(TABLE_NAME, "walletSignatureRequired", {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });
    await queryInterface.addColumn(TABLE_NAME, "walletVerified", {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });
    await queryInterface.addColumn(TABLE_NAME, "walletVerifiedAt", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn(TABLE_NAME, "walletVerification", {
      type: Sequelize.JSONB,
      allowNull: true,
    });

    await queryInterface.addIndex(
      TABLE_NAME,
      ["campaign", "walletChain", "walletAddressNormalized"],
      { name: LOOKUP_INDEX }
    );
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "${UNIQUE_INDEX}"
      ON "${TABLE_NAME}" ("campaign", "walletChain", "walletAddressNormalized")
      WHERE "walletAddressNormalized" IS NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${UNIQUE_INDEX}";`);
    await queryInterface.removeIndex(TABLE_NAME, LOOKUP_INDEX).catch(() => {});
    await queryInterface.removeColumn(TABLE_NAME, "walletVerification");
    await queryInterface.removeColumn(TABLE_NAME, "walletVerifiedAt");
    await queryInterface.removeColumn(TABLE_NAME, "walletVerified");
    await queryInterface.removeColumn(TABLE_NAME, "walletSignatureRequired");
    await queryInterface.removeColumn(TABLE_NAME, "walletAddressNormalized");
    await queryInterface.removeColumn(TABLE_NAME, "walletAddress");
    await queryInterface.removeColumn(TABLE_NAME, "walletChain");
  },
};
