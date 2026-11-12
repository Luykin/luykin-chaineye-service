const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "XhuntVipOperation",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    clientKey: { type: DataTypes.STRING(64), allowNull: false },
    orderNo: { type: DataTypes.STRING(128), allowNull: false },
    action: { type: DataTypes.STRING(32), allowNull: false },
    twitterId: { type: DataTypes.STRING(64), allowNull: false },
    requestedExpiresAt: { type: DataTypes.DATE, allowNull: true },
    requestHash: { type: DataTypes.STRING(64), allowNull: false },
    previousExpiresAt: { type: DataTypes.DATE, allowNull: true },
    resultExpiresAt: { type: DataTypes.DATE, allowNull: false },
    executedAt: { type: DataTypes.DATE, allowNull: false },
    requestId: { type: DataTypes.STRING(128), allowNull: false },
    responseJson: { type: DataTypes.JSONB, allowNull: false },
  },
  {
    tableName: "xhunt_vip_operations",
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ["clientKey", "orderNo"],
        name: "uq_xhunt_vip_operations_client_order",
      },
      {
        fields: ["twitterId", "executedAt"],
        name: "idx_xhunt_vip_operations_twitter_executed",
      },
    ],
  }
);
