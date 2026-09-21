/**
 * XHunt 外部周边 Web 认证用户模型关联
 */
function setupWebUserAssociations({
  XHuntWebUser,
  XHuntWebUserToken,
}) {
  XHuntWebUser.hasMany(XHuntWebUserToken, {
    foreignKey: "userId",
    as: "tokens",
  });
  XHuntWebUserToken.belongsTo(XHuntWebUser, {
    foreignKey: "userId",
    as: "user",
  });
}

module.exports = {
  setupWebUserAssociations,
};
