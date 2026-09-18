const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "BusinessCollaborationAuditLog",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    activityId: { type: DataTypes.UUID, allowNull: true },
    invitationId: { type: DataTypes.UUID, allowNull: true },
    collaborationId: { type: DataTypes.UUID, allowNull: true },
    actorAuthCenterUserId: { type: DataTypes.UUID, allowNull: true },
    actorType: { type: DataTypes.STRING(32), allowNull: false },
    action: { type: DataTypes.STRING(96), allowNull: false },
    requestId: { type: DataTypes.STRING(128), allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: true },
  },
  {
    tableName: "BusinessCollaborationAuditLogs",
    timestamps: true,
    indexes: [
      { name: "idx_business_collaboration_audit_activity_created", fields: ["activityId", "createdAt"] },
      { name: "idx_business_collaboration_audit_actor_created", fields: ["actorAuthCenterUserId", "createdAt"] },
    ],
  }
);
