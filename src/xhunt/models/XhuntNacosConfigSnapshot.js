module.exports = (sequelize) => {
  const { DataTypes } = require("sequelize");
  const XhuntNacosConfigSnapshot = sequelize.define(
    "XhuntNacosConfigSnapshot",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      dataId: { type: DataTypes.STRING(160), allowNull: false },
      group: { type: DataTypes.STRING(160), allowNull: false, defaultValue: "DEFAULT_GROUP" },
      tenant: { type: DataTypes.STRING(160), allowNull: true },
      type: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "json" },
      content: { type: DataTypes.TEXT, allowNull: false },
      contentSha256: { type: DataTypes.STRING(64), allowNull: false },
      contentLength: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      action: { type: DataTypes.STRING(64), allowNull: false },
      reason: { type: DataTypes.STRING(500), allowNull: true },
      operatorId: { type: DataTypes.INTEGER, allowNull: true },
      operatorEmail: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: "xhunt_nacos_config_snapshots",
      underscored: false,
      timestamps: true,
    }
  );
  return XhuntNacosConfigSnapshot;
};
