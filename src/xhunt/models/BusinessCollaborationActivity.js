const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "BusinessCollaborationActivity",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING(160), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      projectTwitterId: { type: DataTypes.STRING(64), allowNull: false },
      projectTwitterHandle: { type: DataTypes.STRING(128), allowNull: true },
      projectDisplayName: { type: DataTypes.STRING(256), allowNull: true },
      fundingPoolAmount: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
      currency: { type: DataTypes.STRING(8), allowNull: false },
      reservedAmount: { type: DataTypes.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
      lockedAmount: { type: DataTypes.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
      claimableAmount: { type: DataTypes.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
      paidAmount: { type: DataTypes.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
      reservedSeatCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      confirmedSeatCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      seatLimit: { type: DataTypes.INTEGER, allowNull: false },
      startAt: { type: DataTypes.DATE, allowNull: false },
      endAt: { type: DataTypes.DATE, allowNull: false },
      reviewerMode: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "echohunt" },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "draft" },
      invitationTemplate: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      tableName: "BusinessCollaborationActivities",
      timestamps: true,
      indexes: [
        { name: "idx_business_collaboration_activities_status", fields: ["status"] },
        { name: "idx_business_collaboration_activities_project_twitter", fields: ["projectTwitterId"] },
        { name: "idx_business_collaboration_activities_end_at", fields: ["endAt"] },
      ],
    }
  );
