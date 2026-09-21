/**
 * XHunt 核心业务模型关联 (用户、账号、点评、积分、备注、配置、Pro订阅)
 */
function setupXhuntCoreAssociations({
  XHuntUser,
  XAccount,
  XHuntUserToken,
  XReviewForAccount,
  XPointRecord,
  XPrivateNote,
  XHuntUserSettings,
  XHuntUserProSubscription,
}) {
  // 点评与用户关联
  XHuntUser.hasMany(XReviewForAccount, {
    foreignKey: "xHuntUserId",
    as: "reviews",
  });
  XReviewForAccount.belongsTo(XHuntUser, {
    foreignKey: "xHuntUserId",
    as: "xHuntUser",
  });

  // 点评与账号关联
  XAccount.hasMany(XReviewForAccount, {
    foreignKey: "xAccountId",
    as: "receivedReviews",
  });
  XReviewForAccount.belongsTo(XAccount, {
    foreignKey: "xAccountId",
    as: "xAccount",
  });

  // 用户与Token
  XHuntUser.hasMany(XHuntUserToken, {
    foreignKey: "userId",
    as: "tokens",
  });
  XHuntUserToken.belongsTo(XHuntUser, {
    foreignKey: "userId",
    as: "user",
  });

  // 用户与积分流水
  XHuntUser.hasMany(XPointRecord, {
    foreignKey: "xHuntUserId",
    as: "pointsHistory",
  });
  XPointRecord.belongsTo(XHuntUser, {
    foreignKey: "xHuntUserId",
    as: "user",
  });

  // 点评与单条积分记录
  XReviewForAccount.hasOne(XPointRecord, {
    foreignKey: "reviewId",
    as: "pointRecord",
  });
  XPointRecord.belongsTo(XReviewForAccount, {
    foreignKey: "reviewId",
    as: "review",
  });

  // 私人备注关系
  XHuntUser.hasMany(XPrivateNote, {
    foreignKey: "xHuntUserId",
    as: "privateNotes",
  });
  XPrivateNote.belongsTo(XHuntUser, {
    foreignKey: "xHuntUserId",
    as: "xHuntUser",
  });

  XAccount.hasMany(XPrivateNote, {
    foreignKey: "xAccountId",
    as: "privateNotes",
  });
  XPrivateNote.belongsTo(XAccount, {
    foreignKey: "xAccountId",
    as: "xAccount",
  });

  // 用户配置中心
  XHuntUser.hasMany(XHuntUserSettings, {
    foreignKey: "userId",
    as: "settings",
  });
  XHuntUserSettings.belongsTo(XHuntUser, {
    foreignKey: "userId",
    as: "user",
  });

  // Pro 订阅记录
  XHuntUser.hasMany(XHuntUserProSubscription, {
    foreignKey: "userId",
    as: "proSubscriptions",
  });
  XHuntUserProSubscription.belongsTo(XHuntUser, {
    foreignKey: "userId",
    as: "user",
  });
}

module.exports = {
  setupXhuntCoreAssociations,
};
