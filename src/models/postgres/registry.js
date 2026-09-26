const TGUserModel = require("../cryptohunt-tg-user");
const XHuntUserModel = require("../../xhunt/models/XHuntUser");
const XAccountModel = require("../../xhunt/models/XAccount");
const XHuntUserTokenModel = require("../../xhunt/models/XHuntUserToken");
const XReviewForAccountModel = require("../../xhunt/models/XReviewForAccount");
const XPointRecordModel = require("../../xhunt/models/XPointRecord");
const XPrivateNoteModel = require("../../xhunt/models/XPrivateNote");
const MantleRegistrationModel = require("../../xhunt/models/MantleRegistration");
const MantleRegistration2Model = require("../../xhunt/models/MantleRegistration2");
const CampaignRegistrationModel = require("../../xhunt/models/CampaignRegistration");
const XPrivateMessageModel = require("../../xhunt/models/XPrivateMessage");
const DailyActiveUserModel = require("../../xhunt/models/DailyActiveUser");
const XHuntUserProSubscriptionModel = require("../../xhunt/models/XHuntUserProSubscription");
const VersionRequestStatsModel = require("../../xhunt/models/VersionRequestStats");
const UrlRequestStatsModel = require("../../xhunt/models/UrlRequestStats");
const GenericStatEventModel = require("../../xhunt/models/GenericStatEvent");
const SecurityViolationLogModel = require("../../xhunt/models/SecurityViolationLog");
const UnregisteredUserRegistrationModel = require("../../xhunt/models/UnregisteredUserRegistration");
const XhuntAdminManagerModel = require("../../xhunt/models/XhuntAdminManager");
const XhuntAdminAuditLogModel = require("../../xhunt/models/XhuntAdminAuditLog");
const XhuntAdminWebAuthnCredentialModel = require("../../xhunt/models/XhuntAdminWebAuthnCredential");
const XhuntNacosConfigSnapshotModel = require("../../xhunt/models/XhuntNacosConfigSnapshot");
const XhuntVipTestUserModel = require("../../xhunt/models/XhuntVipTestUser");
const XHuntUserSettingsModel = require("../../xhunt/models/XHuntUserSettings");
const XhuntUserTagModel = require("../../xhunt/models/XhuntUserTag");
const XhuntSpecialUserMarkerModel = require("../../xhunt/models/XhuntSpecialUserMarker");
const CollectorClientTokenModel = require("../../xhunt/models/CollectorClientToken");
const XHuntWebUserModel = require("../../xhunt/models/XHuntWebUser");
const XHuntWebUserTokenModel = require("../../xhunt/models/XHuntWebUserToken");
const XHuntWebsiteCampaignModel = require("../../xhunt/models/XHuntWebsiteCampaign");
const XHuntBinanceSquareBindingModel = require("../../xhunt/models/XHuntBinanceSquareBinding");
const XHuntBinanceSquareBindingChallengeModel = require("../../xhunt/models/XHuntBinanceSquareBindingChallenge");
const XHuntBinanceSquareBindingEventModel = require("../../xhunt/models/XHuntBinanceSquareBindingEvent");
const XHuntKolCollaborationModel = require("../../xhunt/models/XHuntKolCollaboration");
const BusinessCollaborationActivityModel = require("../../xhunt/models/BusinessCollaborationActivity");
const BusinessCollaborationActivityAccessModel = require("../../xhunt/models/BusinessCollaborationActivityAccess");
const BusinessCollaborationInvitationModel = require("../../xhunt/models/BusinessCollaborationInvitation");
const BusinessCollaborationModel = require("../../xhunt/models/BusinessCollaboration");
const BusinessCollaborationBudgetLedgerModel = require("../../xhunt/models/BusinessCollaborationBudgetLedger");
const BusinessCollaborationAuditLogModel = require("../../xhunt/models/BusinessCollaborationAuditLog");
const AuthCenterXhuntUserModel = require("../../xhunt/auth-center/models/AuthCenterXhuntUser");
const AuthCenterXhuntIdentityModel = require("../../xhunt/auth-center/models/AuthCenterXhuntIdentity");
const AuthCenterXhuntPasswordCredentialModel = require("../../xhunt/auth-center/models/AuthCenterXhuntPasswordCredential");
const AuthCenterXhuntClientModel = require("../../xhunt/auth-center/models/AuthCenterXhuntClient");
const AuthCenterXhuntSessionModel = require("../../xhunt/auth-center/models/AuthCenterXhuntSession");
const AuthCenterXhuntAuthorizationCodeModel = require("../../xhunt/auth-center/models/AuthCenterXhuntAuthorizationCode");
const AuthCenterXhuntAuditLogModel = require("../../xhunt/auth-center/models/AuthCenterXhuntAuditLog");
const EchohuntSocialListeningBoardModel = require("../../xhunt/social-listening/models/EchohuntSocialListeningBoard");
const EchohuntSocialListeningAccessAuditLogModel = require("../../xhunt/social-listening/models/EchohuntSocialListeningAccessAuditLog");
const EchohuntSocialListeningPostModel = require("../../xhunt/social-listening/models/EchohuntSocialListeningPost");
const EchohuntSocialListeningTextCondensationModel = require("../../xhunt/social-listening/models/EchohuntSocialListeningTextCondensation");
const EchohuntSocialListeningSnapshotModel = require("../../xhunt/social-listening/models/EchohuntSocialListeningSnapshot");
const EchohuntSocialListeningAccountSignalModel = require("../../xhunt/social-listening/models/EchohuntSocialListeningAccountSignal");
const EchohuntSocialListeningAlertModel = require("../../xhunt/social-listening/models/EchohuntSocialListeningAlert");
const EchohuntSocialListeningKeyEventModel = require("../../xhunt/social-listening/models/EchohuntSocialListeningKeyEvent");
const EchohuntSocialListeningJobModel = require("../../xhunt/social-listening/models/EchohuntSocialListeningJob");
const EchohuntFeatureAccessModel = require("../../xhunt/models/EchohuntFeatureAccess");
const XHuntHotVoteTopicModel = require("../../xhunt/models/XHuntHotVoteTopic");
const XHuntHotVoteRecordModel = require("../../xhunt/models/XHuntHotVoteRecord");
const XHuntHotVoteCommentModel = require("../../xhunt/models/XHuntHotVoteComment");

