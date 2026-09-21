/**
 * 活动报名与私信模型关联 (Mantle, Campaign, PrivateMessage)
 */
function setupCampaignAssociations({
  XHuntUser,
  MantleRegistration,
  MantleRegistration2,
  CampaignRegistration,
  XPrivateMessage,
}) {
  // MantleRegistration 关系（与用户关联）
  XHuntUser.hasMany(MantleRegistration, {
    foreignKey: "xHuntUserId",
    as: "mantleRegistrations",
  });
  MantleRegistration.belongsTo(XHuntUser, {
    foreignKey: "xHuntUserId",
    as: "xHuntUser",
  });

  // MantleRegistration2 关系（与用户关联）
  XHuntUser.hasMany(MantleRegistration2, {
    foreignKey: "xHuntUserId",
    as: "mantleRegistrations2",
  });
  MantleRegistration2.belongsTo(XHuntUser, {
    foreignKey: "xHuntUserId",
    as: "xHuntUser",
  });

  // CampaignRegistration 关系（可能对应任意活动）
  XHuntUser.hasMany(CampaignRegistration, {
    foreignKey: "xHuntUserId",
    as: "campaignRegistrations",
  });
  CampaignRegistration.belongsTo(XHuntUser, {
    foreignKey: "xHuntUserId",
    as: "xHuntUser",
  });

  // XPrivateMessage 关系（私信）
  XHuntUser.hasMany(XPrivateMessage, {
    foreignKey: "senderId",
    as: "sentMessages",
  });
  XHuntUser.hasMany(XPrivateMessage, {
    foreignKey: "receiverId",
    as: "receivedMessages",
  });
  XPrivateMessage.belongsTo(XHuntUser, {
    foreignKey: "senderId",
    as: "sender",
  });
  XPrivateMessage.belongsTo(XHuntUser, {
    foreignKey: "receiverId",
    as: "receiver",
  });
}

module.exports = {
  setupCampaignAssociations,
};
