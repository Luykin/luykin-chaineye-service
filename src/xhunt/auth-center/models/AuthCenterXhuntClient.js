const { DataTypes } = require("sequelize");

/**
 * 认证中心 XHunt 接入应用表
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "AuthCenterXhuntClient",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "Client ID",
      },
      clientKey: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        comment: "客户端标识",
      },
      clientName: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "客户端名称",
      },
      clientType: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "public",
        comment: "public/confidential",
      },
      clientSecretHash: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "服务端应用密钥哈希",
      },
      allowedRedirectUris: {
        type: DataTypes.JSONB || DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
        comment: "允许回调地址列表",
      },
      allowedOrigins: {
        type: DataTypes.JSONB || DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
        comment: "允许来源列表",
      },
      allowedScopes: {
        type: DataTypes.JSONB || DataTypes.JSON,
        allowNull: false,
        defaultValue: ["openid", "profile", "xhunt.basic"],
        comment: "允许 scope 列表",
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "是否启用",
      },
    },
    {
      tableName: "AuthCenterXhuntClients",
      timestamps: true,
      indexes: [
        {
          name: "ux_auth_center_xhunt_clients_client_key",
          fields: ["clientKey"],
          unique: true,
        },
        {
          name: "idx_auth_center_xhunt_clients_is_active",
          fields: ["isActive"],
        },
      ],
    }
  );
};
