const { DataTypes } = require("sequelize");

/**
 * 认证中心 XHunt OAuth 授权码表（预留）
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "AuthCenterXhuntAuthorizationCode",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "授权码记录 ID",
      },
      codeHash: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        comment: "授权码哈希",
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "关联 AuthCenterXhuntClients.id",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "关联 AuthCenterXhuntUsers.id",
      },
      redirectUri: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: "回调地址",
      },
      scope: {
        type: DataTypes.STRING(512),
        allowNull: true,
        comment: "授权范围",
      },
      codeChallenge: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "PKCE challenge",
      },
      codeChallengeMethod: {
        type: DataTypes.STRING(32),
        allowNull: true,
        comment: "PKCE challenge method",
      },
      nonce: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "OIDC nonce",
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: "过期时间",
      },
      consumedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "使用时间",
      },
    },
    {
      tableName: "AuthCenterXhuntAuthorizationCodes",
      timestamps: true,
      indexes: [
        {
          name: "ux_auth_center_xhunt_codes_code_hash",
          fields: ["codeHash"],
          unique: true,
        },
        {
          name: "idx_auth_center_xhunt_codes_client_user",
          fields: ["clientId", "userId"],
        },
        {
          name: "idx_auth_center_xhunt_codes_expires_at",
          fields: ["expiresAt"],
        },
      ],
    }
  );
};
