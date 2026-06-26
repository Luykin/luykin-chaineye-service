const { DataTypes } = require("sequelize");

/**
 * 认证中心 XHunt 审计日志表
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "AuthCenterXhuntAuditLog",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "审计日志 ID",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "用户 ID",
      },
      clientKey: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: "客户端标识",
      },
      eventType: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: "事件类型",
      },
      provider: {
        type: DataTypes.STRING(32),
        allowNull: true,
        comment: "登录方式",
      },
      success: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "是否成功",
      },
      reason: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "原因",
      },
      fingerprint: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "设备指纹",
      },
      ipHash: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: "IP 哈希",
      },
      metadata: {
        type: DataTypes.JSONB || DataTypes.JSON,
        allowNull: true,
        comment: "扩展信息",
      },
    },
    {
      tableName: "AuthCenterXhuntAuditLogs",
      timestamps: true,
      indexes: [
        {
          name: "idx_auth_center_xhunt_audit_user_id",
          fields: ["userId"],
        },
        {
          name: "idx_auth_center_xhunt_audit_event_type",
          fields: ["eventType"],
        },
        {
          name: "idx_auth_center_xhunt_audit_created_at",
          fields: ["createdAt"],
        },
      ],
    }
  );
};
