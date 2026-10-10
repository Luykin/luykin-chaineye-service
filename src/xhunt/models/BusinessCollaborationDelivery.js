const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "BusinessCollaborationDelivery",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    collaborationId: { type: DataTypes.UUID, allowNull: false, unique: true },
    latestDraftUrl: { type: DataTypes.TEXT, allowNull: true },
    publishedUrl: { type: DataTypes.TEXT, allowNull: true },
    publishedAt: { type: DataTypes.DATE, allowNull: true },
    publishedIdempotencyKey: { type: DataTypes.STRING(128), allowNull: true },
  },
  {
    tableName: "BusinessCollaborationDeliveries",
    timestamps: true,
  }
);
