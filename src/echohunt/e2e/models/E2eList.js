const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "E2eList",
    {
      tweet_id: { type: DataTypes.STRING, allowNull: false },
      user_id: { type: DataTypes.STRING, allowNull: false },
      campaign_sequence: { type: DataTypes.INTEGER, allowNull: true },
      rewards: { type: DataTypes.DECIMAL, allowNull: true },
      address: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      start_time: { type: DataTypes.DATE, allowNull: true },
      end_time: { type: DataTypes.DATE, allowNull: true },
      target: { type: DataTypes.BIGINT, allowNull: true },
      winners: { type: DataTypes.INTEGER, allowNull: true },
      text: { type: DataTypes.TEXT, allowNull: true },
      summary_cn: { type: DataTypes.TEXT, allowNull: true },
      owner_handle: { type: DataTypes.STRING, allowNull: true },
      owner_image_url: { type: DataTypes.STRING, allowNull: true },
      owner_user_id: { type: DataTypes.STRING, allowNull: true },
      summary_en: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: true },
      complete_tx: { type: DataTypes.STRING, allowNull: true },
      type: { type: DataTypes.STRING, allowNull: true },
      fees: { type: DataTypes.DECIMAL, allowNull: true },
      lang: { type: DataTypes.STRING, allowNull: true },
      retro: { type: DataTypes.BOOLEAN, allowNull: true },
    },
    {
      tableName: "EchohuntE2eLists",
      timestamps: false,
    }
  );
