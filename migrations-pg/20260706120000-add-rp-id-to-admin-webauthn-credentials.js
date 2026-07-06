"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("xhunt_admin_webauthn_credentials", "rpId", {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: "WebAuthn RP ID，例如 kb.cryptohunt.ai / kb.xhunt.ai；历史数据为空时按 kb.cryptohunt.ai 兼容",
    });
    await queryInterface.addIndex("xhunt_admin_webauthn_credentials", ["adminId", "rpId"], {
      name: "idx_xaw_admin_rp_id",
    }).catch(() => {});
  },

  async down(queryInterface, Sequelize) {
    try {
      await queryInterface.removeIndex("xhunt_admin_webauthn_credentials", "idx_xaw_admin_rp_id");
    } catch (e) {}
    await queryInterface.removeColumn("xhunt_admin_webauthn_credentials", "rpId");
  },
};
