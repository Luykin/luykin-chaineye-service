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
const XPrivateMessageModel = require("../xhunt/models/XPrivateMessage");
const DailyActiveUserModel = require("../xhunt/models/DailyActiveUser");
const XHuntUserProSubscriptionModel = require("../xhunt/models/XHuntUserProSubscription");
const EngageToEarnActivityModel = require("../xhunt/models/EngageToEarnActivity");
const EngageToEarnSignupModel = require("../xhunt/models/EngageToEarnSignup");

const pgInstance = new Sequelize({
  dialect: process.env.PG_DIALECT || "postgres",
  host: process.env.PG_HOST || "150.5.158.179",
  port: parseInt(process.env.PG_PORT || "5432", 10),
  database: process.env.PG_DATABASE || "luykindatabase",
  username: process.env.PG_USERNAME || "luykin",
  password: process.env.PG_PASSWORD || "wtf.0813",
  logging: process.env.PG_LOGGING === "true", // 转换为布尔值
  // 对 Postgres：保持服务端与 ORM 都使用 UTC，避免跨时区偏差
  timezone: "+00:00",
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
const XPrivateMessage = XPrivateMessageModel(pgInstance);
const DailyActiveUser = DailyActiveUserModel(pgInstance);
const XHuntUserProSubscription = XHuntUserProSubscriptionModel(pgInstance);
const EngageToEarnActivity = EngageToEarnActivityModel(pgInstance);
const EngageToEarnSignup = EngageToEarnSignupModel(pgInstance);

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

// EngageToEarn 关系
EngageToEarnActivity.hasMany(EngageToEarnSignup, {
  foreignKey: "activityId",
  as: "signups",
});

EngageToEarnSignup.belongsTo(EngageToEarnActivity, {
  foreignKey: "activityId",
  as: "activity",
});

XHuntUser.hasMany(EngageToEarnSignup, {
  foreignKey: "xHuntUserId",
  as: "activitySignups",
});

EngageToEarnSignup.belongsTo(XHuntUser, {
  foreignKey: "xHuntUserId",
  as: "xHuntUser",
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
  XPrivateMessage,
  DailyActiveUser,
  XHuntUserProSubscription,
  EngageToEarnActivity,
  EngageToEarnSignup,
};
