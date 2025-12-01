"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("xhunt_admin_managers", "permissions", {
      type: Sequelize.JSONB,
      allowNull: true,
    });
    await queryInterface.addIndex("xhunt_admin_managers", ["permissions"], {
      name: "idx_xam_permissions_gin",
      using: "gin",
      concurrently: false,
    }).catch(() => {});
  },

  async down(queryInterface, Sequelize) {
    try {
      await queryInterface.removeIndex("xhunt_admin_managers", "idx_xam_permissions_gin");
    } catch (e) {}
    await queryInterface.removeColumn("xhunt_admin_managers", "permissions");
  },
};
