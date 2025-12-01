module.exports = (sequelize) => {
  const { DataTypes } = require("sequelize");
  const XhuntAdminAuditLog = sequelize.define(
    "XhuntAdminAuditLog",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      adminId: { type: DataTypes.INTEGER, allowNull: false },
      email: { type: DataTypes.STRING, allowNull: false },
      action: { type: DataTypes.STRING(64), allowNull: false },
      route: { type: DataTypes.STRING(256), allowNull: true },
      method: { type: DataTypes.STRING(8), allowNull: true },
      ip: { type: DataTypes.STRING(64), allowNull: true },
      userAgent: { type: DataTypes.STRING(512), allowNull: true },
      payload: { type: DataTypes.TEXT, allowNull: true },
      success: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      message: { type: DataTypes.STRING(512), allowNull: true },
    },
    {
      tableName: "xhunt_admin_audit_logs",
      underscored: false,
      timestamps: true,
    }
  );
  return XhuntAdminAuditLog;
};
