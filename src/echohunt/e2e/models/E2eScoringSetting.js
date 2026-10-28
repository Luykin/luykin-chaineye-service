const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "E2eScoringSetting",
    {
      scope: { type: DataTypes.STRING(32), allowNull: false, primaryKey: true },
      config: { type: DataTypes.JSONB, allowNull: false },
      updated_by: { type: DataTypes.BIGINT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "EchohuntE2eScoringSettings",
      timestamps: false,
    }
  );
