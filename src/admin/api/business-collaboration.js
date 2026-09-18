const express = require("express");
const axios = require("axios");
const { Op } = require("sequelize");
const { requirePermission } = require("../middleware/adminAuth");
const {
  BusinessCollaborationActivity,
  BusinessCollaborationActivityAccess,
  AuthCenterXhuntUser,
  AuthCenterXhuntIdentity,
  pgInstance,
} = require("../../models/postgres-start");
const { logAdminAction } = require("../../xhunt/api/stats-routes/shared");

const router = express.Router();
const MANAGE_PERMISSION = "business_collaboration_manage";
const ACTIVITY_STATUSES = new Set(["draft", "open", "paused", "archived"]);
const ACCESS_ROLES = new Set(["project_manager", "agency_manager"]);
const ACCESS_STATUSES = new Set(["active", "paused", "revoked"]);
const REVIEWER_MODES = new Set(["echohunt", "project"]);
const TWITTER_USER_LOOKUP_URL = "https://data.cryptohunt.ai/fetch/twitter/user";

router.use(express.json({ limit: "1mb" }));
router.use(requirePermission(MANAGE_PERMISSION));

function publicError(message, status = 400, code = message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function text(value, max = 0) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  if (max && result.length > max) throw publicError(`字段长度不能超过 ${max}`);
  return result || null;
}

function decimalToCents(value, field, { allowZero = false } = {}) {
  const raw = text(value, 32);
  if (!raw || !/^\d{1,18}(?:\.\d{1,2})?$/.test(raw)) {
    throw publicError(`${field} 必须是大于 0 且最多两位小数的金额`);
  }
  const [integer, fraction = ""] = raw.split(".");
  const cents = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents < 0n || (!allowZero && cents === 0n)) throw publicError(`${field} 必须是大于 0 且最多两位小数的金额`);
  return cents;
}

function formatCents(cents) {
  const normalized = BigInt(cents);
  return `${normalized / 100n}.${String(normalized % 100n).padStart(2, "0")}`;
}

function decimal(value, field) {
  return formatCents(decimalToCents(value, field));
}

function positiveInt(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 1000000) throw publicError(`${field} 必须是 1-1000000 的整数`);
  return n;
}

function date(value, field) {
  const result = new Date(value);
  if (!value || Number.isNaN(result.getTime())) throw publicError(`${field} 格式不正确`);
  return result;
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw publicError(`${field} 必须是对象`);
  return value;
}

