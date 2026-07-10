const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "XHuntBinanceSquareBinding",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      twitterId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: "EchoHunt 用户 Twitter ID，绑定关系主键",
      },
      twitterUsername: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: "Twitter handle，仅用于展示和排查",
      },
      xhuntUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "关联旧 XHuntUsers.id，冗余字段",
      },
      authCenterUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "关联 AuthCenterXhuntUsers.id，冗余字段",
      },
      binanceSquareUid: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "Binance Square squareUid，一对一绑定主键",
      },
      binanceUsername: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "Binance Square username",
      },
      binanceDisplayName: {
        type: DataTypes.STRING(256),
        allowNull: true,
      },
      binanceAvatar: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      verificationPostId: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      verificationPostUrl: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      verificationCode: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      verifiedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "active",
        comment: "active/revoked",
      },
      rawAuthorData: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      rawPostData: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      tableName: "XHuntBinanceSquareBindings",
      timestamps: true,
      indexes: [
        { name: "idx_xhunt_bs_bindings_twitter_status", fields: ["twitterId", "status"] },
        { name: "idx_xhunt_bs_bindings_square_uid_status", fields: ["binanceSquareUid", "status"] },
        { name: "idx_xhunt_bs_bindings_username_status", fields: ["binanceUsername", "status"] },
        { name: "idx_xhunt_bs_bindings_post_id", fields: ["verificationPostId"] },
        { name: "idx_xhunt_bs_bindings_verified_at", fields: ["verifiedAt"] },
      ],
    }
  );
};
