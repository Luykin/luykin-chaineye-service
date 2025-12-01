"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("xhunt_admin_webauthn_credentials", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      adminId: { type: Sequelize.INTEGER, allowNull: false },
      credentialId: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      publicKey: { type: Sequelize.TEXT, allowNull: false },
      counter: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      transports: { type: Sequelize.JSONB, allowNull: true },
      aaguid: { type: Sequelize.STRING(64), allowNull: true },
      deviceType: { type: Sequelize.STRING(32), allowNull: true },
      backedUp: { type: Sequelize.BOOLEAN, allowNull: true },
      nickname: { type: Sequelize.STRING(64), allowNull: true },
      lastUsedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.addIndex("xhunt_admin_webauthn_credentials", ["credentialId"], {
      unique: true,
      name: "ux_xaw_credential_id",
    });
    await queryInterface.addIndex("xhunt_admin_webauthn_credentials", ["adminId"], {
      name: "ix_xaw_admin_id",
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("xhunt_admin_webauthn_credentials");
  },
};
