const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "XhuntVipApiCallLog",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    clientKey: { type: DataTypes.STRING(64), allowNull: true },
    requestId: { type: DataTypes.STRING(128), allowNull: true },
    orderNo: { type: DataTypes.STRING(128), allowNull: true },
    action: { type: DataTypes.STRING(32), allowNull: false },
    twitterId: { type: DataTypes.STRING(64), allowNull: true },
    targetCount: { type: DataTypes.INTEGER, allowNull: true },
    requestHash: { type: DataTypes.STRING(64), allowNull: true },
    httpStatus: { type: DataTypes.INTEGER, allowNull: false },
    errorCode: { type: DataTypes.STRING(64), allowNull: true },
    replayed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    durationMs: { type: DataTypes.INTEGER, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
  },
  {
    tableName: "xhunt_vip_api_call_logs",
    timestamps: false,
    indexes: [
      { fields: ["createdAt"], name: "idx_xhunt_vip_api_logs_created_at" },
      { fields: ["clientKey", "createdAt"], name: "idx_xhunt_vip_api_logs_client_created" },
    ],
  }
);
