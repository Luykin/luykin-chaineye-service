/**
 * EchoHunt Social Listening 社交监听模型关联
 */
function setupSocialListeningAssociations({
  EchohuntSocialListeningBoard,
  EchohuntSocialListeningPost,
  EchohuntSocialListeningSnapshot,
  EchohuntSocialListeningAccountSignal,
  EchohuntSocialListeningAlert,
  EchohuntSocialListeningKeyEvent,
  EchohuntSocialListeningJob,
  EchohuntFeatureAccess,
  AuthCenterXhuntUser,
}) {
  // 看板与推文
  EchohuntSocialListeningBoard.hasMany(EchohuntSocialListeningPost, {
    foreignKey: "boardId",
    as: "posts",
  });
  EchohuntSocialListeningPost.belongsTo(EchohuntSocialListeningBoard, {
    foreignKey: "boardId",
    as: "board",
  });

  // 看板与快照
  EchohuntSocialListeningBoard.hasMany(EchohuntSocialListeningSnapshot, {
    foreignKey: "boardId",
    as: "snapshots",
  });
  EchohuntSocialListeningSnapshot.belongsTo(EchohuntSocialListeningBoard, {
    foreignKey: "boardId",
    as: "board",
  });

  // 看板与账号信号
  EchohuntSocialListeningBoard.hasMany(EchohuntSocialListeningAccountSignal, {
    foreignKey: "boardId",
    as: "accountSignals",
  });
  EchohuntSocialListeningAccountSignal.belongsTo(EchohuntSocialListeningBoard, {
    foreignKey: "boardId",
    as: "board",
  });

  // 看板与预警
  EchohuntSocialListeningBoard.hasMany(EchohuntSocialListeningAlert, {
    foreignKey: "boardId",
    as: "alerts",
  });
  EchohuntSocialListeningAlert.belongsTo(EchohuntSocialListeningBoard, {
    foreignKey: "boardId",
    as: "board",
  });

  // 看板与关键事件
  EchohuntSocialListeningBoard.hasMany(EchohuntSocialListeningKeyEvent, {
    foreignKey: "boardId",
    as: "keyEvents",
  });
  EchohuntSocialListeningKeyEvent.belongsTo(EchohuntSocialListeningBoard, {
    foreignKey: "boardId",
    as: "board",
  });

  // 看板与任务
  EchohuntSocialListeningBoard.hasMany(EchohuntSocialListeningJob, {
    foreignKey: "boardId",
    as: "jobs",
  });
  EchohuntSocialListeningJob.belongsTo(EchohuntSocialListeningBoard, {
    foreignKey: "boardId",
    as: "board",
  });

  // 用户与功能权限
  AuthCenterXhuntUser.hasMany(EchohuntFeatureAccess, {
    foreignKey: "authCenterUserId",
    as: "featureAccesses",
  });
  EchohuntFeatureAccess.belongsTo(AuthCenterXhuntUser, {
    foreignKey: "authCenterUserId",
    as: "authCenterUser",
  });

  // 用户与关键事件
  AuthCenterXhuntUser.hasMany(EchohuntSocialListeningKeyEvent, {
    foreignKey: "authCenterUserId",
    as: "socialListeningKeyEvents",
  });
  EchohuntSocialListeningKeyEvent.belongsTo(AuthCenterXhuntUser, {
    foreignKey: "authCenterUserId",
    as: "authCenterUser",
  });
}

module.exports = {
  setupSocialListeningAssociations,
};
