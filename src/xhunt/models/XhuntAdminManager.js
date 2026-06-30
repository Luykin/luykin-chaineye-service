const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const XhuntAdminManager = sequelize.define(
    "XhuntAdminManager",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true, validate: { isEmail: true } },
      passwordHash: { type: DataTypes.STRING(255), allowNull: false },
      role: { type: DataTypes.ENUM("super", "admin"), allowNull: false, defaultValue: "admin" },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      canLogin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      receivesDailyReport: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      permissions: { type: DataTypes.JSONB, allowNull: true },
      failedLoginAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      loginLockedUntil: { type: DataTypes.DATE, allowNull: true },
      lastLoginAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "xhunt_admin_managers",
      indexes: [
        { unique: true, fields: ["email"] },
        { fields: ["role"] },
        { fields: ["isActive", "canLogin"] },
        { fields: ["loginLockedUntil"] },
      ],
    }
  );

  return XhuntAdminManager;
};
