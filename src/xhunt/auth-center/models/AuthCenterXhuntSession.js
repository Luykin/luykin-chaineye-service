const { DataTypes } = require("sequelize");

/**
 * 认证中心 XHunt 会话表
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "AuthCenterXhuntSession",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "Session ID",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "关联 AuthCenterXhuntUsers.id",
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "关联 AuthCenterXhuntClients.id",
      },
      clientKey: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: "客户端标识快照",
      },
      refreshTokenHash: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        comment: "Refresh Token SHA-256 哈希",
      },
      accessTokenJti: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: "当前 Access Token JTI",
      },
      fingerprint: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "设备指纹",
      },
      userAgent: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "User-Agent",
      },
      ipHash: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: "IP 哈希",
      },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "最近使用时间",
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: "Refresh Token 过期时间",
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "撤销时间",
      },
      revokeReason: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: "撤销原因",
      },
    },
    {
      tableName: "AuthCenterXhuntSessions",
      timestamps: true,
      indexes: [
        {
          name: "idx_auth_center_xhunt_sessions_user_id",
          fields: ["userId"],
        },
        {
          name: "idx_auth_center_xhunt_sessions_client_id",
          fields: ["clientId"],
        },
        {
          name: "idx_auth_center_xhunt_sessions_expires_at",
          fields: ["expiresAt"],
        },
        {
          name: "idx_auth_center_xhunt_sessions_revoked_at",
          fields: ["revokedAt"],
        },
        {
          name: "ux_auth_center_xhunt_sessions_refresh_hash",
          fields: ["refreshTokenHash"],
          unique: true,
        },
      ],
    }
  );
};