function normalizeTwitterHandle(value) {
  const raw = text(value, 512);
  if (!raw) return null;
  const withoutUrl = raw.replace(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\//i, "").split(/[/?#]/)[0];
  const handle = withoutUrl.replace(/^@+/, "").trim();
  if (!/^[A-Za-z0-9_]{1,128}$/.test(handle)) throw publicError("请输入有效的项目 X Handle");
  return handle;
}

function normalizeTwitterAccount(payload) {
  const source = payload?.data?.data || payload?.data?.user || payload?.data || payload?.user || payload?.result || payload;
  if (!source || typeof source !== "object") return null;
  const profile = source.profile && typeof source.profile === "object" ? source.profile : {};
  const handle = normalizeTwitterHandle(source.handle || source.username || source.username_raw || source.screen_name || source.userName || profile.username || profile.username_raw);
  const twitterId = text(source.twitterId || source.twitter_id || source.id || source.userId || profile.id, 64);
  if (!handle || !twitterId) return null;
  return {
    twitterId,
    handle,
    displayName: text(source.name || source.displayName || source.display_name || profile.name || handle, 256),
    avatar: text(source.avatar || source.profile_image_url || source.profileImageUrl || profile.profile_image_url, 2048),
    followers: Number(source.followers || source.followers_count || profile.followers_count || 0) || 0,
  };
}

function normalizeAccessAssignments(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw publicError("项目方人员必须是列表");
  const ids = value.map((item) => text(item, 64)).filter(Boolean);
  if (ids.length !== value.length || new Set(ids).size !== ids.length) throw publicError("项目方人员包含无效或重复用户");
  if (ids.length > 50) throw publicError("一次最多分配 50 位项目方人员");
  return ids;
}

function normalizeActivityPayload(payload, { partial = false } = {}) {
  const next = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  if (!partial || has("name")) {
    const value = text(payload.name, 160);
    if (!value) throw publicError("活动名称不能为空");
    next.name = value;
  }
  if (!partial || has("projectTwitterId")) {
    const value = text(payload.projectTwitterId, 64);
    if (!value) throw publicError("项目 X 账号 Twitter ID 不能为空");
    next.projectTwitterId = value;
  }
  ["projectTwitterHandle", "projectDisplayName", "description"].forEach((key) => {
    if (has(key)) next[key] = text(payload[key], key === "description" ? 10000 : key === "projectDisplayName" ? 256 : 128);
  });
  if (!partial || has("fundingPoolAmount")) next.fundingPoolAmount = decimal(payload.fundingPoolAmount, "资金池金额");
  if (!partial || has("currency")) {
    const value = text(payload.currency, 8)?.toUpperCase();
    if (!value || !/^[A-Z0-9]{2,8}$/.test(value)) throw publicError("币种格式不正确");
    next.currency = value;
  }
  if (!partial || has("seatLimit")) next.seatLimit = positiveInt(payload.seatLimit, "名额");
  if (!partial || has("startAt")) next.startAt = date(payload.startAt, "开始时间");
  if (!partial || has("endAt")) next.endAt = date(payload.endAt, "结束时间");
  if (has("reviewerMode") || !partial) {
    const value = text(payload.reviewerMode || "project", 32);
    if (!REVIEWER_MODES.has(value)) throw publicError("审核方只能是 echohunt 或 project");
    next.reviewerMode = value;
  }
  if (has("status")) {
    const value = text(payload.status, 32);
    if (!ACTIVITY_STATUSES.has(value)) throw publicError("活动状态不正确");
    next.status = value;
  }
  if (has("invitationTemplate") || !partial) next.invitationTemplate = object(payload.invitationTemplate || {}, "邀约默认模板");
  return next;
}

async function createProjectManagerAccesses(activityId, authCenterUserIds, req, transaction) {
  if (!authCenterUserIds.length) return;
  const users = await AuthCenterXhuntUser.findAll({
    where: { id: { [Op.in]: authCenterUserIds }, status: "active" },
    include: [{ model: AuthCenterXhuntIdentity, as: "identities", where: { provider: "twitter" }, required: false, attributes: ["providerSubject"] }],
    transaction,
  });
  if (users.length !== authCenterUserIds.length) throw publicError("所选项目方人员不存在或已不可用", 404, "AUTH_CENTER_USER_NOT_FOUND");
  await BusinessCollaborationActivityAccess.bulkCreate(users.map((user) => ({
    activityId,
    authCenterUserId: user.id,
    twitterId: user.identities?.[0]?.providerSubject || user.primaryTwitterId || null,
    role: "project_manager",
    status: "active",
    assignedByAdminId: req.adminUser?.id || null,
  })), { transaction });
}

function validateActivityDates(next, existing = null) {
  const startAt = next.startAt || existing?.startAt;
  const endAt = next.endAt || existing?.endAt;
  if (startAt && endAt && new Date(startAt).getTime() >= new Date(endAt).getTime()) {
    throw publicError("开始时间必须早于结束时间");
  }
}

function serializeAccess(row) {
  const item = row.toJSON ? row.toJSON() : row;
  return {
    id: item.id,
    activityId: item.activityId,
    authCenterUserId: item.authCenterUserId,
    twitterId: item.twitterId || null,
    role: item.role,
    status: item.status,
    reason: item.reason || null,
    assignedByAdminId: item.assignedByAdminId || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    user: item.authCenterUser
      ? { id: item.authCenterUser.id, accountName: item.authCenterUser.accountName, displayName: item.authCenterUser.displayName, primaryTwitterId: item.authCenterUser.primaryTwitterId }
      : null,
  };
}

function serializeActivity(row) {
  const item = row.toJSON ? row.toJSON() : row;
  const totalCommitted = [item.reservedAmount, item.lockedAmount, item.claimableAmount, item.paidAmount]
    .reduce((sum, value) => sum + decimalToCents(value || "0.00", "金额", { allowZero: true }), 0n);
  const availableAmount = decimalToCents(item.fundingPoolAmount, "资金池金额") - totalCommitted;
  return {
    ...item,
    availableAmount: formatCents(availableAmount > 0n ? availableAmount : 0n),
    accesses: Array.isArray(item.accesses) ? item.accesses.map(serializeAccess) : undefined,
  };
}

async function loadActivity(id, { transaction, lock = false } = {}) {
  const activity = await BusinessCollaborationActivity.findByPk(id, {
    transaction,
    lock: lock ? transaction.LOCK.UPDATE : undefined,
    include: [{ model: BusinessCollaborationActivityAccess, as: "accesses", include: [{ model: AuthCenterXhuntUser, as: "authCenterUser", attributes: ["id", "accountName", "displayName", "primaryTwitterId"] }] }],
  });
  if (!activity) throw publicError("定向合作活动不存在", 404, "ACTIVITY_NOT_FOUND");
  return activity;
}

router.get("/activities", async (req, res) => {
  try {
    const where = {};
    const status = text(req.query.status, 32);
    const projectTwitterId = text(req.query.projectTwitterId, 64);
    if (status) where.status = status;
    if (projectTwitterId) where.projectTwitterId = projectTwitterId;
    const activities = await BusinessCollaborationActivity.findAll({
      where,
      include: [{ model: BusinessCollaborationActivityAccess, as: "accesses", include: [{ model: AuthCenterXhuntUser, as: "authCenterUser", attributes: ["id", "accountName", "displayName", "primaryTwitterId"] }] }],
      order: [["updatedAt", "DESC"]],
    });
    return res.json({ success: true, data: activities.map(serializeActivity) });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.code || error.message });
  }
});

