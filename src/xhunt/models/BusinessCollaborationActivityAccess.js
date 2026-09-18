const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "BusinessCollaborationActivityAccess",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      activityId: { type: DataTypes.UUID, allowNull: false },
      authCenterUserId: { type: DataTypes.UUID, allowNull: false },
      twitterId: { type: DataTypes.STRING(64), allowNull: true },
      role: { type: DataTypes.STRING(32), allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "active" },
      assignedByAdminId: { type: DataTypes.INTEGER, allowNull: true },
      reason: { type: DataTypes.STRING(500), allowNull: true },
    },
    {
      tableName: "BusinessCollaborationActivityAccesses",
      timestamps: true,
      indexes: [
        { name: "ux_business_collaboration_activity_access_user", fields: ["activityId", "authCenterUserId"], unique: true },
        { name: "idx_business_collaboration_activity_access_activity_status", fields: ["activityId", "status"] },
        { name: "idx_business_collaboration_activity_access_user_status", fields: ["authCenterUserId", "status"] },
      ],
    }
  );
