"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("xhunt_admin_managers", "totpSecretEncrypted", {
      type: Sequelize.STRING(512),
      allowNull: true,
    });
    await queryInterface.addColumn("xhunt_admin_managers", "totpEnabledAt", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn("xhunt_admin_managers", "totpLastUsedStep", {
      type: Sequelize.BIGINT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("xhunt_admin_managers", "totpLastUsedStep");
    await queryInterface.removeColumn("xhunt_admin_managers", "totpEnabledAt");
    await queryInterface.removeColumn("xhunt_admin_managers", "totpSecretEncrypted");
  },
};
