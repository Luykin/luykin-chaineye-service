const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "E2eLog",
    {
      tweet_id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      user_id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      calc_time: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        primaryKey: true,
      },
      username: { type: DataTypes.STRING, allowNull: true },
      point: { type: DataTypes.DECIMAL, allowNull: true },
      explanation: { type: DataTypes.TEXT, allowNull: true },
      address: { type: DataTypes.STRING, allowNull: true },
      score_breakdown: { type: DataTypes.JSONB, allowNull: true },
    },
    {
      tableName: "EchohuntE2eLogs",
      timestamps: false,
    }
  );