router.get("/project-account", async (req, res) => {
  try {
    const handle = normalizeTwitterHandle(req.query.handle);
    if (!handle) throw publicError("请输入项目 X Handle");
    const response = await axios.get(TWITTER_USER_LOOKUP_URL, { params: { username: handle }, timeout: 8000 });
    const account = normalizeTwitterAccount(response.data);
    if (!account) throw publicError("未找到该项目 X 账号，请检查 Handle", 404, "PROJECT_ACCOUNT_NOT_FOUND");
    return res.json({ success: true, data: account });
  } catch (error) {
    if (error.response?.status === 404) return res.status(404).json({ success: false, error: "PROJECT_ACCOUNT_NOT_FOUND" });
    return res.status(error.status || 503).json({ success: false, error: error.code || error.message || "PROJECT_ACCOUNT_LOOKUP_FAILED" });
  }
});

router.get("/assignees", async (req, res) => {
  try {
    const query = text(req.query.q, 128) || "";
    const like = `%${query}%`;
    const twitterHandleLike = `%${query.replace(/^@+/, "")}%`;
    const users = await AuthCenterXhuntUser.findAll({
      where: {
        status: "active",
        ...(query ? { [Op.or]: [
          { accountName: { [Op.iLike]: like } },
          { displayName: { [Op.iLike]: like } },
          { primaryGoogleEmail: { [Op.iLike]: like } },
          { "$identities.username$": { [Op.iLike]: twitterHandleLike } },
        ] } : {}),
      },
      include: [{ model: AuthCenterXhuntIdentity, as: "identities", where: { provider: "twitter" }, required: false, attributes: ["username", "displayName"] }],
      attributes: ["id", "accountName", "displayName", "primaryTwitterId", "primaryGoogleEmail"],
      order: [["updatedAt", "DESC"]],
      limit: 20,
      subQuery: false,
    });
    return res.json({ success: true, data: users.map((user) => ({
      id: user.id,
      accountName: user.accountName,
      displayName: user.displayName,
      primaryTwitterId: user.primaryTwitterId,
      primaryGoogleEmail: user.primaryGoogleEmail,
      twitterHandle: user.identities?.[0]?.username || null,
      twitterDisplayName: user.identities?.[0]?.displayName || null,
    })) });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.code || error.message });
  }
});

