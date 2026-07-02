"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("XHuntUsers");

    if (!table.userSource) {
      await queryInterface.addColumn("XHuntUsers", "userSource", {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "extension",
        comment: "用户来源：extension / echohunt_web / mixed",
      });
    }

    if (!table.createdFromClient) {
      await queryInterface.addColumn("XHuntUsers", "createdFromClient", {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: "首次创建来源客户端，例如 xhunt_extension / echohunt",
      });
    }

    if (!table.lastLoginClient) {
      await queryInterface.addColumn("XHuntUsers", "lastLoginClient", {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: "最近登录来源客户端",
      });
    }

    if (!table.sourceMetadata) {
      await queryInterface.addColumn("XHuntUsers", "sourceMetadata", {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: "来源相关扩展信息",
      });
    }

    await queryInterface
      .addIndex("XHuntUsers", ["userSource"], {
        name: "idx_xhunt_users_user_source",
        concurrently: true,
      })
      .catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface
      .removeIndex("XHuntUsers", "idx_xhunt_users_user_source")
      .catch(() => {});

    const table = await queryInterface.describeTable("XHuntUsers");
    if (table.sourceMetadata) await queryInterface.removeColumn("XHuntUsers", "sourceMetadata");
    if (table.lastLoginClient) await queryInterface.removeColumn("XHuntUsers", "lastLoginClient");
    if (table.createdFromClient) await queryInterface.removeColumn("XHuntUsers", "createdFromClient");
    if (table.userSource) await queryInterface.removeColumn("XHuntUsers", "userSource");
  },
};
