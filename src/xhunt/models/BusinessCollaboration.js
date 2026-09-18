const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "BusinessCollaboration",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    invitationId: { type: DataTypes.UUID, allowNull: false, unique: true },
    activityId: { type: DataTypes.UUID, allowNull: false },
    kolTwitterId: { type: DataTypes.STRING(64), allowNull: false },
    kolAuthCenterUserId: { type: DataTypes.UUID, allowNull: true },
    confirmedByAccessId: { type: DataTypes.UUID, allowNull: false },
    lockedAmount: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
    currency: { type: DataTypes.STRING(8), allowNull: false },
    payoutAddressSnapshot: { type: DataTypes.STRING(42), allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "confirmed" },
    confirmedAt: { type: DataTypes.DATE, allowNull: false },
  },
  {
    tableName: "BusinessCollaborations",
    timestamps: true,
    indexes: [
      { name: "idx_business_collaborations_activity_status", fields: ["activityId", "status"] },
      { name: "idx_business_collaborations_kol_status", fields: ["kolTwitterId", "status"] },
    ],
  }
);
