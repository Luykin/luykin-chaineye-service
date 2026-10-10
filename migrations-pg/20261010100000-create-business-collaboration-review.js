"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("BusinessCollaborationReviewRounds", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      collaborationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "BusinessCollaborations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      roundNumber: { type: Sequelize.INTEGER, allowNull: false },
      draftUrl: { type: Sequelize.TEXT, allowNull: false },
      aiStatus: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "pending" },
      aiResult: { type: Sequelize.JSONB, allowNull: true },
      aiReviewedAt: { type: Sequelize.DATE, allowNull: true },
      humanStatus: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "waiting_ai" },
      humanComment: { type: Sequelize.STRING(2000), allowNull: true },
      humanReviewerType: { type: Sequelize.STRING(32), allowNull: true },
      humanReviewerAuthCenterUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      humanReviewerAdminId: { type: Sequelize.INTEGER, allowNull: true },
      humanReviewedAt: { type: Sequelize.DATE, allowNull: true },
      submittedByAuthCenterUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "AuthCenterXhuntUsers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      submitIdempotencyKey: { type: Sequelize.STRING(128), allowNull: true },
      decisionIdempotencyKey: { type: Sequelize.STRING(128), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addIndex("BusinessCollaborationReviewRounds", ["collaborationId", "roundNumber"], {
      unique: true,
      name: "ux_business_collaboration_review_round",
    });
    await queryInterface.addIndex("BusinessCollaborationReviewRounds", ["humanStatus", "createdAt"], { name: "idx_business_collaboration_review_round_human" });
    await queryInterface.addIndex("BusinessCollaborationReviewRounds", ["aiStatus"], { name: "idx_business_collaboration_review_round_ai" });

    await queryInterface.createTable("BusinessCollaborationDeliveries", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
      collaborationId: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: "BusinessCollaborations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      latestDraftUrl: { type: Sequelize.TEXT, allowNull: true },
      publishedUrl: { type: Sequelize.TEXT, allowNull: true },
      publishedAt: { type: Sequelize.DATE, allowNull: true },
      publishedIdempotencyKey: { type: Sequelize.STRING(128), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("BusinessCollaborationDeliveries");
    await queryInterface.dropTable("BusinessCollaborationReviewRounds");
  },
};
