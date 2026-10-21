const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "E2eRecord",
    {
      tweet_id: { type: DataTypes.STRING, allowNull: false },
      user_id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      fan_rank: { type: DataTypes.BIGINT, allowNull: true },
      username: { type: DataTypes.STRING, allowNull: true },
      name: { type: DataTypes.STRING, allowNull: true },
      point: { type: DataTypes.DECIMAL, allowNull: true },
      profile_image_url: { type: DataTypes.STRING, allowNull: true },
      rewards: { type: DataTypes.DECIMAL, allowNull: true },
      address: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      user_address: { type: DataTypes.STRING, allowNull: true },
      create_time: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      update_time: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      explaination: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "EchohuntE2eRecords",
      timestamps: false,
    }
  );
