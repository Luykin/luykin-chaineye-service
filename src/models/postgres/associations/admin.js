/**
 * 管理后台相关模型关联 (WebAuthn 凭证)
 */
function setupAdminAssociations({
  XhuntAdminManager,
  XhuntAdminWebAuthnCredential,
  XhuntAdminDbTableGrant,
}) {
  XhuntAdminManager.hasMany(XhuntAdminWebAuthnCredential, {
    foreignKey: "adminId",
    as: "webauthnCredentials",
  });
  XhuntAdminWebAuthnCredential.belongsTo(XhuntAdminManager, {
    foreignKey: "adminId",
    as: "admin",
  });
  XhuntAdminManager.hasMany(XhuntAdminDbTableGrant, {
    foreignKey: "adminId",
    as: "dbTableGrants",
  });
  XhuntAdminDbTableGrant.belongsTo(XhuntAdminManager, {
    foreignKey: "adminId",
    as: "admin",
  });
  XhuntAdminDbTableGrant.belongsTo(XhuntAdminManager, {
    foreignKey: "grantedByAdminId",
    as: "grantedByAdmin",
  });
}

module.exports = {
  setupAdminAssociations,
};