router.post("/activities", async (req, res) => {
  try {
    const payload = normalizeActivityPayload(req.body || {});
    const authCenterUserIds = normalizeAccessAssignments(req.body?.authCenterUserIds);
    validateActivityDates(payload);
    const activity = await pgInstance.transaction(async (transaction) => {
      const created = await BusinessCollaborationActivity.create({ ...payload, status: payload.status || "draft" }, { transaction });
      await createProjectManagerAccesses(created.id, authCenterUserIds, req, transaction);
      return loadActivity(created.id, { transaction });
    });
    await logAdminAction(req, { action: "business-collaboration-activity-create", success: true, message: `activityId=${activity.id};projectTwitterId=${activity.projectTwitterId}` });
    return res.status(201).json({ success: true, data: serializeActivity(activity) });
  } catch (error) {
    await logAdminAction(req, { action: "business-collaboration-activity-create", success: false, message: error.message }).catch(() => {});
    return res.status(error.status || 500).json({ success: false, error: error.code || error.message });
  }
});

router.get("/activities/:activityId", async (req, res) => {
  try {
    return res.json({ success: true, data: serializeActivity(await loadActivity(req.params.activityId)) });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.code || error.message });
  }
});

router.patch("/activities/:activityId", async (req, res) => {
  try {
    const activity = await pgInstance.transaction(async (transaction) => {
      const current = await loadActivity(req.params.activityId, { transaction, lock: true });
      const payload = normalizeActivityPayload(req.body || {}, { partial: true });
      validateActivityDates(payload, current);
      const committed = [current.reservedAmount, current.lockedAmount, current.claimableAmount, current.paidAmount].reduce((sum, value) => sum + decimalToCents(value || "0.00", "金额", { allowZero: true }), 0n);
      if (payload.fundingPoolAmount && decimalToCents(payload.fundingPoolAmount, "资金池金额") < committed) throw publicError("资金池不能低于已预留、锁定、可领取和已支付金额总和");
      if (
        committed > 0n &&
        ((payload.currency && payload.currency !== current.currency) ||
          (payload.projectTwitterId && payload.projectTwitterId !== current.projectTwitterId))
      ) {
        throw publicError("已有金额承诺后不能修改币种或项目 X 账号，请归档后新建活动");
      }
      await current.update(payload, { transaction });
      return loadActivity(current.id, { transaction });
    });
    await logAdminAction(req, { action: "business-collaboration-activity-update", success: true, message: `activityId=${activity.id}` });
    return res.json({ success: true, data: serializeActivity(activity) });
  } catch (error) {
    await logAdminAction(req, { action: "business-collaboration-activity-update", success: false, message: error.message }).catch(() => {});
    return res.status(error.status || 500).json({ success: false, error: error.code || error.message });
  }
});

router.delete("/activities/:activityId", async (req, res) => {
  try {
    await pgInstance.transaction(async (transaction) => {
      const activity = await loadActivity(req.params.activityId, { transaction, lock: true });
      const committed = [activity.reservedAmount, activity.lockedAmount, activity.claimableAmount, activity.paidAmount]
        .some((value) => decimalToCents(value || "0.00", "金额", { allowZero: true }) > 0n);
      if (activity.status !== "draft" || committed) throw publicError("只有没有金额承诺的 draft 活动可以删除；其他活动请归档", 409, "ACTIVITY_DELETE_FORBIDDEN");
      await activity.destroy({ transaction });
    });
    await logAdminAction(req, { action: "business-collaboration-activity-delete", success: true, message: `activityId=${req.params.activityId}` });
    return res.json({ success: true });
  } catch (error) {
    await logAdminAction(req, { action: "business-collaboration-activity-delete", success: false, message: error.message }).catch(() => {});
    return res.status(error.status || 500).json({ success: false, error: error.code || error.message });
  }
});

