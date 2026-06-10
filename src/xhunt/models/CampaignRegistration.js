const { DataTypes } = require("sequelize");

/**
 * 通用活动报名表，通过 campaign 字段区分不同活动
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "CampaignRegistration",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "报名记录唯一标识",
      },
      campaign: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "活动标识，例如 mantle3、partner2025 等",
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
        comment: "填写被哪个人邀请的邀请码",
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
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "可选：Email 报名地址（允许 Email 报名的活动可填写）",
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
      tableName: "CampaignRegistrations",
      timestamps: true,
      indexes: [
        { name: "idx_campaign_reg_campaign", fields: ["campaign"] },
        {
          name: "idx_campaign_reg_campaign_user",
          fields: ["campaign", "xHuntUserId"],
        },
        {
          name: "idx_campaign_reg_campaign_twitter",
          fields: ["campaign", "twitterId"],
        },
        {
          name: "idx_campaign_reg_campaign_evm",
          fields: ["campaign", "evmAddress"],
        },
        {
          name: "idx_campaign_reg_campaign_email",
          fields: ["campaign", "email"],
        },
        { name: "idx_campaign_reg_invite_code", fields: ["invitedByCode"] },
        { name: "idx_campaign_reg_invite_user", fields: ["invitedByUserId"] },
        {
          name: "idx_campaign_reg_invite_twitter",
          fields: ["invitedByTwitterId"],
        },
        {
          name: "idx_campaign_reg_invite_username",
          fields: ["invitedByUsername"],
        },
        { name: "idx_campaign_reg_registered_at", fields: ["registeredAt"] },
      ],
    }
  );
};
