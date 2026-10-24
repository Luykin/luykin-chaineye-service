const { Op } = require("sequelize");
const {
  pgInstance,
  AuthCenterXhuntIdentity,
  AuthCenterXhuntUser,
  EchohuntFeatureAccess,
} = require("../../../models/postgres-start");

const E2E_PUBLISH_FEATURE_KEY = "e2e-publish";
const GLOBAL_RESOURCE_ID = "global";
const ACTIVE = "active";
const REVOKED = "revoked";

function accessError(code, status, message) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeTwitterHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
}

function assertTwitterHandle(value) {
  const handle = normalizeTwitterHandle(value);
  if (!/^[a-z0-9_]{1,64}$/i.test(handle)) {
    throw accessError("E2E_PUBLISH_HANDLE_INVALID", 400, "请输入有效的 X Handle");
  }
  return handle;
}

function serializeE2ePublishAccess(record) {
  const row = record?.toJSON ? record.toJSON() : record;
  return {
    id: row.id,
    twitterId: row.twitterId || null,
    twitterHandle: row.twitterHandle,
    authCenterUserId: row.authCenterUserId || null,
    xhuntUserId: row.xhuntUserId || null,
    status: row.status,
    grantedAt: row.grantedAt || null,
    revokedAt: row.revokedAt || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
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
  const identities = [];
  if (user?.id) identities.push({ authCenterUserId: user.id });
  if (twitter?.twitterId) identities.push({ twitterId: twitter.twitterId });
  if (twitter?.twitterHandle) identities.push({ twitterHandle: twitter.twitterHandle });
  if (!identities.length) {
    throw accessError("E2E_PUBLISH_TWITTER_REQUIRED", 403, "请先使用 X 登录 EchoHunt");
  }
  return {
    featureKey: E2E_PUBLISH_FEATURE_KEY,
    resourceId: GLOBAL_RESOURCE_ID,
    status: ACTIVE,
    [Op.or]: identities,
  };
}

async function getE2ePublishAccessSummary(authCenter) {
  const access = await EchohuntFeatureAccess.findOne({
    where: buildAccessWhere(authCenter),
    order: [["updatedAt", "DESC"]],
  });
  const twitter = getTwitterIdentity(authCenter);
  if (access && !access.authCenterUserId && authCenter?.user?.id) {
    access.update({
      authCenterUserId: authCenter.user.id,
      twitterId: access.twitterId || twitter?.twitterId || null,
      xhuntUserId: authCenter.user.xhuntUserId || null,
      metadata: { ...(access.metadata || {}), autoBoundAt: new Date().toISOString() },
    }).catch(() => null);
  }
  return { hasAccess: Boolean(access), access: access ? serializeE2ePublishAccess(access) : null };
}

async function assertE2ePublishAccess(authCenter) {
  const summary = await getE2ePublishAccessSummary(authCenter);
  if (!summary.hasAccess) {
    throw accessError("E2E_PUBLISH_FORBIDDEN", 403, "当前 X 账号没有 E2E 投放权限");
  }
  return summary.access;
}

async function findTwitterIdentity(handle) {
  return AuthCenterXhuntIdentity.findOne({
    where: { provider: "twitter", username: { [Op.iLike]: handle } },
    include: [{ model: AuthCenterXhuntUser, as: "user" }],
    order: [["updatedAt", "DESC"]],
  }).catch(() => null);
}

async function grantE2ePublishAccess(input = {}, adminId = null) {
  const twitterHandle = assertTwitterHandle(input.twitterHandle || input.handle);
  const identity = await findTwitterIdentity(twitterHandle);
  const payload = {
    featureKey: E2E_PUBLISH_FEATURE_KEY,
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
      where: {
        featureKey: E2E_PUBLISH_FEATURE_KEY,
        resourceId: GLOBAL_RESOURCE_ID,
        twitterHandle,
        status: ACTIVE,
      },
      transaction,
      lock: true,
    });
    if (existing) return { access: existing, created: false };
    const access = await EchohuntFeatureAccess.create(payload, { transaction });
    return { access, created: true };
  });
}

async function listE2ePublishAccesses({ status = ACTIVE } = {}) {
  const where = {
    featureKey: E2E_PUBLISH_FEATURE_KEY,
    resourceId: GLOBAL_RESOURCE_ID,
    ...(status ? { status } : {}),
  };
  const records = await EchohuntFeatureAccess.findAll({
    where,
    order: [["updatedAt", "DESC"], ["id", "DESC"]],
  });
  return records.map(serializeE2ePublishAccess);
}

async function revokeE2ePublishAccess(accessId, adminId = null) {
  const access = await EchohuntFeatureAccess.findOne({
    where: {
      id: accessId,
      featureKey: E2E_PUBLISH_FEATURE_KEY,
      resourceId: GLOBAL_RESOURCE_ID,
    },
  });
  if (!access) throw accessError("E2E_PUBLISH_ACCESS_NOT_FOUND", 404, "投放授权不存在");
  if (access.status === ACTIVE) {
    await access.update({ status: REVOKED, revokedAt: new Date(), revokedByAdminId: adminId });
  }
  return access;
}

module.exports = {
  E2E_PUBLISH_FEATURE_KEY,
  assertE2ePublishAccess,
  getE2ePublishAccessSummary,
  grantE2ePublishAccess,
  listE2ePublishAccesses,
  normalizeTwitterHandle,
  revokeE2ePublishAccess,
  serializeE2ePublishAccess,
};
