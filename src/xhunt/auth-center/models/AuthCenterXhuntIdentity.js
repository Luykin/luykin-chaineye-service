const { DataTypes } = require("sequelize");

/**
 * 认证中心 XHunt 登录身份表
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "AuthCenterXhuntIdentity",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "登录身份 ID",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "关联 AuthCenterXhuntUsers.id",
      },
      provider: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: "password/google/evm/twitter",
      },
      providerSubject: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "第三方唯一标识",
      },
      providerSubjectLower: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "规范化小写唯一标识",
      },
      username: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "第三方用户名或账户名",
      },
      displayName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "第三方展示名",
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "邮箱",
      },
      emailVerified: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        comment: "邮箱是否验证",
      },
      avatar: {
        type: DataTypes.STRING(2048),
        allowNull: true,
        comment: "第三方头像 URL",
      },
      accessTokenEncrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "第三方 access token（预留加密存储）",
      },
      refreshTokenEncrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "第三方 refresh token（预留加密存储）",
      },
      tokenExpiry: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "第三方 token 过期时间",
      },
      isPrimary: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "是否为该 provider 的主要身份",
      },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "最近使用时间",
      },
    },
    {
      tableName: "AuthCenterXhuntIdentities",
      timestamps: true,
      indexes: [
        {
          name: "ux_auth_center_xhunt_identity_provider_subject",
          fields: ["provider", "providerSubjectLower"],
          unique: true,
        },
        {
          name: "ux_auth_center_xhunt_identity_user_provider",
          fields: ["userId", "provider"],
          unique: true,
        },
        {
          name: "idx_auth_center_xhunt_identity_user_id",
          fields: ["userId"],
        },
      ],
    }
  );
};
