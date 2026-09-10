const { DataTypes } = require("sequelize");

module.exports = (sequelize) => sequelize.define(
  "EchohuntFeatureAccess",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, comment: "功能授权记录 ID" },
    featureKey: { type: DataTypes.STRING(64), allowNull: false, comment: "功能标识，例如 kol-match、social-listening" },
    resourceId: { type: DataTypes.STRING(128), allowNull: false, defaultValue: "global", comment: "功能内资源标识；全局功能使用 global，舆论监控使用看板 ID" },
    twitterId: { type: DataTypes.STRING(64), allowNull: true, comment: "被授权用户的 Twitter user id" },
    twitterHandle: { type: DataTypes.STRING(64), allowNull: false, comment: "被授权用户 X handle，去 @ 后统一小写" },
    authCenterUserId: { type: DataTypes.UUID, allowNull: true, comment: "关联 AuthCenterXhuntUsers.id" },
    xhuntUserId: { type: DataTypes.UUID, allowNull: true, comment: "兼容关联旧 XHuntUsers.id" },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "active", comment: "授权状态：active/revoked" },
    grantedByAdminId: { type: DataTypes.INTEGER, allowNull: true, comment: "授予授权的管理员 ID" },
    revokedByAdminId: { type: DataTypes.INTEGER, allowNull: true, comment: "撤销授权的管理员 ID" },
    grantedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, comment: "授权生效时间" },
    revokedAt: { type: DataTypes.DATE, allowNull: true, comment: "撤销授权时间" },
    metadata: { type: DataTypes.JSONB, allowNull: true, comment: "授权扩展信息" },
  },
  {
    tableName: "EchohuntFeatureAccesses",
    timestamps: true,
    indexes: [
      { name: "ux_echohunt_feature_access_active_scope_handle", unique: true, fields: ["featureKey", "resourceId", "twitterHandle"], where: { status: "active" } },
      { name: "idx_echohunt_feature_access_subject", fields: ["featureKey", "resourceId", "authCenterUserId", "status"] },
      { name: "idx_echohunt_feature_access_twitter", fields: ["featureKey", "resourceId", "twitterId", "status"] },
    ],
  }
);
