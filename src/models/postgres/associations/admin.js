/**
 * 管理后台相关模型关联 (WebAuthn 凭证)
 */
function setupAdminAssociations({
  XhuntAdminManager,
  XhuntAdminWebAuthnCredential,
}) {
  XhuntAdminManager.hasMany(XhuntAdminWebAuthnCredential, {
    foreignKey: "adminId",
    as: "webauthnCredentials",
  });
  XhuntAdminWebAuthnCredential.belongsTo(XhuntAdminManager, {
    foreignKey: "adminId",
    as: "admin",
  });
}

module.exports = {
  setupAdminAssociations,
};
