const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "E2eTweet",
    {
      tweet_id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      text: { type: DataTypes.TEXT, allowNull: true },
      summary_cn: { type: DataTypes.TEXT, allowNull: true },
      summary_en: { type: DataTypes.TEXT, allowNull: true },
      owner_handle: { type: DataTypes.STRING, allowNull: true },
      owner_image_url: { type: DataTypes.STRING, allowNull: true },
      owner_user_id: { type: DataTypes.STRING, allowNull: true },
      political: { type: DataTypes.BOOLEAN, allowNull: true },
      sexual: { type: DataTypes.BOOLEAN, allowNull: true },
      violence: { type: DataTypes.BOOLEAN, allowNull: true },
      abusive: { type: DataTypes.BOOLEAN, allowNull: true },
      explanation: { type: DataTypes.TEXT, allowNull: true },
      passed: { type: DataTypes.BOOLEAN, allowNull: true },
      html: { type: DataTypes.TEXT, allowNull: true },
      engage_data: { type: DataTypes.JSONB, allowNull: true },
    },
    {
      tableName: "EchohuntE2eTweets",
      timestamps: false,
    }
  );
