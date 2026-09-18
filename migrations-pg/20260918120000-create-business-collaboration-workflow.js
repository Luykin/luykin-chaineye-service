"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("XHuntKolCollaborations", "defaultPayoutAddress", {
      type: Sequelize.STRING(42),
      allowNull: true,
    });
    await queryInterface.addColumn("XHuntKolCollaborations", "payoutAddressUpdatedAt", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn("XHuntKolCollaborations", "payoutAddressVerifiedAt", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn("XHuntKolCollaborations", "payoutAddressVersion", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.createTable("BusinessCollaborationInvitations", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      activityId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "BusinessCollaborationActivities", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      kolTwitterId: { type: Sequelize.STRING(64), allowNull: false },
      kolAuthCenterUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      inviterAccessId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "BusinessCollaborationActivityAccesses", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      invitationSnapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      offerAmount: { type: Sequelize.DECIMAL(20, 2), allowNull: false },
      currency: { type: Sequelize.STRING(8), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "sent" },
      acceptedAt: { type: Sequelize.DATE, allowNull: true },
      reservationExpiresAt: { type: Sequelize.DATE, allowNull: true },
      acceptedPayoutAddressSnapshot: { type: Sequelize.STRING(42), allowNull: true },
      createIdempotencyKey: { type: Sequelize.STRING(128), allowNull: true },
      acceptIdempotencyKey: { type: Sequelize.STRING(128), allowNull: true },
      confirmIdempotencyKey: { type: Sequelize.STRING(128), allowNull: true },
      declineReason: { type: Sequelize.STRING(1000), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("BusinessCollaborationInvitations", ["activityId", "kolTwitterId"], {
      unique: true,
      name: "ux_business_collaboration_invitation_activity_kol",
    });
    await queryInterface.addIndex("BusinessCollaborationInvitations", ["kolTwitterId", "status"], { name: "idx_business_collaboration_invitation_kol_status" });
    await queryInterface.addIndex("BusinessCollaborationInvitations", ["activityId", "status"], { name: "idx_business_collaboration_invitation_activity_status" });
    await queryInterface.addIndex("BusinessCollaborationInvitations", ["activityId", "inviterAccessId", "createIdempotencyKey"], { name: "idx_business_collaboration_invitation_create_idempotency" });

    await queryInterface.createTable("BusinessCollaborations", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      invitationId: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: "BusinessCollaborationInvitations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      activityId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "BusinessCollaborationActivities", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      kolTwitterId: { type: Sequelize.STRING(64), allowNull: false },
      kolAuthCenterUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      confirmedByAccessId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "BusinessCollaborationActivityAccesses", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      lockedAmount: { type: Sequelize.DECIMAL(20, 2), allowNull: false },
      currency: { type: Sequelize.STRING(8), allowNull: false },
      payoutAddressSnapshot: { type: Sequelize.STRING(42), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "confirmed" },
      confirmedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("BusinessCollaborations", ["activityId", "status"], { name: "idx_business_collaborations_activity_status" });
    await queryInterface.addIndex("BusinessCollaborations", ["kolTwitterId", "status"], { name: "idx_business_collaborations_kol_status" });

    await queryInterface.createTable("BusinessCollaborationBudgetLedgers", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      activityId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "BusinessCollaborationActivities", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      invitationId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "BusinessCollaborationInvitations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      collaborationId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "BusinessCollaborations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      type: { type: Sequelize.STRING(32), allowNull: false },
      amount: { type: Sequelize.DECIMAL(20, 2), allowNull: false },
      currency: { type: Sequelize.STRING(8), allowNull: false },
      idempotencyKey: { type: Sequelize.STRING(128), allowNull: false },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("BusinessCollaborationBudgetLedgers", ["idempotencyKey"], {
      unique: true,
      name: "ux_business_collaboration_budget_ledger_idempotency",
    });
    await queryInterface.addIndex("BusinessCollaborationBudgetLedgers", ["activityId", "createdAt"], { name: "idx_business_collaboration_budget_ledger_activity_created" });

    await queryInterface.createTable("BusinessCollaborationAuditLogs", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      activityId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "BusinessCollaborationActivities", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      invitationId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "BusinessCollaborationInvitations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      collaborationId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "BusinessCollaborations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      actorAuthCenterUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      actorType: { type: Sequelize.STRING(32), allowNull: false },
      action: { type: Sequelize.STRING(96), allowNull: false },
      requestId: { type: Sequelize.STRING(128), allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("BusinessCollaborationAuditLogs", ["activityId", "createdAt"], { name: "idx_business_collaboration_audit_activity_created" });
    await queryInterface.addIndex("BusinessCollaborationAuditLogs", ["actorAuthCenterUserId", "createdAt"], { name: "idx_business_collaboration_audit_actor_created" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("BusinessCollaborationAuditLogs");
    await queryInterface.dropTable("BusinessCollaborationBudgetLedgers");
    await queryInterface.dropTable("BusinessCollaborations");
    await queryInterface.dropTable("BusinessCollaborationInvitations");
    await queryInterface.removeColumn("XHuntKolCollaborations", "payoutAddressVersion");
    await queryInterface.removeColumn("XHuntKolCollaborations", "payoutAddressVerifiedAt");
    await queryInterface.removeColumn("XHuntKolCollaborations", "payoutAddressUpdatedAt");
    await queryInterface.removeColumn("XHuntKolCollaborations", "defaultPayoutAddress");
  },
};
