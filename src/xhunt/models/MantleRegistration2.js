const { DataTypes } = require("sequelize");

/**
 * MantleRegistration2 活动报名表（第二个活动）
 * 与 MantleRegistration 结构相同，表名为 MantleRegistrations2
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "MantleRegistration2",
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
      invitedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "邀请人的 XHunt 用户ID",
      },
      invitedByTwitterId: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "邀请人的推特ID",
      },
      invitedByUserInfo: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "邀请人的详细用户信息（JSON格式）",
      },
      invitedByUsername: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "邀请人的用户名",
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
      tableName: "MantleRegistrations2",
      timestamps: true,
      indexes: [
        { name: "idx_mantle2_user", fields: ["xHuntUserId"] },
        { name: "idx_mantle2_twitter", fields: ["twitterId"] },
        { name: "idx_mantle2_invited_by", fields: ["invitedByCode"] },
        { name: "idx_mantle2_invited_by_user", fields: ["invitedByUserId"] },
        {
          name: "idx_mantle2_invited_by_twitter",
          fields: ["invitedByTwitterId"],
        },
        {
          name: "idx_mantle2_invited_by_username",
          fields: ["invitedByUsername"],
        },
        { name: "idx_mantle2_evm_address", fields: ["evmAddress"] },
        { name: "idx_mantle2_registered_at", fields: ["registeredAt"] },
      ],
    }
  );
};
