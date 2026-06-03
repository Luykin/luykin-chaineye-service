const { Sequelize } = require("sequelize");
const TGUserModel = require("./cryptohunt-tg-user");
// 加载所有模型（注意：调用方式改为工厂函数）
const XHuntUserModel = require("../xhunt/models/XHuntUser");
const XAccountModel = require("../xhunt/models/XAccount");
const XHuntUserTokenModel = require("../xhunt/models/XHuntUserToken");
const XReviewForAccountModel = require("../xhunt/models/XReviewForAccount");
const XPointRecordModel = require("../xhunt/models/XPointRecord");
const XPrivateNoteModel = require("../xhunt/models/XPrivateNote");
const MantleRegistrationModel = require("../xhunt/models/MantleRegistration");
const MantleRegistration2Model = require("../xhunt/models/MantleRegistration2");
const CampaignRegistrationModel = require("../xhunt/models/CampaignRegistration");
const XPrivateMessageModel = require("../xhunt/models/XPrivateMessage");
const DailyActiveUserModel = require("../xhunt/models/DailyActiveUser");
const XHuntUserProSubscriptionModel = require("../xhunt/models/XHuntUserProSubscription");
const VersionRequestStatsModel = require("../xhunt/models/VersionRequestStats");
const UrlRequestStatsModel = require("../xhunt/models/UrlRequestStats");
const GenericStatEventModel = require("../xhunt/models/GenericStatEvent");
const SecurityViolationLogModel = require("../xhunt/models/SecurityViolationLog");
const UnregisteredUserRegistrationModel = require("../xhunt/models/UnregisteredUserRegistration");
const XhuntAdminManagerModel = require("../xhunt/models/XhuntAdminManager");
const XhuntAdminAuditLogModel = require("../xhunt/models/XhuntAdminAuditLog");
const XhuntAdminWebAuthnCredentialModel = require("../xhunt/models/XhuntAdminWebAuthnCredential");
const XhuntVipTestUserModel = require("../xhunt/models/XhuntVipTestUser");
const XhuntUserTagModel = require("../xhunt/models/XhuntUserTag");
const CollectorClientTokenModel = require("../xhunt/models/CollectorClientToken");
const XHuntWebUserModel = require("../xhunt/models/XHuntWebUser");
const XHuntWebUserTokenModel = require("../xhunt/models/XHuntWebUserToken");
const XHuntWebsiteCampaignModel = require("../xhunt/models/XHuntWebsiteCampaign");

const pgDialect = process.env.PG_DIALECT || "postgres";
const pgHost = process.env.PG_HOST;
const pgPort = process.env.PG_PORT ? parseInt(process.env.PG_PORT, 10) : undefined;
const pgDatabase = process.env.PG_DATABASE;
const pgUsername = process.env.PG_USERNAME;
const pgPassword = process.env.PG_PASSWORD;

if (!pgHost || !pgDatabase || !pgUsername || !pgPassword) {
  throw new Error(
    "PostgreSQL env incomplete: require PG_HOST, PG_DATABASE, PG_USERNAME, PG_PASSWORD"
  );
}

const dialectOptions = {};
if (process.env.PG_SSL === "true") {
  dialectOptions.ssl = {
    require: true,
    rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false",
  };
}

const pgInstance = new Sequelize({
  dialect: pgDialect,
  host: pgHost,
  port: pgPort,
  database: pgDatabase,
  username: pgUsername,
  password: pgPassword,
  logging: process.env.PG_LOGGING === "true",
  timezone: "+00:00",
  pool: { max: 10, min: 0, idle: 10000, acquire: 20000 },
  dialectOptions,
});

/** 🏖️这是 https://www.cryptohunt.ai/ 的数据表 start====== **/
//由于历史和时间原因，展示不对原来的代码修改
const TGUser = TGUserModel(pgInstance);
/** 这是 https://www.cryptohunt.ai/ 的数据表 end====== **/

