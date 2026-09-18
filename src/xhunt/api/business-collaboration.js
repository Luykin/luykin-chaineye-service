const crypto = require("crypto");
const express = require("express");
const { Op } = require("sequelize");
const {
  pgInstance,
  BusinessCollaborationActivity,
  BusinessCollaborationActivityAccess,
  BusinessCollaborationInvitation,
  BusinessCollaboration,
  BusinessCollaborationBudgetLedger,
  BusinessCollaborationAuditLog,
  XHuntKolCollaboration,
} = require("../../models/postgres-start");
const { authenticateAuthCenterToken } = require("../auth-center/middleware/auth");
const { PROVIDERS } = require("../auth-center/services/auth");
const { extractEvm40Address } = require("../auth-center/services/utils");
const { decimalToCents, formatCents, sumMoney } = require("../business-collaboration/money");

const router = express.Router();
const ACCESS_ROLES = new Set(["project_manager", "agency_manager"]);
const MANAGER_VISIBLE_INVITATION_STATUSES = new Set([
  "sent",
  "accepted",
  "confirmed",
  "kol_declined",
  "project_declined",
  "reservation_expired",
]);
const INVITATION_OVERRIDE_FIELDS = new Set([
  "title",
  "message",
  "brief",
  "contentFormat",
  "contentCount",
  "language",
  "requiredPoints",
]);
const DEFAULT_MINIMUM_OFFER_AMOUNT = "100.00";
const DEFAULT_CONFIRMATION_DEADLINE_HOURS = 72;

router.use(express.json({ limit: "1mb" }));
router.use(authenticateAuthCenterToken());

function publicError(message, status = 400, code = message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function sendError(res, error, fallback = "BUSINESS_COLLABORATION_ERROR") {
  return res.status(error.status || 500).json({
    success: false,
    error: error.code || error.message || fallback,
    message: error.publicMessage || undefined,
    ...(error.details ? { details: error.details } : {}),
  });
}

function getRequestId(req) {
  if (req.businessCollaborationRequestId) return req.businessCollaborationRequestId;
  const requestId = String(req.requestId || req.headers["x-request-id"] || req.headers["x-xhunt-web-request-id"] || crypto.randomUUID()).slice(0, 128);
  req.businessCollaborationRequestId = requestId;
  return requestId;
}

function getIdempotencyKey(req) {
  const value = req.headers["idempotency-key"] || req.body?.idempotencyKey;
  const key = String(value || "").trim();
  if (!key || key.length > 128) throw publicError("所有写操作都需要有效的 Idempotency-Key", 400, "IDEMPOTENCY_KEY_REQUIRED");
  return key;
}

function getTwitterIdentity(req) {
  const identity = (req.authCenter?.identities || []).find((item) => item.provider === PROVIDERS.TWITTER);
  const twitterId = String(identity?.providerSubject || "").trim();
  if (!twitterId) throw publicError("请先使用 X 登录 EchoHunt。", 400, "TWITTER_ID_REQUIRED");
  return {
    twitterId,
    username: identity.username || null,
    displayName: identity.displayName || identity.username || null,
    authCenterUserId: req.authCenter.user.id,
  };
}

function text(value, field, max = 0, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw publicError(`${field} 不能为空`, 400, "INVALID_INPUT");
    return null;
  }
  const normalized = String(value).trim();
  if (required && !normalized) throw publicError(`${field} 不能为空`, 400, "INVALID_INPUT");
  if (max && normalized.length > max) throw publicError(`${field} 不能超过 ${max} 个字符`, 400, "INVALID_INPUT");
  return normalized || null;
}

function positiveInt(value, field, { min = 1, max = 1000000, fallback } = {}) {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw publicError(`${field} 必须是 ${min}-${max} 的整数`, 400, "INVALID_INPUT");
  }
  return number;
}

function stringList(value, field, { maxItems = 20, maxItemLength = 240 } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw publicError(`${field} 格式不正确`, 400, "INVALID_INPUT");
  return value.map((item) => text(item, field, maxItemLength, { required: true }));
}

function activityRecruitmentError(activity, now = new Date()) {
  if (activity.status !== "open") return publicError("活动当前不开放新邀约", 409, "ACTIVITY_NOT_OPEN");
  if (new Date(activity.startAt).getTime() > now.getTime()) return publicError("活动尚未开始", 409, "ACTIVITY_NOT_STARTED");
  if (new Date(activity.endAt).getTime() <= now.getTime()) return publicError("活动已结束，不能发送或接受新邀约", 409, "ACTIVITY_ENDED");
  return null;
}

function recruitmentState(activity, now = new Date()) {
  if (activity.status !== "open") return "closed_for_new_invitations";
  if (new Date(activity.startAt).getTime() > now.getTime()) return "scheduled";
  if (new Date(activity.endAt).getTime() <= now.getTime()) return "closed_for_new_invitations";
  const usedSeats = Number(activity.reservedSeatCount || 0) + Number(activity.confirmedSeatCount || 0);
  return usedSeats >= Number(activity.seatLimit || 0) ? "closed_for_new_invitations" : "open";
}