function initModels(pgInstance) {
  return {
    // CryptoHunt 数据表
    TGUser: TGUserModel(pgInstance),

    // XHunt 数据表
    XHuntUser: XHuntUserModel(pgInstance),
    XAccount: XAccountModel(pgInstance),
    XHuntUserToken: XHuntUserTokenModel(pgInstance),
    XReviewForAccount: XReviewForAccountModel(pgInstance),
    XPointRecord: XPointRecordModel(pgInstance),
    XPrivateNote: XPrivateNoteModel(pgInstance),
    MantleRegistration: MantleRegistrationModel(pgInstance),
    MantleRegistration2: MantleRegistration2Model(pgInstance),
    CampaignRegistration: CampaignRegistrationModel(pgInstance),
    XPrivateMessage: XPrivateMessageModel(pgInstance),
    DailyActiveUser: DailyActiveUserModel(pgInstance),
    XHuntUserProSubscription: XHuntUserProSubscriptionModel(pgInstance),
    VersionRequestStats: VersionRequestStatsModel(pgInstance),
    UrlRequestStats: UrlRequestStatsModel(pgInstance),
    GenericStatEvent: GenericStatEventModel(pgInstance),
    SecurityViolationLog: SecurityViolationLogModel(pgInstance),
    UnregisteredUserRegistration: UnregisteredUserRegistrationModel(pgInstance),
    XhuntAdminManager: XhuntAdminManagerModel(pgInstance),
    XhuntAdminAuditLog: XhuntAdminAuditLogModel(pgInstance),
    XhuntAdminWebAuthnCredential: XhuntAdminWebAuthnCredentialModel(pgInstance),
    XhuntNacosConfigSnapshot: XhuntNacosConfigSnapshotModel(pgInstance),
    XhuntVipTestUser: XhuntVipTestUserModel(pgInstance),
    XHuntUserSettings: XHuntUserSettingsModel(pgInstance),
    XhuntUserTag: XhuntUserTagModel(pgInstance),
    XhuntSpecialUserMarker: XhuntSpecialUserMarkerModel(pgInstance),
    CollectorClientToken: CollectorClientTokenModel(pgInstance),

    // XHunt Web 用户数据表
    XHuntWebUser: XHuntWebUserModel(pgInstance),
    XHuntWebUserToken: XHuntWebUserTokenModel(pgInstance),
    XHuntWebsiteCampaign: XHuntWebsiteCampaignModel(pgInstance),
    XHuntBinanceSquareBinding: XHuntBinanceSquareBindingModel(pgInstance),
    XHuntBinanceSquareBindingChallenge: XHuntBinanceSquareBindingChallengeModel(pgInstance),
    XHuntBinanceSquareBindingEvent: XHuntBinanceSquareBindingEventModel(pgInstance),
    XHuntKolCollaboration: XHuntKolCollaborationModel(pgInstance),
    BusinessCollaborationActivity: BusinessCollaborationActivityModel(pgInstance),
    BusinessCollaborationActivityAccess: BusinessCollaborationActivityAccessModel(pgInstance),
    BusinessCollaborationInvitation: BusinessCollaborationInvitationModel(pgInstance),
    BusinessCollaboration: BusinessCollaborationModel(pgInstance),
    BusinessCollaborationBudgetLedger: BusinessCollaborationBudgetLedgerModel(pgInstance),
    BusinessCollaborationAuditLog: BusinessCollaborationAuditLogModel(pgInstance),
    AuthCenterXhuntUser: AuthCenterXhuntUserModel(pgInstance),
    AuthCenterXhuntIdentity: AuthCenterXhuntIdentityModel(pgInstance),
    AuthCenterXhuntPasswordCredential: AuthCenterXhuntPasswordCredentialModel(pgInstance),
    AuthCenterXhuntClient: AuthCenterXhuntClientModel(pgInstance),
    AuthCenterXhuntSession: AuthCenterXhuntSessionModel(pgInstance),
    AuthCenterXhuntAuthorizationCode: AuthCenterXhuntAuthorizationCodeModel(pgInstance),
    AuthCenterXhuntAuditLog: AuthCenterXhuntAuditLogModel(pgInstance),
    EchohuntSocialListeningBoard: EchohuntSocialListeningBoardModel(pgInstance),
    EchohuntSocialListeningAccessAuditLog: EchohuntSocialListeningAccessAuditLogModel(pgInstance),
    EchohuntSocialListeningPost: EchohuntSocialListeningPostModel(pgInstance),
    EchohuntSocialListeningTextCondensation: EchohuntSocialListeningTextCondensationModel(pgInstance),
    EchohuntSocialListeningSnapshot: EchohuntSocialListeningSnapshotModel(pgInstance),
    EchohuntSocialListeningAccountSignal: EchohuntSocialListeningAccountSignalModel(pgInstance),
    EchohuntSocialListeningAlert: EchohuntSocialListeningAlertModel(pgInstance),
    EchohuntSocialListeningKeyEvent: EchohuntSocialListeningKeyEventModel(pgInstance),
    EchohuntSocialListeningJob: EchohuntSocialListeningJobModel(pgInstance),
    EchohuntFeatureAccess: EchohuntFeatureAccessModel(pgInstance),
    XHuntHotVoteTopic: XHuntHotVoteTopicModel(pgInstance),
    XHuntHotVoteRecord: XHuntHotVoteRecordModel(pgInstance),
    XHuntHotVoteComment: XHuntHotVoteCommentModel(pgInstance),
  };
}

module.exports = {
  initModels,
};
