const { Op } = require("sequelize");
const {
  pgInstance,
  AuthCenterXhuntIdentity,
  AuthCenterXhuntUser,
  EchohuntFeatureAccess,
} = require("../../../models/postgres-start");
const { publicError } = require("./errors");

const ACTIVE = "active";
const REVOKED = "revoked";
const KOL_MATCH_FEATURE_KEY = "kol-match";
const GLOBAL_RESOURCE_ID = "global";

function normalizeTwitterHandle(value) {
  return String(value || "").trim().replace(/^@+/, "").replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "").replace(/[/?#].*$/, "").toLowerCase();
}

function assertTwitterHandle(value) {
  const twitterHandle = normalizeTwitterHandle(value);
  if (!/^[a-z0-9_]{1,64}$/i.test(twitterHandle)) {
    throw publicError("KOL_MATCH_ACCESS_HANDLE_INVALID", 400, "请输入有效的 X Handle。");
  }
  return twitterHandle;
}

function getTwitterIdentity(authCenter) {
  const identity = (authCenter?.identities || []).find((item) => item.provider === "twitter");
  if (!identity) return null;
  return {
    twitterId: String(identity.providerSubject || identity.providerSubjectLower || "").trim(),
    twitterHandle: normalizeTwitterHandle(identity.username),
  };
}

function buildAccessWhere(authCenter) {
  const user = authCenter?.user;
  const twitter = getTwitterIdentity(authCenter);
  const or = [];
  if (user?.id) or.push({ authCenterUserId: user.id });
  if (twitter?.twitterId) or.push({ twitterId: twitter.twitterId });
  if (twitter?.twitterHandle) or.push({ twitterHandle: twitter.twitterHandle });
  if (!or.length) throw publicError("KOL_MATCH_TWITTER_LOGIN_REQUIRED", 403, "请先使用 X 登录 EchoHunt。");
  return { featureKey: KOL_MATCH_FEATURE_KEY, resourceId: GLOBAL_RESOURCE_ID, status: ACTIVE, [Op.or]: or };
}

function serializeAccess(record) {
  const row = record?.toJSON ? record.toJSON() : record;
  return {
    id: row.id,
    twitterId: row.twitterId || null,
    twitterHandle: row.twitterHandle,
    authCenterUserId: row.authCenterUserId || null,
    xhuntUserId: row.xhuntUserId || null,
    status: row.status,
    grantedAt: row.grantedAt,
    revokedAt: row.revokedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findAuthIdentityByHandle(handle) {
  return AuthCenterXhuntIdentity.findOne({
    where: { provider: "twitter", username: { [Op.iLike]: handle } },
    include: [{ model: AuthCenterXhuntUser, as: "user" }],
    order: [["updatedAt", "DESC"]],
  }).catch(() => null);
}

async function grantKolMatchAccess(input = {}, adminId = null) {
  const twitterHandle = assertTwitterHandle(input.twitterHandle || input.handle);
  const identity = await findAuthIdentityByHandle(twitterHandle);
  const payload = {
    featureKey: KOL_MATCH_FEATURE_KEY,
    resourceId: GLOBAL_RESOURCE_ID,
    twitterHandle,
    twitterId: String(input.twitterId || identity?.providerSubject || "").trim() || null,
    authCenterUserId: input.authCenterUserId || identity?.userId || null,
    xhuntUserId: input.xhuntUserId || identity?.user?.xhuntUserId || null,
    status: ACTIVE,
    grantedByAdminId: adminId,
    revokedByAdminId: null,
    grantedAt: new Date(),
    revokedAt: null,
    metadata: { source: "admin", matchedIdentityId: identity?.id || null },
  };

  return pgInstance.transaction(async (transaction) => {
    const existing = await EchohuntFeatureAccess.findOne({
      where: { featureKey: KOL_MATCH_FEATURE_KEY, resourceId: GLOBAL_RESOURCE_ID, twitterHandle, status: ACTIVE }, transaction, lock: true,
    });
    if (existing) return { access: existing, created: false };
    const access = await EchohuntFeatureAccess.create(payload, { transaction });
    return { access, created: true };
  });
}

async function revokeKolMatchAccess(accessId, adminId = null) {
  const access = await EchohuntFeatureAccess.findOne({ where: { id: accessId, featureKey: KOL_MATCH_FEATURE_KEY, resourceId: GLOBAL_RESOURCE_ID } });
  if (!access) throw publicError("KOL_MATCH_ACCESS_NOT_FOUND", 404, "授权记录不存在。");
  if (access.status === ACTIVE) {
    await access.update({ status: REVOKED, revokedAt: new Date(), revokedByAdminId: adminId });
  }
  return access;
}

async function listKolMatchAccesses({ status } = {}) {
  const where = { featureKey: KOL_MATCH_FEATURE_KEY, resourceId: GLOBAL_RESOURCE_ID, ...(status ? { status } : {}) };
  const records = await EchohuntFeatureAccess.findAll({ where, order: [["updatedAt", "DESC"], ["id", "DESC"]] });
  return records.map(serializeAccess);
}

async function getKolMatchAccessSummary(authCenter) {
  const access = await EchohuntFeatureAccess.findOne({ where: buildAccessWhere(authCenter), order: [["updatedAt", "DESC"]] });
  const user = authCenter?.user;
  const twitter = getTwitterIdentity(authCenter);
  if (access && !access.authCenterUserId && user?.id) {
    access.update({
      authCenterUserId: user.id,
      twitterId: access.twitterId || twitter?.twitterId || null,
      xhuntUserId: user.xhuntUserId || null,
      metadata: { ...(access.metadata || {}), autoBoundAt: new Date().toISOString() },
    }).catch(() => null);
  }
  return { hasAccess: Boolean(access), access: access ? serializeAccess(access) : null };
}

async function assertKolMatchAccess(authCenter) {
  const summary = await getKolMatchAccessSummary(authCenter);
  if (!summary.hasAccess) throw publicError("KOL_MATCH_FORBIDDEN", 403, "你没有访问 KOL Match 的权限。");
  return summary.access;
}

module.exports = {
  assertKolMatchAccess,
  getKolMatchAccessSummary,
  grantKolMatchAccess,
  listKolMatchAccesses,
  revokeKolMatchAccess,
  serializeAccess,
};
