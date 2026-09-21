/**
 * 统一认证中心模型关联与 KOL 合作绑定
 */
function setupAuthCenterAssociations({
  AuthCenterXhuntUser,
  AuthCenterXhuntIdentity,
  AuthCenterXhuntPasswordCredential,
  AuthCenterXhuntSession,
  AuthCenterXhuntClient,
  AuthCenterXhuntAuthorizationCode,
  AuthCenterXhuntAuditLog,
  XHuntKolCollaboration,
  XHuntUser,
}) {
  // 用户与登录身份 (1对多: password, google, twitter, evm)
  AuthCenterXhuntUser.hasMany(AuthCenterXhuntIdentity, {
    foreignKey: "userId",
    as: "identities",
  });
  AuthCenterXhuntIdentity.belongsTo(AuthCenterXhuntUser, {
    foreignKey: "userId",
    as: "user",
  });

  // 用户与密码凭据 (1对1)
  AuthCenterXhuntUser.hasOne(AuthCenterXhuntPasswordCredential, {
    foreignKey: "userId",
    as: "passwordCredential",
  });
  AuthCenterXhuntPasswordCredential.belongsTo(AuthCenterXhuntUser, {
    foreignKey: "userId",
    as: "user",
  });

  // 用户与会话
  AuthCenterXhuntUser.hasMany(AuthCenterXhuntSession, {
    foreignKey: "userId",
    as: "sessions",
  });
  AuthCenterXhuntSession.belongsTo(AuthCenterXhuntUser, {
    foreignKey: "userId",
    as: "user",
  });

  // 接入客户端与会话
  AuthCenterXhuntClient.hasMany(AuthCenterXhuntSession, {
    foreignKey: "clientId",
    as: "sessions",
  });
  AuthCenterXhuntSession.belongsTo(AuthCenterXhuntClient, {
    foreignKey: "clientId",
    as: "client",
  });

  // 接入客户端与授权码
  AuthCenterXhuntClient.hasMany(AuthCenterXhuntAuthorizationCode, {
    foreignKey: "clientId",
    as: "authorizationCodes",
  });
  AuthCenterXhuntAuthorizationCode.belongsTo(AuthCenterXhuntClient, {
    foreignKey: "clientId",
    as: "client",
  });

  // 用户与授权码
  AuthCenterXhuntUser.hasMany(AuthCenterXhuntAuthorizationCode, {
    foreignKey: "userId",
    as: "authorizationCodes",
  });
  AuthCenterXhuntAuthorizationCode.belongsTo(AuthCenterXhuntUser, {
    foreignKey: "userId",
    as: "user",
  });

  // 用户与审计日志
  AuthCenterXhuntUser.hasMany(AuthCenterXhuntAuditLog, {
    foreignKey: "userId",
    as: "authCenterAuditLogs",
  });
  AuthCenterXhuntAuditLog.belongsTo(AuthCenterXhuntUser, {
    foreignKey: "userId",
    as: "user",
  });

  // KOL 合作关联 (AuthCenterUser 与 XHuntUser 互联)
  AuthCenterXhuntUser.hasOne(XHuntKolCollaboration, {
    foreignKey: "authCenterUserId",
    as: "kolCollaboration",
  });
  XHuntKolCollaboration.belongsTo(AuthCenterXhuntUser, {
    foreignKey: "authCenterUserId",
    as: "authCenterUser",
  });

  XHuntUser.hasOne(XHuntKolCollaboration, {
    foreignKey: "xhuntUserId",
    as: "kolCollaboration",
  });
  XHuntKolCollaboration.belongsTo(XHuntUser, {
    foreignKey: "xhuntUserId",
    as: "xhuntUser",
  });
}

module.exports = {
  setupAuthCenterAssociations,
};
