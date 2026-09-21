/**
 * 商业合作模型关联 (Activity, Access, Invitation, Collaboration, BudgetLedger)
 */
function setupBusinessCollaborationAssociations({
  BusinessCollaborationActivity,
  BusinessCollaborationActivityAccess,
  BusinessCollaborationInvitation,
  BusinessCollaboration,
  BusinessCollaborationBudgetLedger,
  AuthCenterXhuntUser,
}) {
  BusinessCollaborationActivity.hasMany(BusinessCollaborationActivityAccess, {
    foreignKey: "activityId",
    as: "accesses",
  });
  BusinessCollaborationActivityAccess.belongsTo(BusinessCollaborationActivity, {
    foreignKey: "activityId",
    as: "activity",
  });

  AuthCenterXhuntUser.hasMany(BusinessCollaborationActivityAccess, {
    foreignKey: "authCenterUserId",
    as: "businessCollaborationAccesses",
  });
  BusinessCollaborationActivityAccess.belongsTo(AuthCenterXhuntUser, {
    foreignKey: "authCenterUserId",
    as: "authCenterUser",
  });

  BusinessCollaborationActivity.hasMany(BusinessCollaborationInvitation, {
    foreignKey: "activityId",
    as: "invitations",
  });
  BusinessCollaborationInvitation.belongsTo(BusinessCollaborationActivity, {
    foreignKey: "activityId",
    as: "activity",
  });

  BusinessCollaborationActivityAccess.hasMany(BusinessCollaborationInvitation, {
    foreignKey: "inviterAccessId",
    as: "sentInvitations",
  });
  BusinessCollaborationInvitation.belongsTo(BusinessCollaborationActivityAccess, {
    foreignKey: "inviterAccessId",
    as: "inviterAccess",
  });

  AuthCenterXhuntUser.hasMany(BusinessCollaborationInvitation, {
    foreignKey: "kolAuthCenterUserId",
    as: "businessCollaborationInvitations",
  });
  BusinessCollaborationInvitation.belongsTo(AuthCenterXhuntUser, {
    foreignKey: "kolAuthCenterUserId",
    as: "kolAuthCenterUser",
  });

  BusinessCollaborationInvitation.hasOne(BusinessCollaboration, {
    foreignKey: "invitationId",
    as: "collaboration",
  });
  BusinessCollaboration.belongsTo(BusinessCollaborationInvitation, {
    foreignKey: "invitationId",
    as: "invitation",
  });

  BusinessCollaborationActivity.hasMany(BusinessCollaboration, {
    foreignKey: "activityId",
    as: "collaborations",
  });
  BusinessCollaboration.belongsTo(BusinessCollaborationActivity, {
    foreignKey: "activityId",
    as: "activity",
  });

  BusinessCollaborationActivity.hasMany(BusinessCollaborationBudgetLedger, {
    foreignKey: "activityId",
    as: "budgetLedgers",
  });
  BusinessCollaborationBudgetLedger.belongsTo(BusinessCollaborationActivity, {
    foreignKey: "activityId",
    as: "activity",
  });

  BusinessCollaborationInvitation.hasMany(BusinessCollaborationBudgetLedger, {
    foreignKey: "invitationId",
    as: "budgetLedgers",
  });
  BusinessCollaborationBudgetLedger.belongsTo(BusinessCollaborationInvitation, {
    foreignKey: "invitationId",
    as: "invitation",
  });

  BusinessCollaboration.hasMany(BusinessCollaborationBudgetLedger, {
    foreignKey: "collaborationId",
    as: "budgetLedgers",
  });
  BusinessCollaborationBudgetLedger.belongsTo(BusinessCollaboration, {
    foreignKey: "collaborationId",
    as: "collaboration",
  });
}

module.exports = {
  setupBusinessCollaborationAssociations,
};
