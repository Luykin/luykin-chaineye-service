const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "BusinessCollaborationBudgetLedger",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    activityId: { type: DataTypes.UUID, allowNull: false },
    invitationId: { type: DataTypes.UUID, allowNull: true },
    collaborationId: { type: DataTypes.UUID, allowNull: true },
    type: { type: DataTypes.STRING(32), allowNull: false },
    amount: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
    currency: { type: DataTypes.STRING(8), allowNull: false },
    idempotencyKey: { type: DataTypes.STRING(128), allowNull: false },
    metadata: { type: DataTypes.JSONB, allowNull: true },
  },
  {
    tableName: "BusinessCollaborationBudgetLedgers",
    timestamps: true,
    indexes: [
      { name: "ux_business_collaboration_budget_ledger_idempotency", fields: ["idempotencyKey"], unique: true },
      { name: "idx_business_collaboration_budget_ledger_activity_created", fields: ["activityId", "createdAt"] },
    ],
  }
);
