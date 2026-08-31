const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "EchohuntSocialListeningAccessAuditLog",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "Social Listening 操作审计日志 ID",
      },
      boardId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "关联看板 ID；导出等全局操作可为空",
      },
      accessId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "关联授权记录 ID；非授权类操作可为空",
      },
      adminId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "后台操作管理员 ID；前台用户操作为空",
      },
      authCenterUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "前台操作 AuthCenter 用户 ID；后台操作可为空",
      },
      action: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: "操作类型：board_create/board_update/access_grant/export 等",
      },
      targetTwitterHandle: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: "操作目标 X handle，例如被授权用户 handle",
      },
      targetAuthCenterUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "操作目标 AuthCenter 用户 ID，例如被授权用户 ID",
      },
      payload: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: "审计详情 JSON；只记录安全白名单字段，不写密钥/Token",
      },
    },
    {
      tableName: "EchohuntSocialListeningAccessAuditLogs",
      timestamps: true,
      updatedAt: false,
      indexes: [
        { name: "idx_echohunt_sl_audit_board_created", fields: ["boardId", "createdAt"] },
        { name: "idx_echohunt_sl_audit_target_handle_created", fields: ["targetTwitterHandle", "createdAt"] },
        { name: "idx_echohunt_sl_audit_admin_created", fields: ["adminId", "createdAt"] },
        { name: "idx_echohunt_sl_audit_auth_user_created", fields: ["authCenterUserId", "createdAt"] },
      ],
    }
  );
};
