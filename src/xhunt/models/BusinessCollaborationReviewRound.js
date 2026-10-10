const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "BusinessCollaborationReviewRound",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    collaborationId: { type: DataTypes.UUID, allowNull: false },
    roundNumber: { type: DataTypes.INTEGER, allowNull: false },
    draftUrl: { type: DataTypes.TEXT, allowNull: false },
    aiStatus: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "pending" },
    aiResult: { type: DataTypes.JSONB, allowNull: true },
    aiReviewedAt: { type: DataTypes.DATE, allowNull: true },
    humanStatus: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "waiting_ai" },
    humanComment: { type: DataTypes.STRING(2000), allowNull: true },
    humanReviewerType: { type: DataTypes.STRING(32), allowNull: true },
    humanReviewerAuthCenterUserId: { type: DataTypes.UUID, allowNull: true },
    humanReviewerAdminId: { type: DataTypes.INTEGER, allowNull: true },
    humanReviewedAt: { type: DataTypes.DATE, allowNull: true },
    submittedByAuthCenterUserId: { type: DataTypes.UUID, allowNull: true },
    submitIdempotencyKey: { type: DataTypes.STRING(128), allowNull: true },
    decisionIdempotencyKey: { type: DataTypes.STRING(128), allowNull: true },
  },
  {
    tableName: "BusinessCollaborationReviewRounds",
    timestamps: true,
    indexes: [
      { name: "ux_business_collaboration_review_round", fields: ["collaborationId", "roundNumber"], unique: true },
      { name: "idx_business_collaboration_review_round_human", fields: ["humanStatus", "createdAt"] },
      { name: "idx_business_collaboration_review_round_ai", fields: ["aiStatus"] },
    ],
  }
);
