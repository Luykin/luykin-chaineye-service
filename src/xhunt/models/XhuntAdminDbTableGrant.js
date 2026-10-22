const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "XhuntAdminDbTableGrant",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    adminId: { type: DataTypes.INTEGER, allowNull: false },
    databaseKey: { type: DataTypes.STRING(64), allowNull: false },
    tableKey: { type: DataTypes.STRING(255), allowNull: false },
    grantedByAdminId: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: "xhunt_admin_db_table_grants",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["adminId", "databaseKey", "tableKey"] },
      { fields: ["databaseKey", "tableKey"] },
    ],
  }
);
