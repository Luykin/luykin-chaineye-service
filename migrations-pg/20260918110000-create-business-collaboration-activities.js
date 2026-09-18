"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("BusinessCollaborationActivities", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      name: { type: Sequelize.STRING(160), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      projectTwitterId: { type: Sequelize.STRING(64), allowNull: false },
      projectTwitterHandle: { type: Sequelize.STRING(128), allowNull: true },
      projectDisplayName: { type: Sequelize.STRING(256), allowNull: true },
      fundingPoolAmount: { type: Sequelize.DECIMAL(20, 2), allowNull: false },
      currency: { type: Sequelize.STRING(8), allowNull: false },
      reservedAmount: { type: Sequelize.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
      lockedAmount: { type: Sequelize.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
      claimableAmount: { type: Sequelize.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
      paidAmount: { type: Sequelize.DECIMAL(20, 2), allowNull: false, defaultValue: 0 },
      reservedSeatCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      confirmedSeatCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      seatLimit: { type: Sequelize.INTEGER, allowNull: false },
      startAt: { type: Sequelize.DATE, allowNull: false },
      endAt: { type: Sequelize.DATE, allowNull: false },
      reviewerMode: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "echohunt" },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "draft" },
      invitationTemplate: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("BusinessCollaborationActivities", ["status"], { name: "idx_business_collaboration_activities_status" });
    await queryInterface.addIndex("BusinessCollaborationActivities", ["projectTwitterId"], { name: "idx_business_collaboration_activities_project_twitter" });
    await queryInterface.addIndex("BusinessCollaborationActivities", ["endAt"], { name: "idx_business_collaboration_activities_end_at" });

    await queryInterface.createTable("BusinessCollaborationActivityAccesses", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      activityId: { type: Sequelize.UUID, allowNull: false, references: { model: "BusinessCollaborationActivities", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      authCenterUserId: { type: Sequelize.UUID, allowNull: false, references: { model: "AuthCenterXhuntUsers", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      twitterId: { type: Sequelize.STRING(64), allowNull: true },
      role: { type: Sequelize.STRING(32), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "active" },
      assignedByAdminId: { type: Sequelize.INTEGER, allowNull: true, references: { model: "xhunt_admin_managers", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      reason: { type: Sequelize.STRING(500), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("BusinessCollaborationActivityAccesses", ["activityId", "authCenterUserId"], { unique: true, name: "ux_business_collaboration_activity_access_user" });
    await queryInterface.addIndex("BusinessCollaborationActivityAccesses", ["activityId", "status"], { name: "idx_business_collaboration_activity_access_activity_status" });
    await queryInterface.addIndex("BusinessCollaborationActivityAccesses", ["authCenterUserId", "status"], { name: "idx_business_collaboration_activity_access_user_status" });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("BusinessCollaborationActivityAccesses");
    await queryInterface.dropTable("BusinessCollaborationActivities");
  },
};
