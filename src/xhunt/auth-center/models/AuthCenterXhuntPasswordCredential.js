const { DataTypes } = require("sequelize");

/**
 * 认证中心 XHunt 密码凭证表
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "AuthCenterXhuntPasswordCredential",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "密码凭证 ID",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        comment: "关联 AuthCenterXhuntUsers.id",
      },
      usernameLower: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        comment: "登录账户名或邮箱小写",
      },
      passwordHash: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: "密码哈希",
      },
      passwordAlgo: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "bcrypt",
        comment: "密码哈希算法",
      },
      passwordVersion: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: "密码策略版本",
      },
      failedAttempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "连续失败次数",
      },
      lockedUntil: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "锁定到期时间",
      },
      passwordChangedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: "密码最后修改时间",
      },
    },
    {
      tableName: "AuthCenterXhuntPasswordCredentials",
      timestamps: true,
      indexes: [
        {
          name: "ux_auth_center_xhunt_password_user_id",
          fields: ["userId"],
          unique: true,
        },
        {
          name: "ux_auth_center_xhunt_password_username_lower",
          fields: ["usernameLower"],
          unique: true,
        },
        {
          name: "idx_auth_center_xhunt_password_locked_until",
          fields: ["lockedUntil"],
        },
      ],
    }
  );
};
