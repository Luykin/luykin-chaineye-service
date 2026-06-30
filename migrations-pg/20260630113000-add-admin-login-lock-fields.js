"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("xhunt_admin_managers", "failedLoginAttempts", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn("xhunt_admin_managers", "loginLockedUntil", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addIndex("xhunt_admin_managers", ["loginLockedUntil"], {
      name: "idx_xam_login_locked_until",
    }).catch(() => {});
  },

  async down(queryInterface, Sequelize) {
    try {
      await queryInterface.removeIndex("xhunt_admin_managers", "idx_xam_login_locked_until");
    } catch (e) {}
    await queryInterface.removeColumn("xhunt_admin_managers", "loginLockedUntil");
    await queryInterface.removeColumn("xhunt_admin_managers", "failedLoginAttempts");
  },
};