router.get("/activities/:activityId/accesses", async (req, res) => {
  try {
    await loadActivity(req.params.activityId);
    const rows = await BusinessCollaborationActivityAccess.findAll({
      where: { activityId: req.params.activityId },
      include: [{ model: AuthCenterXhuntUser, as: "authCenterUser", attributes: ["id", "accountName", "displayName", "primaryTwitterId"] }],
      order: [["createdAt", "DESC"]],
    });
    return res.json({ success: true, data: rows.map(serializeAccess) });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.code || error.message });
  }
});

router.post("/activities/:activityId/accesses", async (req, res) => {
  try {
    const role = text(req.body?.role, 32);
    if (!ACCESS_ROLES.has(role)) throw publicError("授权角色只能是 project_manager 或 agency_manager");
    const authCenterUserId = text(req.body?.authCenterUserId, 64);
    if (!authCenterUserId) throw publicError("authCenterUserId 不能为空");
    const reason = text(req.body?.reason, 500);
    const access = await pgInstance.transaction(async (transaction) => {
      await loadActivity(req.params.activityId, { transaction, lock: true });
      const user = await AuthCenterXhuntUser.findByPk(authCenterUserId, { transaction });
      if (!user) throw publicError("认证中心用户不存在", 404, "AUTH_CENTER_USER_NOT_FOUND");
      const twitter = await AuthCenterXhuntIdentity.findOne({ where: { userId: user.id, provider: "twitter" }, transaction });
      const values = { activityId: req.params.activityId, authCenterUserId: user.id, twitterId: twitter?.providerSubject || user.primaryTwitterId || null, role, status: "active", assignedByAdminId: req.adminUser?.id || null, reason };
      const existing = await BusinessCollaborationActivityAccess.findOne({ where: { activityId: values.activityId, authCenterUserId: values.authCenterUserId }, transaction, lock: transaction.LOCK.UPDATE });
      if (existing) {
        await existing.update(values, { transaction });
        return existing;
      }
      return BusinessCollaborationActivityAccess.create(values, { transaction });
    });
    await logAdminAction(req, { action: "business-collaboration-access-grant", success: true, message: `activityId=${req.params.activityId};authCenterUserId=${authCenterUserId}` });
    return res.status(201).json({ success: true, data: serializeAccess(access) });
  } catch (error) {
    await logAdminAction(req, { action: "business-collaboration-access-grant", success: false, message: error.message }).catch(() => {});
    return res.status(error.status || 500).json({ success: false, error: error.code || error.message });
  }
});

router.patch("/activities/:activityId/accesses/:accessId", async (req, res) => {
  try {
    const status = text(req.body?.status, 32);
    if (!ACCESS_STATUSES.has(status)) throw publicError("授权状态只能是 active、paused 或 revoked");
    const reason = text(req.body?.reason, 500);
    const access = await BusinessCollaborationActivityAccess.findOne({ where: { id: req.params.accessId, activityId: req.params.activityId } });
    if (!access) throw publicError("活动授权不存在", 404, "ACTIVITY_ACCESS_NOT_FOUND");
    await access.update({ status, reason: reason || access.reason });
    await logAdminAction(req, { action: "business-collaboration-access-update", success: true, message: `activityId=${req.params.activityId};accessId=${access.id};status=${status}` });
    return res.json({ success: true, data: serializeAccess(access) });
  } catch (error) {
    await logAdminAction(req, { action: "business-collaboration-access-update", success: false, message: error.message }).catch(() => {});
    return res.status(error.status || 500).json({ success: false, error: error.code || error.message });
  }
});

module.exports = router;
