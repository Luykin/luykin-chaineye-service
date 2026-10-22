"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("xhunt_admin_db_table_grants", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      adminId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "xhunt_admin_managers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      databaseKey: { type: Sequelize.STRING(64), allowNull: false },
      tableKey: { type: Sequelize.STRING(255), allowNull: false },
      grantedByAdminId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "xhunt_admin_managers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.addIndex("xhunt_admin_db_table_grants", ["adminId", "databaseKey", "tableKey"], {
      unique: true,
      name: "ux_admin_db_table_grants_scope",
    });
    await queryInterface.addIndex("xhunt_admin_db_table_grants", ["databaseKey", "tableKey"], {
      name: "idx_admin_db_table_grants_table",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("xhunt_admin_db_table_grants");
  },
};
