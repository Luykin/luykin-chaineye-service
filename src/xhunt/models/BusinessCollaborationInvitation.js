const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "BusinessCollaborationInvitation",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    activityId: { type: DataTypes.UUID, allowNull: false },
    kolTwitterId: { type: DataTypes.STRING(64), allowNull: false },
    kolAuthCenterUserId: { type: DataTypes.UUID, allowNull: true },
    inviterAccessId: { type: DataTypes.UUID, allowNull: false },
    invitationSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    offerAmount: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
    currency: { type: DataTypes.STRING(8), allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "sent" },
    acceptedAt: { type: DataTypes.DATE, allowNull: true },
    reservationExpiresAt: { type: DataTypes.DATE, allowNull: true },
    acceptedPayoutAddressSnapshot: { type: DataTypes.STRING(42), allowNull: true },
    createIdempotencyKey: { type: DataTypes.STRING(128), allowNull: true },
    acceptIdempotencyKey: { type: DataTypes.STRING(128), allowNull: true },
    confirmIdempotencyKey: { type: DataTypes.STRING(128), allowNull: true },
    declineReason: { type: DataTypes.STRING(1000), allowNull: true },
  },
  {
    tableName: "BusinessCollaborationInvitations",
    timestamps: true,
    indexes: [
      { name: "ux_business_collaboration_invitation_activity_kol", fields: ["activityId", "kolTwitterId"], unique: true },
      { name: "idx_business_collaboration_invitation_kol_status", fields: ["kolTwitterId", "status"] },
      { name: "idx_business_collaboration_invitation_activity_status", fields: ["activityId", "status"] },
      { name: "idx_business_collaboration_invitation_create_idempotency", fields: ["activityId", "inviterAccessId", "createIdempotencyKey"] },
    ],
  }
);
