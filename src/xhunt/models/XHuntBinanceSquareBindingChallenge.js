const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "XHuntBinanceSquareBindingChallenge",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      twitterId: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      twitterUsername: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      xhuntUserId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      authCenterUserId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      verificationCode: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      verificationText: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "pending",
        comment: "pending/verified/expired/failed/cancelled",
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      verifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      attemptCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      lastAttemptAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastPostUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      lastPostId: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      lastErrorCode: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      lastErrorMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "XHuntBinanceSquareBindingChallenges",
      timestamps: true,
      indexes: [
        { name: "idx_xhunt_bs_challenges_twitter_status", fields: ["twitterId", "status"] },
        { name: "idx_xhunt_bs_challenges_code", fields: ["verificationCode"] },
        { name: "idx_xhunt_bs_challenges_expires", fields: ["expiresAt"] },
        { name: "idx_xhunt_bs_challenges_post_id", fields: ["lastPostId"] },
      ],
    }
  );
};