function getAvailableAmountCents(activity) {
  return decimalToCents(activity.fundingPoolAmount, "资金池金额") - sumMoney([
    activity.reservedAmount,
    activity.lockedAmount,
    activity.claimableAmount,
    activity.paidAmount,
  ]);
}

function serializeActivityForManager(activity, access) {
  const item = activity.toJSON ? activity.toJSON() : activity;
  const available = getAvailableAmountCents(item);
  return {
    id: item.id,
    name: item.name,
    description: item.description || null,
    project: {
      twitterId: item.projectTwitterId,
      twitterHandle: item.projectTwitterHandle || null,
      displayName: item.projectDisplayName || null,
    },
    currency: item.currency,
    budget: {
      fundingPoolAmount: formatCents(decimalToCents(item.fundingPoolAmount, "资金池金额")),
      reservedAmount: formatCents(decimalToCents(item.reservedAmount || "0", "金额", { allowZero: true })),
      lockedAmount: formatCents(decimalToCents(item.lockedAmount || "0", "金额", { allowZero: true })),
      claimableAmount: formatCents(decimalToCents(item.claimableAmount || "0", "金额", { allowZero: true })),
      paidAmount: formatCents(decimalToCents(item.paidAmount || "0", "金额", { allowZero: true })),
      availableAmount: formatCents(available > 0n ? available : 0n),
    },
    seats: {
      limit: item.seatLimit,
      reserved: item.reservedSeatCount,
      confirmed: item.confirmedSeatCount,
      available: Math.max(0, item.seatLimit - item.reservedSeatCount - item.confirmedSeatCount),
    },
    startAt: item.startAt,
    endAt: item.endAt,
    reviewerMode: item.reviewerMode,
    status: item.status,
    recruitmentState: recruitmentState(item),
    invitationTemplate: item.invitationTemplate || {},
    access: access
      ? { id: access.id, role: access.role, status: access.status }
      : undefined,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function snapshotField(value, field, max, required = false) {
  return text(value, field, max, { required });
}

function snapshotMultiSelectField(value, field, max) {
  if (Array.isArray(value)) return stringList(value, field, { maxItems: 10, maxItemLength: max }).join("、");
  return snapshotField(value, field, max);
}

function normalizeInvitationSnapshot(template, invitation, activity) {
  const base = template && typeof template === "object" && !Array.isArray(template) ? template : {};
  const overrides = invitation?.overrides && typeof invitation.overrides === "object" && !Array.isArray(invitation.overrides)
    ? invitation.overrides
    : {};
  const allowed = new Set(Array.isArray(base.allowedOverrideFields)
    ? base.allowedOverrideFields.filter((field) => INVITATION_OVERRIDE_FIELDS.has(field))
    : [...INVITATION_OVERRIDE_FIELDS]);
  const value = (field) => Object.prototype.hasOwnProperty.call(overrides, field) && allowed.has(field)
    ? overrides[field]
    : base[field];

  const title = snapshotField(value("title"), "邀约标题", 200) || activity.name;
  const message = snapshotField(value("message"), "邀约说明", 5000);
  const brief = snapshotField(value("brief"), "合作 Brief", 10000);
  const contentFormat = snapshotMultiSelectField(value("contentFormat"), "内容形式", 128);
  const language = snapshotMultiSelectField(value("language"), "内容语言", 64);
  const requiredPoints = stringList(value("requiredPoints"), "必须表达事项");
  const rawContentCount = value("contentCount");
  const contentCount = rawContentCount === undefined || rawContentCount === null || rawContentCount === ""
    ? null
    : positiveInt(rawContentCount, "内容数量", { max: 100 });
  const confirmationDeadlineHours = positiveInt(base.confirmationDeadlineHours, "项目方确认时限", {
    min: 1,
    max: 720,
    fallback: DEFAULT_CONFIRMATION_DEADLINE_HOURS,
  });

  return {
    title,
    message,
    brief,
    contentFormat,
    contentCount,
    language,
    requiredPoints,
    confirmationDeadlineHours,
    activity: {
      name: activity.name,
      projectTwitterId: activity.projectTwitterId,
      projectTwitterHandle: activity.projectTwitterHandle || null,
      projectDisplayName: activity.projectDisplayName || null,
      startAt: activity.startAt,
      endAt: activity.endAt,
      reviewerMode: activity.reviewerMode,
    },
  };
}

function serializeManagerInvitation(invitation) {
  const item = invitation.toJSON ? invitation.toJSON() : invitation;
  const collaboration = item.collaboration || null;
  return {
    id: item.id,
    activityId: item.activityId,
    kol: {
      twitterId: item.kolTwitterId,
      authCenterUserId: item.kolAuthCenterUserId || null,
      username: item.invitationSnapshot?.kol?.username || null,
      displayName: item.invitationSnapshot?.kol?.displayName || null,
    },
    invitationSnapshot: item.invitationSnapshot || {},
    offerAmount: String(item.offerAmount),
    currency: item.currency,
    status: item.status,
    acceptedAt: item.acceptedAt || null,
    reservationExpiresAt: item.reservationExpiresAt || null,
    declineReason: item.declineReason || null,
    collaboration: collaboration
      ? { id: collaboration.id, status: collaboration.status, confirmedAt: collaboration.confirmedAt }
      : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function serializeKolInvitation(invitation) {
  const item = invitation.toJSON ? invitation.toJSON() : invitation;
  const snapshot = item.invitationSnapshot || {};
  const confirmed = item.status === "confirmed" || !!item.collaboration;
  return {
    id: item.id,
    activity: {
      id: item.activityId,
      name: snapshot.activity?.name || item.activity?.name || null,
      projectTwitterHandle: snapshot.activity?.projectTwitterHandle || item.activity?.projectTwitterHandle || null,
      projectDisplayName: snapshot.activity?.projectDisplayName || item.activity?.projectDisplayName || null,
      endAt: snapshot.activity?.endAt || item.activity?.endAt || null,
    },
    status: item.status,
    invitation: {
      title: snapshot.title || null,
      message: snapshot.message || null,
      contentFormat: snapshot.contentFormat || null,
      contentCount: snapshot.contentCount || null,
      language: snapshot.language || null,
    },
    // Internal offer/reservation amounts must never be exposed as a grant or claimable amount.
    brief: confirmed ? (snapshot.brief || null) : null,
    requiredPoints: confirmed ? (snapshot.requiredPoints || []) : [],
    acceptedAt: item.acceptedAt || null,
    reservationExpiresAt: item.reservationExpiresAt || null,
    collaboration: item.collaboration
      ? { id: item.collaboration.id, status: item.collaboration.status, confirmedAt: item.collaboration.confirmedAt }
      : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function loadActiveAccess(activityId, authCenterUserId, transaction, { lock = false } = {}) {
  const access = await BusinessCollaborationActivityAccess.findOne({
    where: { activityId, authCenterUserId, status: "active" },
    transaction,
    lock: lock ? transaction.LOCK.UPDATE : undefined,
  });
  if (!access || !ACCESS_ROLES.has(access.role)) {
    throw publicError("你没有此定向合作活动的管理权限", 403, "ACTIVITY_ACCESS_FORBIDDEN");
  }
  return access;
}

async function loadActivityForUpdate(activityId, transaction) {
  const activity = await BusinessCollaborationActivity.findByPk(activityId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!activity) throw publicError("定向合作活动不存在", 404, "ACTIVITY_NOT_FOUND");
  return activity;
}

async function audit({ transaction, req, activityId = null, invitationId = null, collaborationId = null, action, actorType, metadata = null }) {
  await BusinessCollaborationAuditLog.create({
    activityId,
    invitationId,
    collaborationId,
    actorAuthCenterUserId: req.authCenter?.user?.id || null,
    actorType,
    action,
    requestId: getRequestId(req),
    metadata,
  }, { transaction });
}

async function getKolCollaborationForIdentity(identity, transaction, { lock = false } = {}) {
  const byUser = await XHuntKolCollaboration.findOne({
    where: { authCenterUserId: identity.authCenterUserId },
    transaction,
    lock: lock ? transaction.LOCK.UPDATE : undefined,
  });
  const byTwitter = await XHuntKolCollaboration.findOne({
    where: { twitterId: identity.twitterId },
    transaction,
    lock: lock ? transaction.LOCK.UPDATE : undefined,
  });
  if (byUser && byUser.twitterId !== identity.twitterId) {
    throw publicError("当前 X 身份与既有商务资料不一致，请联系支持处理。", 409, "KOL_IDENTITY_CONFLICT");
  }
  if (byTwitter && byTwitter.authCenterUserId !== identity.authCenterUserId) {
    throw publicError("该 X 身份已关联其他 EchoHunt 账号，请联系支持处理。", 409, "KOL_IDENTITY_CONFLICT");
  }
  return byUser || byTwitter || null;
}

function payoutNonceKey(userId, address) {
  return `business_collaboration:payout_address:${userId}:${address}`;
}

function payoutAddressPayload(record) {
  return {
    address: record?.defaultPayoutAddress || null,
    verifiedAt: record?.payoutAddressVerifiedAt || null,
    version: record?.payoutAddressVersion || 0,
  };
}

router.get("/activities/available", async (req, res) => {
  try {
    const accesses = await BusinessCollaborationActivityAccess.findAll({
      where: { authCenterUserId: req.authCenter.user.id, status: "active", role: { [Op.in]: [...ACCESS_ROLES] } },
      include: [{ model: BusinessCollaborationActivity, as: "activity" }],
      order: [[{ model: BusinessCollaborationActivity, as: "activity" }, "endAt", "ASC"]],
    });
    const data = accesses
      .filter((access) => access.activity && recruitmentState(access.activity) === "open")
      .map((access) => serializeActivityForManager(access.activity, access));
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, "ACTIVITY_LIST_FAILED");
  }
});

router.get("/me", async (req, res) => {
  try {
    const identity = getTwitterIdentity(req);
    const [accesses, invitations] = await Promise.all([
      BusinessCollaborationActivityAccess.findAll({
        where: { authCenterUserId: req.authCenter.user.id, status: "active", role: { [Op.in]: [...ACCESS_ROLES] } },
        include: [{ model: BusinessCollaborationActivity, as: "activity" }],
        order: [[{ model: BusinessCollaborationActivity, as: "activity" }, "updatedAt", "DESC"]],
      }),
      BusinessCollaborationInvitation.findAll({
        where: { kolTwitterId: identity.twitterId },
        include: [
          { model: BusinessCollaborationActivity, as: "activity" },
          { model: BusinessCollaboration, as: "collaboration" },
        ],
        order: [["updatedAt", "DESC"]],
      }),
    ]);
    res.set("Cache-Control", "no-store");
    return res.json({
      success: true,
      data: {
        managedActivities: accesses.filter((access) => access.activity).map((access) => serializeActivityForManager(access.activity, access)),
        kolTasks: invitations.map(serializeKolInvitation),
      },
    });
  } catch (error) {
    return sendError(res, error, "BUSINESS_COLLABORATION_ME_FAILED");
  }
});

router.get("/activities/:activityId", async (req, res) => {
  try {
    const activityId = text(req.params.activityId, "活动 ID", 64, { required: true });
    const access = await loadActiveAccess(activityId, req.authCenter.user.id);
    const activity = await BusinessCollaborationActivity.findByPk(activityId);
    if (!activity) throw publicError("定向合作活动不存在", 404, "ACTIVITY_NOT_FOUND");
    const invitations = await BusinessCollaborationInvitation.findAll({
      where: { activityId, status: { [Op.in]: [...MANAGER_VISIBLE_INVITATION_STATUSES] } },
      include: [{ model: BusinessCollaboration, as: "collaboration" }],
      order: [["updatedAt", "DESC"]],
    });
    res.set("Cache-Control", "no-store");
    return res.json({
      success: true,
      data: { ...serializeActivityForManager(activity, access), invitations: invitations.map(serializeManagerInvitation) },
    });
  } catch (error) {
    return sendError(res, error, "ACTIVITY_DETAIL_FAILED");
  }
});

router.get("/me/payout-address", async (req, res) => {
  try {
    const identity = getTwitterIdentity(req);
    const record = await getKolCollaborationForIdentity(identity, null);
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: payoutAddressPayload(record) });
  } catch (error) {
    return sendError(res, error, "PAYOUT_ADDRESS_GET_FAILED");
  }
});

router.post("/me/payout-address/change/challenge", async (req, res) => {
  try {
    const identity = getTwitterIdentity(req);
    const newAddress = extractEvm40Address(req.body?.newAddress);
    if (!newAddress || newAddress !== String(req.body?.newAddress || "").trim().toLowerCase()) {
      throw publicError("收款地址必须是有效的 EVM 地址", 400, "INVALID_EVM_ADDRESS");
    }
    if (!req.redisClient?.setEx) throw publicError("收款地址验证暂不可用，请稍后重试", 503, "PAYOUT_ADDRESS_CHALLENGE_UNAVAILABLE");
    const existing = await getKolCollaborationForIdentity(identity, null);
    const oldAddress = existing?.defaultPayoutAddress || null;
    if (oldAddress === newAddress) {
      return res.json({ success: true, data: { alreadyVerified: true, ...payoutAddressPayload(existing) } });
    }
    const nonce = crypto.randomBytes(16).toString("base64url");
    const issuedAt = new Date().toISOString();
    const domain = String(req.headers.origin || req.headers.host || "echohunt").slice(0, 256);
    const newMessage = [
      "EchoHunt payout address verification",
      `Account: ${identity.authCenterUserId}`,
      `New payout address: ${newAddress}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
      `Domain: ${domain}`,
      "This message does not create a blockchain transaction or charge gas.",
    ].join("\n");
    const oldMessage = oldAddress ? [
      "EchoHunt payout address change authorization",
      `Account: ${identity.authCenterUserId}`,
      `Current payout address: ${oldAddress}`,
      `New payout address: ${newAddress}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
      `Domain: ${domain}`,
      "This message does not create a blockchain transaction or charge gas.",
    ].join("\n") : null;
    await req.redisClient.setEx(payoutNonceKey(identity.authCenterUserId, newAddress), 5 * 60, JSON.stringify({
      newAddress,
      oldAddress,
      nonce,
      newMessage,
      oldMessage,
      issuedAt,
    }));
    return res.json({
      success: true,
      data: { newAddress, newMessage, oldAddress, oldMessage, expiresIn: 300 },
    });
  } catch (error) {
    return sendError(res, error, "PAYOUT_ADDRESS_CHALLENGE_FAILED");
  }
});

router.post("/me/payout-address/change/verify", async (req, res) => {
  try {
    const identity = getTwitterIdentity(req);
    const idempotencyKey = getIdempotencyKey(req);
    const newAddress = extractEvm40Address(req.body?.newAddress);
    if (!newAddress || newAddress !== String(req.body?.newAddress || "").trim().toLowerCase()) {
      throw publicError("收款地址必须是有效的 EVM 地址", 400, "INVALID_EVM_ADDRESS");
    }
    if (!req.redisClient?.get || !req.redisClient?.del) throw publicError("收款地址验证暂不可用，请稍后重试", 503, "PAYOUT_ADDRESS_CHALLENGE_UNAVAILABLE");
    const nonceKey = payoutNonceKey(identity.authCenterUserId, newAddress);
    const raw = await req.redisClient.get(nonceKey);
    const challenge = raw ? JSON.parse(raw) : null;
    if (!challenge?.newMessage || challenge.newAddress !== newAddress) {
      throw publicError("地址验证挑战已过期，请重新发起验证", 400, "PAYOUT_ADDRESS_CHALLENGE_EXPIRED");
    }
    const { utils } = require("ethers");
    let recoveredNew;
    try {
      recoveredNew = utils.verifyMessage(challenge.newMessage, text(req.body?.newSignature, "新地址签名", 4096, { required: true }));
    } catch (_) {
      throw publicError("新地址签名验证失败", 400, "PAYOUT_ADDRESS_SIGNATURE_INVALID");
    }
    if (String(recoveredNew || "").toLowerCase() !== newAddress) {
      throw publicError("新地址签名与收款地址不一致", 400, "PAYOUT_ADDRESS_SIGNATURE_MISMATCH");
    }
    if (challenge.oldAddress) {
      let recoveredOld;
      try {
        recoveredOld = utils.verifyMessage(challenge.oldMessage, text(req.body?.oldSignature, "原地址签名", 4096, { required: true }));
      } catch (_) {
        throw publicError("原地址签名验证失败", 400, "PAYOUT_ADDRESS_SIGNATURE_INVALID");
      }
      if (String(recoveredOld || "").toLowerCase() !== challenge.oldAddress) {
        throw publicError("原地址签名与当前收款地址不一致", 400, "PAYOUT_ADDRESS_SIGNATURE_MISMATCH");
      }
    }
    const record = await pgInstance.transaction(async (transaction) => {
      let current = await getKolCollaborationForIdentity(identity, transaction, { lock: true });
      if (current?.defaultPayoutAddress === newAddress) return current;
      const currentAddress = current?.defaultPayoutAddress || null;
      const challengedOldAddress = challenge.oldAddress || null;
      if (currentAddress !== challengedOldAddress) {
        throw publicError("收款地址已变更，请重新发起验证", 409, "PAYOUT_ADDRESS_CHALLENGE_STALE");
      }
      const now = new Date();
      if (current) {
        await current.update({
          defaultPayoutAddress: newAddress,
          payoutAddressUpdatedAt: now,
          payoutAddressVerifiedAt: now,
          payoutAddressVersion: Number(current.payoutAddressVersion || 0) + 1,
        }, { transaction });
      } else {
        current = await XHuntKolCollaboration.create({
          authCenterUserId: identity.authCenterUserId,
          twitterId: identity.twitterId,
          twitterUsername: identity.username,
          acceptingNewInvitations: false,
          defaultPayoutAddress: newAddress,
          payoutAddressUpdatedAt: now,
          payoutAddressVerifiedAt: now,
          payoutAddressVersion: 1,
          metadata: { source: "echohunt_payout_address_verification" },
        }, { transaction });
      }
      await audit({
        transaction,
        req,
        action: "payout_address_verified",
        actorType: "kol",
        metadata: { address: newAddress, version: current.payoutAddressVersion, idempotencyKey },
      });
      return current;
    });
    // 仅在地址更新提交后消费 nonce；失败时保留挑战，便于用户重试或重新发起。
    await req.redisClient.del(nonceKey).catch((error) => {
      console.warn("[business-collaboration] payout-address nonce cleanup failed:", error.message);
    });
    return res.json({ success: true, data: payoutAddressPayload(record) });
  } catch (error) {
    return sendError(res, error, "PAYOUT_ADDRESS_VERIFY_FAILED");
  }
});

router.post("/invitations", async (req, res) => {
  try {
    const idempotencyKey = getIdempotencyKey(req);
    const activityId = text(req.body?.activityId, "活动 ID", 64, { required: true });
    const invitations = req.body?.invitations;
    if (!Array.isArray(invitations) || !invitations.length || invitations.length > 100) {
      throw publicError("邀约对象必须为 1-100 人", 400, "INVALID_INVITATION_BATCH");
    }
    const data = await pgInstance.transaction(async (transaction) => {
      const access = await loadActiveAccess(activityId, req.authCenter.user.id, transaction, { lock: true });
      const activity = await loadActivityForUpdate(activityId, transaction);
      const replayed = await BusinessCollaborationInvitation.findAll({
        where: { activityId, inviterAccessId: access.id, createIdempotencyKey: idempotencyKey },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (replayed.length) return replayed.map(serializeManagerInvitation);
      const recruitmentError = activityRecruitmentError(activity);
      if (recruitmentError) throw recruitmentError;
      const occupiedSeats = Number(activity.reservedSeatCount || 0) + Number(activity.confirmedSeatCount || 0);
      if (occupiedSeats >= Number(activity.seatLimit)) throw publicError("活动名额已满，不能发送新邀约", 409, "ACTIVITY_SEATS_FULL");

      const normalized = invitations.map((item, index) => {
        const kolTwitterId = text(item?.kolTwitterId, `第 ${index + 1} 位 KOL 的 Twitter ID`, 64, { required: true });
        const offerAmount = formatCents(decimalToCents(item?.offerAmount, `第 ${index + 1} 位 KOL 的邀约金额`));
        return {
          kolTwitterId,
          kol: {
            twitterId: kolTwitterId,
            username: text(item?.kolUsername, "KOL X 用户名", 128),
            displayName: text(item?.kolDisplayName, "KOL 显示名", 256),
          },
          offerAmount,
          snapshot: normalizeInvitationSnapshot(activity.invitationTemplate, item, activity),
        };
      });
      const twitterIds = normalized.map((item) => item.kolTwitterId);
      if (new Set(twitterIds).size !== twitterIds.length) throw publicError("同一批次不能重复邀请同一个 KOL", 400, "INVITATION_DUPLICATE_IN_BATCH");

      const minimumOffer = formatCents(decimalToCents(activity.invitationTemplate?.minimumOfferAmount || DEFAULT_MINIMUM_OFFER_AMOUNT, "活动最低邀约金额"));
      const minimumOfferCents = decimalToCents(minimumOffer, "活动最低邀约金额");
      normalized.forEach((item) => {
        if (decimalToCents(item.offerAmount, "邀约金额") < minimumOfferCents) {
          throw publicError(`邀约金额不能低于活动配置的 ${minimumOffer}`, 400, "OFFER_AMOUNT_BELOW_MINIMUM");
        }
      });

      const [existing, profiles] = await Promise.all([
        BusinessCollaborationInvitation.findAll({ where: { activityId, kolTwitterId: { [Op.in]: twitterIds } }, transaction, lock: transaction.LOCK.UPDATE }),
        XHuntKolCollaboration.findAll({ where: { twitterId: { [Op.in]: twitterIds } }, transaction }),
      ]);
      if (existing.length) {
        throw publicError("同一活动不能重复邀请同一个 KOL", 409, "INVITATION_ALREADY_EXISTS", {
          twitterIds: existing.map((item) => item.kolTwitterId),
        });
      }
      const profileByTwitterId = new Map(profiles.map((profile) => [profile.twitterId, profile]));
      const paused = normalized.filter((item) => profileByTwitterId.get(item.kolTwitterId)?.acceptingNewInvitations === false);
      if (paused.length) {
        throw publicError("部分 KOL 当前暂停接收新邀约", 409, "KOL_NOT_ACCEPTING_INVITATIONS", {
          twitterIds: paused.map((item) => item.kolTwitterId),
        });
      }

      const created = [];
      for (const item of normalized) {
        const profile = profileByTwitterId.get(item.kolTwitterId);
        const invitationSnapshot = { ...item.snapshot, kol: item.kol };
        const invitation = await BusinessCollaborationInvitation.create({
          activityId,
          kolTwitterId: item.kolTwitterId,
          kolAuthCenterUserId: profile?.authCenterUserId || null,
          inviterAccessId: access.id,
          createIdempotencyKey: idempotencyKey,
          invitationSnapshot,
          offerAmount: item.offerAmount,
          currency: activity.currency,
          status: "sent",
        }, { transaction });
        await audit({
          transaction,
          req,
          activityId,
          invitationId: invitation.id,
          action: "invitation_sent",
          actorType: "manager",
          metadata: { inviterAccessId: access.id, kolTwitterId: item.kolTwitterId, idempotencyKey },
        });
        created.push(invitation);
      }
      return created.map(serializeManagerInvitation);
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return sendError(res, error, "INVITATION_CREATE_FAILED");
  }
});

router.post("/invitations/:invitationId/accept", async (req, res) => {
  try {
    const identity = getTwitterIdentity(req);
    const idempotencyKey = getIdempotencyKey(req);
    const result = await pgInstance.transaction(async (transaction) => {
      const initial = await BusinessCollaborationInvitation.findByPk(req.params.invitationId, { transaction });
      if (!initial) throw publicError("邀约不存在", 404, "INVITATION_NOT_FOUND");
      const activity = await loadActivityForUpdate(initial.activityId, transaction);
      const invitation = await BusinessCollaborationInvitation.findByPk(initial.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (invitation.kolTwitterId !== identity.twitterId) throw publicError("这不是你的邀约", 403, "INVITATION_FORBIDDEN");
      if (invitation.status === "accepted" || invitation.status === "confirmed") {
        return { invitation, replay: true };
      }
      if (invitation.status !== "sent") throw publicError("该邀约当前不能接受", 409, "INVITATION_NOT_ACCEPTABLE");
      const recruitmentError = activityRecruitmentError(activity);
      if (recruitmentError) throw recruitmentError;
      const profile = await getKolCollaborationForIdentity(identity, transaction, { lock: true });
      if (!profile?.defaultPayoutAddress || !profile.payoutAddressVerifiedAt) {
        throw publicError("请先完成默认 EVM 收款地址验证后再接受邀约", 409, "PAYOUT_ADDRESS_REQUIRED");
      }
      const availableAmount = getAvailableAmountCents(activity);
      const offerAmount = decimalToCents(invitation.offerAmount, "邀约金额");
      if (availableAmount < offerAmount) throw publicError("活动奖金池余额不足，无法接受邀约", 409, "ACTIVITY_BUDGET_INSUFFICIENT");
      const usedSeats = Number(activity.reservedSeatCount || 0) + Number(activity.confirmedSeatCount || 0);
      if (usedSeats >= Number(activity.seatLimit)) throw publicError("活动名额已满，无法接受邀约", 409, "ACTIVITY_SEATS_FULL");
      const now = new Date();
      const deadlineHours = positiveInt(invitation.invitationSnapshot?.confirmationDeadlineHours, "项目方确认时限", {
        min: 1,
        max: 720,
        fallback: DEFAULT_CONFIRMATION_DEADLINE_HOURS,
      });
      const reservationExpiresAt = new Date(now.getTime() + deadlineHours * 60 * 60 * 1000);
      await invitation.update({
        kolAuthCenterUserId: identity.authCenterUserId,
        status: "accepted",
        acceptedAt: now,
        reservationExpiresAt,
        acceptedPayoutAddressSnapshot: profile.defaultPayoutAddress,
        acceptIdempotencyKey: idempotencyKey,
      }, { transaction });
      await activity.update({
        reservedAmount: formatCents(decimalToCents(activity.reservedAmount || "0", "金额", { allowZero: true }) + offerAmount),
        reservedSeatCount: Number(activity.reservedSeatCount || 0) + 1,
      }, { transaction });
      await BusinessCollaborationBudgetLedger.create({
        activityId: activity.id,
        invitationId: invitation.id,
        type: "reserve",
        amount: formatCents(offerAmount),
        currency: invitation.currency,
        idempotencyKey: `reserve:${invitation.id}`,
        metadata: { acceptedByAuthCenterUserId: identity.authCenterUserId, requestId: getRequestId(req), idempotencyKey },
      }, { transaction });
      await audit({
        transaction,
        req,
        activityId: activity.id,
        invitationId: invitation.id,
        action: "invitation_accepted",
        actorType: "kol",
        metadata: { reservationExpiresAt, idempotencyKey },
      });
      return { invitation, replay: false };
    });
    return res.json({ success: true, data: { invitation: serializeKolInvitation(result.invitation), replay: result.replay } });
  } catch (error) {
    return sendError(res, error, "INVITATION_ACCEPT_FAILED");
  }
});

router.post("/invitations/:invitationId/decline", async (req, res) => {
  try {
    const identity = getTwitterIdentity(req);
    const idempotencyKey = getIdempotencyKey(req);
    const reason = text(req.body?.reason, "拒绝原因", 1000);
    const invitation = await pgInstance.transaction(async (transaction) => {
      const item = await BusinessCollaborationInvitation.findByPk(req.params.invitationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw publicError("邀约不存在", 404, "INVITATION_NOT_FOUND");
      if (item.kolTwitterId !== identity.twitterId) throw publicError("这不是你的邀约", 403, "INVITATION_FORBIDDEN");
      if (item.status === "kol_declined") return item;
      if (item.status !== "sent") throw publicError("该邀约当前不能拒绝", 409, "INVITATION_NOT_DECLINABLE");
      await item.update({ status: "kol_declined", declineReason: reason });
      await audit({ transaction, req, activityId: item.activityId, invitationId: item.id, action: "invitation_declined_by_kol", actorType: "kol", metadata: { idempotencyKey } });
      return item;
    });
    return res.json({ success: true, data: { invitation: serializeKolInvitation(invitation) } });
  } catch (error) {
    return sendError(res, error, "INVITATION_DECLINE_FAILED");
  }
});

router.post("/invitations/:invitationId/confirm", async (req, res) => {
  try {
    const idempotencyKey = getIdempotencyKey(req);
    const result = await pgInstance.transaction(async (transaction) => {
      const initial = await BusinessCollaborationInvitation.findByPk(req.params.invitationId, { transaction });
      if (!initial) throw publicError("邀约不存在", 404, "INVITATION_NOT_FOUND");
      const access = await loadActiveAccess(initial.activityId, req.authCenter.user.id, transaction, { lock: true });
      const activity = await loadActivityForUpdate(initial.activityId, transaction);
      if (activity.status === "archived") throw publicError("已归档活动不能确认新的合作", 409, "ACTIVITY_ARCHIVED");
      const invitation = await BusinessCollaborationInvitation.findByPk(initial.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (invitation.status === "confirmed") {
        const collaboration = await BusinessCollaboration.findOne({ where: { invitationId: invitation.id }, transaction });
        return { invitation, collaboration, replay: true, reservationExpired: false };
      }
      if (invitation.status !== "accepted") throw publicError("只有已接受的邀约可以确认合作", 409, "INVITATION_NOT_CONFIRMABLE");
      const now = new Date();
      if (!invitation.reservationExpiresAt || new Date(invitation.reservationExpiresAt).getTime() <= now.getTime()) {
        const offerAmount = decimalToCents(invitation.offerAmount, "邀约金额");
        await invitation.update({ status: "reservation_expired", declineReason: "project_confirmation_timeout" }, { transaction });
        await activity.update({
          reservedAmount: formatCents(decimalToCents(activity.reservedAmount || "0", "金额", { allowZero: true }) - offerAmount),
          reservedSeatCount: Math.max(0, Number(activity.reservedSeatCount || 0) - 1),
        }, { transaction });
        await BusinessCollaborationBudgetLedger.create({
          activityId: activity.id,
          invitationId: invitation.id,
          type: "release",
          amount: formatCents(offerAmount),
          currency: invitation.currency,
          idempotencyKey: `release:expired:${invitation.id}`,
          metadata: { reason: "project_confirmation_timeout", requestId: getRequestId(req), idempotencyKey },
        }, { transaction });
        await audit({ transaction, req, activityId: activity.id, invitationId: invitation.id, action: "reservation_expired", actorType: "manager", metadata: { idempotencyKey } });
        return { invitation, collaboration: null, replay: false, reservationExpired: true };
      }
      if (!invitation.acceptedPayoutAddressSnapshot) throw publicError("邀约缺少有效的收款地址快照，无法确认", 409, "PAYOUT_ADDRESS_SNAPSHOT_MISSING");
      const offerAmount = decimalToCents(invitation.offerAmount, "邀约金额");
      const collaboration = await BusinessCollaboration.create({
        invitationId: invitation.id,
        activityId: activity.id,
        kolTwitterId: invitation.kolTwitterId,
        kolAuthCenterUserId: invitation.kolAuthCenterUserId,
        confirmedByAccessId: access.id,
        lockedAmount: formatCents(offerAmount),
        currency: invitation.currency,
        payoutAddressSnapshot: invitation.acceptedPayoutAddressSnapshot,
        status: "confirmed",
        confirmedAt: now,
      }, { transaction });
      await invitation.update({ status: "confirmed", confirmIdempotencyKey: idempotencyKey }, { transaction });
      await activity.update({
        reservedAmount: formatCents(decimalToCents(activity.reservedAmount || "0", "金额", { allowZero: true }) - offerAmount),
        reservedSeatCount: Math.max(0, Number(activity.reservedSeatCount || 0) - 1),
        lockedAmount: formatCents(decimalToCents(activity.lockedAmount || "0", "金额", { allowZero: true }) + offerAmount),
        confirmedSeatCount: Number(activity.confirmedSeatCount || 0) + 1,
      }, { transaction });
      await BusinessCollaborationBudgetLedger.create({
        activityId: activity.id,
        invitationId: invitation.id,
        collaborationId: collaboration.id,
        type: "lock",
        amount: formatCents(offerAmount),
        currency: invitation.currency,
        idempotencyKey: `lock:${invitation.id}`,
        metadata: { confirmedByAccessId: access.id, requestId: getRequestId(req), idempotencyKey },
      }, { transaction });
      await audit({ transaction, req, activityId: activity.id, invitationId: invitation.id, collaborationId: collaboration.id, action: "collaboration_confirmed", actorType: "manager", metadata: { confirmedByAccessId: access.id, idempotencyKey } });
      return { invitation, collaboration, replay: false, reservationExpired: false };
    });
    if (result.reservationExpired) {
      return res.status(409).json({ success: false, error: "INVITATION_RESERVATION_EXPIRED", message: "项目方确认时限已过，预算预留已释放。" });
    }
    return res.json({
      success: true,
      data: { invitation: serializeManagerInvitation({ ...result.invitation.toJSON(), collaboration: result.collaboration }), replay: result.replay },
    });
  } catch (error) {
    return sendError(res, error, "INVITATION_CONFIRM_FAILED");
  }
});

router.post("/invitations/:invitationId/decline-by-project", async (req, res) => {
  try {
    const idempotencyKey = getIdempotencyKey(req);
    const reason = text(req.body?.reason, "不合作原因", 1000, { required: true });
    const invitation = await pgInstance.transaction(async (transaction) => {
      const initial = await BusinessCollaborationInvitation.findByPk(req.params.invitationId, { transaction });
      if (!initial) throw publicError("邀约不存在", 404, "INVITATION_NOT_FOUND");
      const access = await loadActiveAccess(initial.activityId, req.authCenter.user.id, transaction, { lock: true });
      const activity = await loadActivityForUpdate(initial.activityId, transaction);
      const item = await BusinessCollaborationInvitation.findByPk(initial.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (item.status === "project_declined") return item;
      if (!["sent", "accepted"].includes(item.status)) throw publicError("该邀约当前不能取消", 409, "INVITATION_NOT_PROJECT_DECLINABLE");
      if (item.status === "accepted") {
        const amount = decimalToCents(item.offerAmount, "邀约金额");
        await activity.update({
          reservedAmount: formatCents(decimalToCents(activity.reservedAmount || "0", "金额", { allowZero: true }) - amount),
          reservedSeatCount: Math.max(0, Number(activity.reservedSeatCount || 0) - 1),
        }, { transaction });
        await BusinessCollaborationBudgetLedger.create({
          activityId: activity.id,
          invitationId: item.id,
          type: "release",
          amount: formatCents(amount),
          currency: item.currency,
          idempotencyKey: `release:project_declined:${item.id}`,
          metadata: { reason, declinedByAccessId: access.id, requestId: getRequestId(req), idempotencyKey },
        }, { transaction });
      }
      await item.update({ status: "project_declined", declineReason: reason }, { transaction });
      await audit({ transaction, req, activityId: activity.id, invitationId: item.id, action: "invitation_declined_by_project", actorType: "manager", metadata: { reason, declinedByAccessId: access.id, idempotencyKey } });
      return item;
    });
    return res.json({ success: true, data: { invitation: serializeManagerInvitation(invitation) } });
  } catch (error) {
    return sendError(res, error, "INVITATION_PROJECT_DECLINE_FAILED");
  }
});

module.exports = router;
