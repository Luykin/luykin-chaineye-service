const { DataTypes } = require("sequelize");

/**
 * MantleRegistration 活动报名表
 * 记录报名用户的基础信息、报名时间、可选的邀请人邀请码、可选的 EVM 地址
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "MantleRegistration",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "报名记录唯一标识",
      },
      xHuntUserId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "关联的 XHuntUser.id",
      },
      twitterId: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "用户 Twitter ID（字符串）",
      },
      username: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "用户登录名（可为空）",
      },
      displayName: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "用户显示名称",
      },
      avatar: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "用户头像 URL",
      },
      invitedByCode: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "可选：填写被哪个人邀请的邀请码",
      },
      evmAddress: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "可选：EVM 地址",
      },
      registrationUrl: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "报名当时的网址",
      },
      registeredAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: "报名时间",
      },
    },
    {
      tableName: "MantleRegistrations",
      timestamps: true,
      indexes: [
        { name: "idx_mantle_user", fields: ["xHuntUserId"] },
        { name: "idx_mantle_twitter", fields: ["twitterId"] },
        { name: "idx_mantle_invited_by", fields: ["invitedByCode"] },
        { name: "idx_mantle_registered_at", fields: ["registeredAt"] },
      ],
    }
  );
};