/** ✅这是XHunt 浏览器插件的 数据表  start====== **/
const XHuntUser = XHuntUserModel(pgInstance);
const XAccount = XAccountModel(pgInstance);
const XHuntUserToken = XHuntUserTokenModel(pgInstance);
const XReviewForAccount = XReviewForAccountModel(pgInstance);
const XPointRecord = XPointRecordModel(pgInstance);
const XPrivateNote = XPrivateNoteModel(pgInstance);
const MantleRegistration = MantleRegistrationModel(pgInstance);
const MantleRegistration2 = MantleRegistration2Model(pgInstance);
const CampaignRegistration = CampaignRegistrationModel(pgInstance);
const XPrivateMessage = XPrivateMessageModel(pgInstance);
const DailyActiveUser = DailyActiveUserModel(pgInstance);
const XHuntUserProSubscription = XHuntUserProSubscriptionModel(pgInstance);
const VersionRequestStats = VersionRequestStatsModel(pgInstance);
const UrlRequestStats = UrlRequestStatsModel(pgInstance);
const GenericStatEvent = GenericStatEventModel(pgInstance);
const SecurityViolationLog = SecurityViolationLogModel(pgInstance);
const UnregisteredUserRegistration = UnregisteredUserRegistrationModel(pgInstance);
const XhuntAdminManager = XhuntAdminManagerModel(pgInstance);
const XhuntAdminAuditLog = XhuntAdminAuditLogModel(pgInstance);
const XhuntAdminWebAuthnCredential = XhuntAdminWebAuthnCredentialModel(pgInstance);
const XhuntVipTestUser = XhuntVipTestUserModel(pgInstance);
const XhuntUserTag = XhuntUserTagModel(pgInstance);
const CollectorClientToken = CollectorClientTokenModel(pgInstance);
const XHuntWebUser = XHuntWebUserModel(pgInstance);
const XHuntWebUserToken = XHuntWebUserTokenModel(pgInstance);
const XHuntWebsiteCampaign = XHuntWebsiteCampaignModel(pgInstance);

// 建立模型之间的关系
XHuntUser.hasMany(XReviewForAccount, {
  foreignKey: "xHuntUserId",
  as: "reviews",
});

XReviewForAccount.belongsTo(XHuntUser, {
  foreignKey: "xHuntUserId",
  as: "xHuntUser",
});

XAccount.hasMany(XReviewForAccount, {
  foreignKey: "xAccountId",
  as: "receivedReviews",
});

XReviewForAccount.belongsTo(XAccount, {
  foreignKey: "xAccountId",
  as: "xAccount",
});

XHuntUser.hasMany(XHuntUserToken, {
  foreignKey: "userId",
  as: "tokens",
});

XHuntUserToken.belongsTo(XHuntUser, {
  foreignKey: "userId",
  as: "user",
});

XHuntUser.hasMany(XPointRecord, {
  foreignKey: "xHuntUserId",
  as: "pointsHistory",
});

XPointRecord.belongsTo(XHuntUser, {
  foreignKey: "xHuntUserId",
  as: "user",
});

XReviewForAccount.hasOne(XPointRecord, {
  foreignKey: "reviewId",
  as: "pointRecord",
});

XPointRecord.belongsTo(XReviewForAccount, {
  foreignKey: "reviewId",
  as: "review",
});

// 新增私人备注关系
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

// XHuntUserProSubscription 关系（Pro 订阅记录）
XHuntUser.hasMany(XHuntUserProSubscription, {
  foreignKey: "userId",
  as: "proSubscriptions",
});

XHuntUserProSubscription.belongsTo(XHuntUser, {
  foreignKey: "userId",
  as: "user",
});

// Admin WebAuthn Credentials 关系
XhuntAdminManager.hasMany(XhuntAdminWebAuthnCredential, {
  foreignKey: "adminId",
  as: "webauthnCredentials",
});

XhuntAdminWebAuthnCredential.belongsTo(XhuntAdminManager, {
  foreignKey: "adminId",
  as: "admin",
});

// XHuntWebUser 与 XHuntWebUserToken 关系
XHuntWebUser.hasMany(XHuntWebUserToken, {
  foreignKey: "userId",
  as: "tokens",
});

XHuntWebUserToken.belongsTo(XHuntWebUser, {
  foreignKey: "userId",
  as: "user",
});

/** 这是XHunt 浏览器插件的 数据表  end====== **/

async function setupPostgres() {
  try {
    await pgInstance.authenticate();
    console.log("postgres Database connection established.");
    // await pgInstance.sync();
    await pgInstance.sync({ alter: false });
    console.log("postgres Database synchronized.");
  } catch (error) {
    console.error("postgres Database setup error:", error);
    throw error;
  }
}

module.exports = {
  // 数据库初始化
  setupPostgres,

  // 数据库实例
  pgInstance,

  // CryptoHunt 数据表
  TGUser,

  // XHunt 数据表
  XHuntUser,
  XAccount,
  XHuntUserToken,
  XReviewForAccount,
  XPointRecord,
  XPrivateNote,
  MantleRegistration,
  MantleRegistration2,
  CampaignRegistration,
  XPrivateMessage,
  DailyActiveUser,
  XHuntUserProSubscription,
  VersionRequestStats,
  UrlRequestStats,
  GenericStatEvent,
  SecurityViolationLog,
  UnregisteredUserRegistration,
  XhuntAdminManager,
  XhuntAdminAuditLog,
  XhuntAdminWebAuthnCredential,
  XhuntVipTestUser,
  XhuntUserTag,
  CollectorClientToken,

  // XHunt Web 用户数据表
  XHuntWebUser,
  XHuntWebUserToken,
  XHuntWebsiteCampaign,
};
