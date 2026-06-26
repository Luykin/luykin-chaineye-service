const { DataTypes } = require("sequelize");

/**
 * 认证中心 XHunt 主账号表
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "AuthCenterXhuntUser",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "认证中心用户 ID",
      },
      accountName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "用户自己设置的账户名或邮箱",
      },
      accountNameLower: {
        type: DataTypes.STRING(255),
        allowNull: true,
        unique: true,
        comment: "小写账户名或邮箱，用于登录和唯一索引",
      },
      displayName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "用户自定义展示名",
      },
      avatar: {
        type: DataTypes.STRING(2048),
        allowNull: true,
        comment: "头像 URL",
      },
      primaryTwitterId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: "主要 Twitter 身份 ID",
      },
      primaryGoogleEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "主要 Google 邮箱",
      },
      primaryEvmAddress: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: "主要 EVM 地址，小写",
      },
      xhuntUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "关联旧 XHuntUsers.id",
      },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "active",
        comment: "账号状态：active/disabled/locked",
      },
      lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "最后登录时间",
      },
      loginCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "登录次数",
      },
      metadata: {
        type: DataTypes.JSONB || DataTypes.JSON,
        allowNull: true,
        comment: "扩展信息",
      },
    },
    {
      tableName: "AuthCenterXhuntUsers",
      timestamps: true,
      indexes: [
        {
          name: "idx_auth_center_xhunt_users_account_name_lower",
          fields: ["accountNameLower"],
          unique: true,
        },
        {
          name: "idx_auth_center_xhunt_users_xhunt_user_id",
          fields: ["xhuntUserId"],
        },
        {
          name: "idx_auth_center_xhunt_users_primary_twitter_id",
          fields: ["primaryTwitterId"],
        },
        {
          name: "idx_auth_center_xhunt_users_primary_evm_address",
          fields: ["primaryEvmAddress"],
        },
        {
          name: "idx_auth_center_xhunt_users_status",
          fields: ["status"],
        },
      ],
    }
  );
};
