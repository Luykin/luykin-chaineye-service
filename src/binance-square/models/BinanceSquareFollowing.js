const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "BinanceSquareFollowing",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      followerUsername: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "关注者用户名（种子用户）",
      },
      followingUsername: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "被关注者用户名",
      },
      followingSquareUid: {
        type: DataTypes.STRING(64),
        comment: "被关注者SquareUid —— API返回，可能缺失",
      },
    },
    {
      tableName: "BinanceSquareFollowings",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["followerUsername", "followingUsername"], name: "idx_binance_square_followings_unique" },
        { fields: ["followerUsername"], name: "idx_binance_square_followings_follower" },
        { fields: ["followingUsername"], name: "idx_binance_square_followings_following" },
      ],
    }
  );
};
