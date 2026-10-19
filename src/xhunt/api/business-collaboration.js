const crypto = require("crypto");
const express = require("express");
const { Op, QueryTypes } = require("sequelize");
const {
  pgInstance,
  BusinessCollaborationActivity,
  BusinessCollaborationActivityAccess,
  BusinessCollaborationInvitation,
  BusinessCollaboration,
  BusinessCollaborationBudgetLedger,
  BusinessCollaborationAuditLog,
  BusinessCollaborationReviewRound,
  BusinessCollaborationDelivery,
  XHuntKolCollaboration,
  XAccount,
} = require("../../models/postgres-start");
const {
  getPostgresReadOnlyInstance,
  isPostgresReadOnlyConfigured,
} = require("../../infra/k8s/postgres-readonly");
const { authenticateAuthCenterToken } = require("../auth-center/middleware/auth");
const { PROVIDERS } = require("../auth-center/services/auth");
const { extractEvm40Address } = require("../auth-center/services/utils");
const { decimalToCents, formatCents, sumMoney } = require("../business-collaboration/money");
const { normalizeGoogleDocUrl, fetchGoogleDocText } = require("../business-collaboration/google-doc");
const { runAiReviewForRound } = require("../business-collaboration/ai-review");
const { STRATEGY_CACHE_PREFIX } = require("./echohunt-kol-match/constants");

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
const INVITATION_LIMIT_MULTIPLIER = 2;
const BUSINESS_COLLABORATION_EN_MESSAGES = Object.freeze({
  ACTIVITY_ACCESS_FORBIDDEN: "You do not have permission to manage this collaboration activity.",
  ACTIVITY_ARCHIVED: "Archived activities cannot confirm new collaborations.",
  ACTIVITY_BUDGET_INSUFFICIENT: "The activity budget is insufficient to accept this invitation.",
  ACTIVITY_DETAIL_FAILED: "Unable to load the activity details. Please try again.",
  ACTIVITY_ENDED: "This activity has ended and cannot send or accept new invitations.",
  ACTIVITY_LIST_FAILED: "Unable to load activities. Please try again.",
  ACTIVITY_NOT_FOUND: "The collaboration activity was not found.",
  ACTIVITY_NOT_OPEN: "This activity is not open for new invitations.",
  ACTIVITY_NOT_STARTED: "This activity has not started yet.",
  ACTIVITY_SEATS_FULL: "This activity has no remaining collaboration seats.",
  BUSINESS_COLLABORATION_ERROR: "Unable to process the collaboration request. Please try again.",
  BUSINESS_COLLABORATION_ME_FAILED: "Unable to load your collaboration data. Please try again.",
  COLLABORATION_FORBIDDEN: "You do not have permission to access this collaboration.",
  COLLABORATION_NOT_FOUND: "The collaboration was not found.",
  COLLABORATION_NOT_PUBLISHABLE: "A published link can be submitted only after human review approval.",
  COLLABORATION_NOT_SUBMITTABLE: "A draft cannot be submitted in the current collaboration state.",
  COLLABORATION_REVIEWS_FAILED: "Unable to load collaboration review records. Please try again.",
  DRAFT_SUBMIT_FAILED: "Unable to submit the draft. Please try again.",
  GOOGLE_DOC_NOT_ACCESSIBLE: "The Google Doc is inaccessible. Set it to allow anyone with the link to view it, then try again.",
  IDEMPOTENCY_KEY_REQUIRED: "A valid Idempotency-Key is required for all write operations.",
  INVALID_EVM_ADDRESS: "A valid EVM payout address is required.",
  INVALID_INPUT: "One or more request parameters are invalid.",
  INVALID_INVITATION_BATCH: "Invite between 1 and 100 KOLs per request.",
  INVALID_PUBLISHED_URL: "Provide a valid X (Twitter) post URL.",
  INVITATION_ACCEPT_FAILED: "Unable to accept the invitation. Please try again.",
  INVITATION_ALREADY_EXISTS: "The same KOL has already been invited to this activity.",
  INVITATION_CONFIRM_FAILED: "Unable to confirm the collaboration. Please try again.",
  INVITATION_CREATE_FAILED: "Unable to send the invitation. Please try again.",
  INVITATION_DECLINE_FAILED: "Unable to decline the invitation. Please try again.",
  INVITATION_DUPLICATE_IN_BATCH: "The same KOL cannot be invited more than once in a single request.",
  INVITATION_FORBIDDEN: "This invitation does not belong to your X account.",
  INVITATION_LIMIT_REACHED: "The invitation limit for this activity has been reached.",
  INVITATION_NOT_ACCEPTABLE: "This invitation cannot be accepted in its current state.",
  INVITATION_NOT_CONFIRMABLE: "Only accepted invitations can be confirmed.",
  INVITATION_NOT_DECLINABLE: "This invitation cannot be declined in its current state.",
  INVITATION_NOT_FOUND: "The invitation was not found.",
  INVITATION_NOT_PROJECT_DECLINABLE: "This invitation cannot be cancelled in its current state.",
  INVITATION_PROJECT_DECLINE_FAILED: "Unable to cancel the invitation. Please try again.",
  INVITATION_RESERVATION_EXPIRED: "The project confirmation deadline has passed and the reserved budget has been released.",
  KOL_IDENTITY_CONFLICT: "The current X identity conflicts with an existing collaboration profile. Contact support for help.",
  KOL_MATCH_CONTEXT_EXPIRED: "This KOL Match session has expired. Analyze the project account again before inviting KOLs.",
  KOL_MATCH_CONTEXT_INVALID: "This KOL Match session is invalid. Analyze the project account again before inviting KOLs.",
  KOL_MATCH_CONTEXT_REQUIRED: "Start invitations from the AI KOL Match results page.",
  KOL_MATCH_CONTEXT_UNAVAILABLE: "The KOL Match context is temporarily unavailable. Please try again.",
  KOL_MATCH_PROJECT_MISMATCH: "Invitations must use an activity for the same project account as the KOL Match result.",
  KOL_NOT_ACCEPTING_INVITATIONS: "Some KOLs are not accepting new invitations.",
  OFFER_AMOUNT_BELOW_MINIMUM: "The offer amount is below this activity's minimum offer.",
  OFFER_AMOUNT_EXCEEDS_ACTIVITY_BUDGET: "An individual KOL offer cannot exceed the activity's total budget.",
  PAYOUT_ADDRESS_CHALLENGE_EXPIRED: "The payout address verification challenge has expired. Start a new verification.",
  PAYOUT_ADDRESS_CHALLENGE_FAILED: "Unable to start payout address verification. Please try again.",
  PAYOUT_ADDRESS_CHALLENGE_STALE: "The payout address has changed. Start a new verification.",
  PAYOUT_ADDRESS_CHALLENGE_UNAVAILABLE: "Payout address verification is temporarily unavailable. Please try again.",
  PAYOUT_ADDRESS_GET_FAILED: "Unable to load the payout address. Please try again.",
  PAYOUT_ADDRESS_REQUIRED: "Verify a default EVM payout address before accepting this invitation.",
  PAYOUT_ADDRESS_SIGNATURE_INVALID: "Payout address signature verification failed.",
  PAYOUT_ADDRESS_SIGNATURE_MISMATCH: "The payout address signature does not match the address.",
  PAYOUT_ADDRESS_SNAPSHOT_MISSING: "This invitation has no valid payout address snapshot and cannot be confirmed.",
  PAYOUT_ADDRESS_VERIFY_FAILED: "Unable to verify the payout address. Please try again.",
  PUBLISHED_LINK_SUBMIT_FAILED: "Unable to submit the published link. Please try again.",
  REVIEW_ROUND_DECISION_FAILED: "Unable to save the review decision. Please try again.",
  REVIEW_ROUND_NOT_ASSIGNED: "This activity is reviewed by EchoHunt, so the project cannot process this review round.",
  REVIEW_ROUND_NOT_DECIDABLE: "This draft cannot be reviewed manually until it passes the AI review.",
  REVIEW_ROUND_NOT_FOUND: "The review round was not found.",
  TWITTER_ID_REQUIRED: "Sign in to EchoHunt with X first.",
});

router.use(express.json({ limit: "1mb" }));
router.use(authenticateAuthCenterToken());

function publicError(message, status = 400, code = message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.publicMessage = message;
  error.details = details;
  return error;
}

function getRequestLanguage(req) {
  const raw = String(
    req?.query?.lang ||
      req?.query?.["x-language"] ||
      req?.headers?.["x-echohunt-language"] ||
      req?.headers?.["accept-language"] ||
      ""
  ).trim().toLowerCase();
  const primary = raw.split(",")[0].split(";")[0].trim();
  return primary === "en" || primary.startsWith("en-") ? "en" : "zh-CN";
}

function localizedPublicError(publicMessages, status, code, details) {
  const error = publicError(publicMessages["zh-CN"] || publicMessages.en || code, status, code, details);
  error.publicMessages = publicMessages;
  return error;
}

function publicErrorCode(error, fallback) {
  if (error.publicMessages || BUSINESS_COLLABORATION_EN_MESSAGES[error.code]) return error.code;
  return fallback;
}

function localizedErrorMessage(error, code, req) {
  const language = getRequestLanguage(req);
  if (error.publicMessages?.[language]) return error.publicMessages[language];
  if (language === "en") {
    return BUSINESS_COLLABORATION_EN_MESSAGES[code] || "Unable to process the request. Please try again.";
  }
  if (error.publicMessage) return error.publicMessage;
  return "操作失败，请稍后重试。";
}

function sendError(res, error, fallback = "BUSINESS_COLLABORATION_ERROR") {
  const code = publicErrorCode(error, fallback);
  return res.status(error.status || 500).json({
    success: false,
    error: code,
    message: localizedErrorMessage(error, code, res.req),
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

function getOptionalTwitterIdentity(req) {
  const identity = (req.authCenter?.identities || []).find((item) => item.provider === PROVIDERS.TWITTER);
  const twitterId = String(identity?.providerSubject || "").trim();
  if (!twitterId) return null;
  return {
    twitterId,
    username: identity.username || null,
    displayName: identity.displayName || identity.username || null,
    authCenterUserId: req.authCenter.user.id,
  };
}

function getTwitterIdentity(req) {
  const identity = getOptionalTwitterIdentity(req);
  if (!identity) throw publicError("请先使用 X 登录 EchoHunt。", 400, "TWITTER_ID_REQUIRED");
  return identity;
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

function emptyManagerActivityStats() {
  return { invited: 0, confirmed: 0 };
}

async function loadManagerActivityStats(activities) {
  const ids = activities.map((activity) => String(activity.id)).filter(Boolean);
  if (!ids.length) return new Map();
  const invitations = await BusinessCollaborationInvitation.findAll({
    where: { activityId: { [Op.in]: ids } },
    attributes: ["activityId", "status"],
  });
  const statsByActivity = new Map(ids.map((id) => [id, emptyManagerActivityStats()]));
  invitations.forEach((invitation) => {
    const stats = statsByActivity.get(String(invitation.activityId));
    if (!stats) return;
    stats.invited += 1;
    if (invitation.status === "confirmed") stats.confirmed += 1;
  });
  return statsByActivity;
}

async function loadProjectAvatarFallbacks(activities) {
  const missing = activities.filter((activity) => activity && !activity.projectTwitterAvatarUrl);
  if (!missing.length) return new Map();
  const twitterIds = [...new Set(missing.map((activity) => String(activity.projectTwitterId || "").trim()).filter(Boolean))];
  const handles = [...new Set(missing.map((activity) => String(activity.projectTwitterHandle || "").trim()).filter(Boolean))];
  if (!twitterIds.length && !handles.length) return new Map();
  const accounts = await XAccount.findAll({
    where: {
      [Op.or]: [
        ...(twitterIds.length ? [{ xId: { [Op.in]: twitterIds } }] : []),
        ...(handles.length ? [{ handle: { [Op.in]: handles } }] : []),
      ],
    },
    attributes: ["xId", "handle", "avatar"],
  });
  const byTwitterId = new Map(accounts.filter((account) => account.xId && account.avatar).map((account) => [String(account.xId), account.avatar]));
  const byHandle = new Map(accounts.filter((account) => account.handle && account.avatar).map((account) => [String(account.handle).toLowerCase(), account.avatar]));
  return new Map(missing.map((activity) => [
    String(activity.id),
    byTwitterId.get(String(activity.projectTwitterId)) || byHandle.get(String(activity.projectTwitterHandle || "").toLowerCase()) || null,
  ]).filter(([, avatar]) => Boolean(avatar)));
}

function serializeActivityForManager(activity, access, stats = null, fallbackAvatarUrl = null) {
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
      avatarUrl: item.projectTwitterAvatarUrl || fallbackAvatarUrl || null,
      bannerUrl: item.projectTwitterBannerUrl || null,
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
    stats: stats || emptyManagerActivityStats(),
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

function getSnapshotKolAvatarUrl(invitation) {
  const item = invitation?.toJSON ? invitation.toJSON() : invitation;
  const kol = item?.invitationSnapshot?.kol;
  return text(kol?.avatarUrl || kol?.avatar, "KOL 头像 URL", 2048);
}

async function loadTwitterUserAvatarsByTwitterIds(twitterIds) {
  const ids = [...new Set((twitterIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length || !isPostgresReadOnlyConfigured()) return new Map();
  try {
    const db = getPostgresReadOnlyInstance();
    // 先通过 kol_marketing_profile 拿到原始类型的 twitter_user_id，再用 u.id = requested.twitter_user_id
    // 走 dev.twitter_user 主键索引，避免在 u.id 上做 ::text 导致大表全表扫描。
    const rows = await db.query(
      `
        WITH requested_profiles AS MATERIALIZED (
          SELECT p.twitter_user_id
          FROM dev.kol_marketing_profile p
          WHERE p.twitter_user_id::text = ANY($twitterIds::text[])
        )
        SELECT
          u.id::text AS "twitterId",
          COALESCE(
            NULLIF(u.profile ->> 'profile_image_url', ''),
            NULLIF(u.profile ->> 'profile_image_url_https', ''),
            NULLIF(u.profile ->> 'profileImageUrl', ''),
            NULLIF(u.profile ->> 'avatar', '')
          ) AS "avatarUrl"
        FROM requested_profiles requested
        JOIN dev.twitter_user u ON u.id = requested.twitter_user_id
      `,
      {
        bind: { twitterIds: ids },
        type: QueryTypes.SELECT,
      }
    );
    return new Map(
      rows
        .filter((row) => row?.twitterId && row?.avatarUrl)
        .map((row) => [String(row.twitterId), String(row.avatarUrl).trim()])
    );
  } catch (error) {
    console.warn("[business-collaboration] loadTwitterUserAvatarsByTwitterIds failed:", error.message);
    return new Map();
  }
}

async function loadKolAvatarFallbacks(invitations) {
  const missingInvitations = (invitations || []).filter((item) => !getSnapshotKolAvatarUrl(item));
  const twitterIds = [...new Set(missingInvitations.map((item) => String(item.kolTwitterId || "").trim()).filter(Boolean))];
  if (!twitterIds.length) return new Map();
  const avatarMap = await loadTwitterUserAvatarsByTwitterIds(twitterIds);
  const remainingIds = twitterIds.filter((id) => !avatarMap.has(id));
  if (remainingIds.length) {
    const accounts = await XAccount.findAll({
      where: { xId: { [Op.in]: remainingIds } },
      attributes: ["xId", "avatar"],
    });
    accounts.forEach((account) => {
      if (account.xId && account.avatar) {
        avatarMap.set(String(account.xId), account.avatar);
      }
    });
  }
  const backfillInvitations = missingInvitations.filter((item) => {
    const id = String(item.kolTwitterId || "").trim();
    return id && avatarMap.has(id);
  });
  if (backfillInvitations.length) {
    setImmediate(() => {
      Promise.allSettled(
        backfillInvitations.map((invitation) => {
          const id = String(invitation.kolTwitterId || "").trim();
          const avatarUrl = avatarMap.get(id);
          if (!invitation.id || !avatarUrl) return Promise.resolve();
          const currentSnapshot = invitation.invitationSnapshot && typeof invitation.invitationSnapshot === "object"
            ? invitation.invitationSnapshot
            : {};
          const currentKol = currentSnapshot.kol && typeof currentSnapshot.kol === "object"
            ? currentSnapshot.kol
            : {};
          if (currentKol.avatarUrl) return Promise.resolve();
          return BusinessCollaborationInvitation.update(
            {
              invitationSnapshot: {
                ...currentSnapshot,
                kol: {
                  ...currentKol,
                  avatarUrl,
                },
              },
            },
            { where: { id: invitation.id } }
          );
        })
      ).catch(() => {});
    });
  }
  return avatarMap;
}

function serializeManagerInvitation(invitation, kolAvatarMap = null) {
  const item = invitation.toJSON ? invitation.toJSON() : invitation;
  const collaboration = item.collaboration || null;
  const delivery = collaboration?.delivery;
  const snapshotAvatarUrl = getSnapshotKolAvatarUrl(item);
  return {
    id: item.id,
    activityId: item.activityId,
    kol: {
      twitterId: item.kolTwitterId,
      authCenterUserId: item.kolAuthCenterUserId || null,
      username: item.invitationSnapshot?.kol?.username || null,
      displayName: item.invitationSnapshot?.kol?.displayName || null,
      avatarUrl: snapshotAvatarUrl || kolAvatarMap?.get(String(item.kolTwitterId)) || null,
    },
    invitationSnapshot: item.invitationSnapshot || {},
    offerAmount: String(item.offerAmount),
    currency: item.currency,
    status: item.status,
    acceptedAt: item.acceptedAt || null,
    reservationExpiresAt: item.reservationExpiresAt || null,
    declineReason: item.declineReason || null,
    collaboration: collaboration
      ? {
        id: collaboration.id,
        status: collaboration.status,
        confirmedAt: collaboration.confirmedAt,
        publishedUrl: delivery?.publishedUrl || null,
        delivery: delivery
          ? { publishedUrl: delivery.publishedUrl || null }
          : null,
      }
      : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function serializeKolInvitation(invitation, fallbackAvatarUrl = null) {
  const item = invitation.toJSON ? invitation.toJSON() : invitation;
  const snapshot = item.invitationSnapshot || {};
  const collaboration = item.collaboration;
  const delivery = collaboration?.delivery;
  return {
    id: item.id,
    activity: {
      id: item.activityId,
      name: snapshot.activity?.name || item.activity?.name || null,
      projectTwitterHandle: snapshot.activity?.projectTwitterHandle || item.activity?.projectTwitterHandle || null,
      projectDisplayName: snapshot.activity?.projectDisplayName || item.activity?.projectDisplayName || null,
      endAt: snapshot.activity?.endAt || item.activity?.endAt || null,
      projectTwitterAvatarUrl: item.activity?.projectTwitterAvatarUrl || fallbackAvatarUrl || null,
    },
    status: item.status,
    // 项目方给该 KOL 的拟定报价，仅作邀约条款展示，不是可领取金额
    offerAmount: item.offerAmount === null || item.offerAmount === undefined ? null : String(item.offerAmount),
    currency: item.currency || null,
    invitation: {
      title: snapshot.title || null,
      message: snapshot.message || null,
      contentFormat: snapshot.contentFormat || null,
      contentCount: snapshot.contentCount || null,
      language: snapshot.language || null,
    },
    // Internal offer/reservation amounts must never be exposed as a grant or claimable amount.
    // Brief 和必须表达事项是邀约条款，KOL 需要在接受前看到，因此全状态返回。
    brief: snapshot.brief || null,
    requiredPoints: snapshot.requiredPoints || [],
    acceptedAt: item.acceptedAt || null,
    reservationExpiresAt: item.reservationExpiresAt || null,
    collaboration: collaboration
      ? {
        id: collaboration.id,
        status: collaboration.status,
        confirmedAt: collaboration.confirmedAt,
        publishedUrl: delivery?.publishedUrl || null,
        delivery: delivery
          ? { publishedUrl: delivery.publishedUrl || null }
          : null,
      }
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

async function assertKolMatchProjectContext(req, activity, strategyId) {
  const normalizedStrategyId = String(strategyId || "").trim();
  // 方案 A：拥有活动管理权限的调用方在直接邀约场景下可省略 kolMatchStrategyId；
  // 若传入了 strategyId，则继续校验其有效性及与活动项目 Twitter ID 的绑定关系。
  if (!normalizedStrategyId) return;
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(normalizedStrategyId)) {
    throw publicError("请从 AI 精准匹配结果页发起邀约", 400, "KOL_MATCH_CONTEXT_REQUIRED");
  }
  if (!req.redisClient || typeof req.redisClient.get !== "function") {
    throw publicError("KOL Match 上下文暂不可用，请稍后重试", 503, "KOL_MATCH_CONTEXT_UNAVAILABLE");
  }

  const cacheKey = `${STRATEGY_CACHE_PREFIX}:${req.authCenter.user.id}:${normalizedStrategyId}`;
  const cached = await req.redisClient.get(cacheKey).catch(() => null);
  if (!cached) {
    throw publicError("本次 KOL 匹配已失效，请重新分析项目账号后再邀约", 409, "KOL_MATCH_CONTEXT_EXPIRED");
  }

  let strategy;
  try {
    strategy = JSON.parse(cached);
  } catch {
    throw publicError("本次 KOL 匹配上下文无效，请重新分析项目账号后再邀约", 409, "KOL_MATCH_CONTEXT_INVALID");
  }
  // Do not trust xProfile here: it may contain UI fallback data. This value is
  // written only after the KOL Match service resolves the X account itself.
  const matchedProjectTwitterId = String(strategy?.verifiedProjectTwitterId || "").trim();
  const activityProjectTwitterId = String(activity.projectTwitterId || "").trim();
  if (!matchedProjectTwitterId || !activityProjectTwitterId || matchedProjectTwitterId !== activityProjectTwitterId) {
    throw publicError("只能使用与当前 KOL 匹配项目账号一致的活动发起邀约", 403, "KOL_MATCH_PROJECT_MISMATCH");
  }
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
    const availableAccesses = accesses.filter((access) => access.activity && recruitmentState(access.activity) === "open");
    const avatarFallbacks = await loadProjectAvatarFallbacks(availableAccesses.map((access) => access.activity));
    const data = availableAccesses.map((access) => serializeActivityForManager(access.activity, access, null, avatarFallbacks.get(String(access.activity.id)) || null));
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, "ACTIVITY_LIST_FAILED");
  }
});

router.get("/me", async (req, res) => {
  try {
    const identity = getOptionalTwitterIdentity(req);
    const [accesses, invitations] = await Promise.all([
      BusinessCollaborationActivityAccess.findAll({
        where: { authCenterUserId: req.authCenter.user.id, status: "active", role: { [Op.in]: [...ACCESS_ROLES] } },
        include: [{ model: BusinessCollaborationActivity, as: "activity" }],
        order: [[{ model: BusinessCollaborationActivity, as: "activity" }, "updatedAt", "DESC"]],
      }),
      identity ? BusinessCollaborationInvitation.findAll({
        where: { kolTwitterId: identity.twitterId },
        include: [
          { model: BusinessCollaborationActivity, as: "activity" },
          {
            model: BusinessCollaboration,
            as: "collaboration",
            include: [{ model: BusinessCollaborationDelivery, as: "delivery" }],
          },
        ],
        order: [["updatedAt", "DESC"]],
      }) : Promise.resolve([]),
    ]);
    const managedActivityRows = accesses.filter((access) => access.activity);
    const [managerStatsByActivity, avatarFallbacks, invitationAvatarFallbacks] = await Promise.all([
      loadManagerActivityStats(managedActivityRows.map((access) => access.activity)),
      loadProjectAvatarFallbacks(managedActivityRows.map((access) => access.activity)),
      loadProjectAvatarFallbacks(invitations.map((invitation) => invitation.activity).filter(Boolean)),
    ]);
    res.set("Cache-Control", "no-store");
    return res.json({
      success: true,
      data: {
        managedActivities: managedActivityRows.map((access) => serializeActivityForManager(access.activity, access, managerStatsByActivity.get(String(access.activity.id)), avatarFallbacks.get(String(access.activity.id)) || null)),
        kolTasks: invitations.map((invitation) => serializeKolInvitation(invitation, invitationAvatarFallbacks.get(String(invitation.activityId)) || null)),
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
      include: [{
        model: BusinessCollaboration,
        as: "collaboration",
        include: [{ model: BusinessCollaborationDelivery, as: "delivery" }],
      }],
      order: [["updatedAt", "DESC"]],
    });
    const [projectAvatarFallbacks, kolAvatarMap] = await Promise.all([
      loadProjectAvatarFallbacks([activity]),
      loadKolAvatarFallbacks(invitations),
    ]);
    res.set("Cache-Control", "no-store");
    return res.json({
      success: true,
      data: {
        ...serializeActivityForManager(activity, access, null, projectAvatarFallbacks.get(String(activity.id)) || null),
        invitations: invitations.map((invitation) => serializeManagerInvitation(invitation, kolAvatarMap)),
      },
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
    const kolMatchStrategyId = req.body?.kolMatchStrategyId;
    const invitations = req.body?.invitations;
    if (!Array.isArray(invitations) || !invitations.length || invitations.length > 100) {
      throw publicError("邀约对象必须为 1-100 人", 400, "INVALID_INVITATION_BATCH");
    }
    const data = await pgInstance.transaction(async (transaction) => {
      const access = await loadActiveAccess(activityId, req.authCenter.user.id, transaction, { lock: true });
      const activity = await loadActivityForUpdate(activityId, transaction);
      await assertKolMatchProjectContext(req, activity, kolMatchStrategyId);
      const replayed = await BusinessCollaborationInvitation.findAll({
        where: { activityId, inviterAccessId: access.id, createIdempotencyKey: idempotencyKey },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (replayed.length) return replayed.map((invitation) => serializeManagerInvitation(invitation));
      const recruitmentError = activityRecruitmentError(activity);
      if (recruitmentError) throw recruitmentError;
      // The activity row is locked above, so concurrent invitation requests for this
      // activity are serialized before this count and the following creates.
      const invitationLimit = Number(activity.seatLimit) * INVITATION_LIMIT_MULTIPLIER;
      const invitedCount = await BusinessCollaborationInvitation.count({ where: { activityId }, transaction });
      if (invitedCount + invitations.length > invitationLimit) {
        throw localizedPublicError(
          {
            "zh-CN": `本活动最多可发送 ${invitationLimit} 份邀约，已发送 ${invitedCount} 份，本次请求 ${invitations.length} 份。`,
            en: `This activity can send at most ${invitationLimit} invitations. ${invitedCount} have already been sent; this request contains ${invitations.length}.`,
          },
          409,
          "INVITATION_LIMIT_REACHED",
          {
            invitationLimit,
            invitedCount,
            requestedCount: invitations.length,
            remainingCount: Math.max(0, invitationLimit - invitedCount),
          }
        );
      }
      const occupiedSeats = Number(activity.reservedSeatCount || 0) + Number(activity.confirmedSeatCount || 0);
      if (occupiedSeats >= Number(activity.seatLimit)) throw publicError("活动名额已满，不能发送新邀约", 409, "ACTIVITY_SEATS_FULL");

      const normalized = invitations.map((item, index) => {
        const kolTwitterId = text(item?.kolTwitterId, `第 ${index + 1} 位 KOL 的 Twitter ID`, 64, { required: true });
        const offerAmount = formatCents(decimalToCents(item?.offerAmount, `第 ${index + 1} 位 KOL 的邀约金额`));
        const avatarUrl = text(
          item?.kolAvatarUrl ?? item?.avatarUrl ?? item?.kol?.avatarUrl ?? item?.kol?.avatar,
          "KOL 头像 URL",
          2048
        );
        return {
          kolTwitterId,
          kol: {
            twitterId: kolTwitterId,
            username: text(item?.kolUsername, "KOL X 用户名", 128),
            displayName: text(item?.kolDisplayName, "KOL 显示名", 256),
            avatarUrl: avatarUrl || null,
          },
          offerAmount,
          snapshot: normalizeInvitationSnapshot(activity.invitationTemplate, item, activity),
        };
      });
      const twitterIds = normalized.map((item) => item.kolTwitterId);
      if (new Set(twitterIds).size !== twitterIds.length) throw publicError("同一批次不能重复邀请同一个 KOL", 400, "INVITATION_DUPLICATE_IN_BATCH");

      const minimumOffer = formatCents(decimalToCents(activity.invitationTemplate?.minimumOfferAmount || DEFAULT_MINIMUM_OFFER_AMOUNT, "活动最低邀约金额"));
      const minimumOfferCents = decimalToCents(minimumOffer, "活动最低邀约金额");
      const fundingPoolAmount = formatCents(decimalToCents(activity.fundingPoolAmount, "活动总预算"));
      const fundingPoolAmountCents = decimalToCents(fundingPoolAmount, "活动总预算");
      normalized.forEach((item) => {
        if (decimalToCents(item.offerAmount, "邀约金额") > fundingPoolAmountCents) {
          throw localizedPublicError(
            {
              "zh-CN": `第 ${item.kolTwitterId} 位 KOL 的邀约金额不能超过活动总预算 ${fundingPoolAmount}`,
              en: `An individual KOL offer cannot exceed the activity's total budget of ${fundingPoolAmount}.`,
            },
            400,
            "OFFER_AMOUNT_EXCEEDS_ACTIVITY_BUDGET",
            { kolTwitterId: item.kolTwitterId, offerAmount: item.offerAmount, fundingPoolAmount }
          );
        }
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
      const missingAvatarTwitterIds = normalized
        .filter((item) => !item.kol.avatarUrl)
        .map((item) => item.kolTwitterId);
      const fallbackAvatarsByTwitterId = missingAvatarTwitterIds.length
        ? await loadTwitterUserAvatarsByTwitterIds(missingAvatarTwitterIds)
        : new Map();

      const created = [];
      for (const item of normalized) {
        const profile = profileByTwitterId.get(item.kolTwitterId);
        const kolSnapshot = {
          ...item.kol,
          avatarUrl: item.kol.avatarUrl || fallbackAvatarsByTwitterId.get(item.kolTwitterId) || null,
        };
        const invitationSnapshot = { ...item.snapshot, kol: kolSnapshot };
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
      return created.map((invitation) => serializeManagerInvitation(invitation));
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
      await item.update(
        { status: "kol_declined", declineReason: reason },
        { transaction }
      );
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
      return sendError(
        res,
        publicError("项目方确认时限已过，预算预留已释放。", 409, "INVITATION_RESERVATION_EXPIRED"),
        "INVITATION_CONFIRM_FAILED"
      );
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

const DRAFT_SUBMITTABLE_STATUSES = new Set(["confirmed", "ai_rejected", "human_changes"]);
const HUMAN_DECISIONS = new Set(["approved", "changes_requested"]);
const PUBLISHED_URL_PATTERN = /^https:\/\/(www\.)?(x\.com|twitter\.com)\/[A-Za-z0-9_]{1,50}\/status\/\d{5,25}/;

function serializeReviewRound(round) {
  const item = round.toJSON ? round.toJSON() : round;
  return {
    id: item.id,
    collaborationId: item.collaborationId,
    roundNumber: item.roundNumber,
    draftUrl: item.draftUrl,
    aiStatus: item.aiStatus,
    aiResult: item.aiResult || null,
    aiReviewedAt: item.aiReviewedAt || null,
    humanStatus: item.humanStatus,
    humanComment: item.humanComment || null,
    humanReviewerType: item.humanReviewerType || null,
    humanReviewedAt: item.humanReviewedAt || null,
    createdAt: item.createdAt,
  };
}

function serializeDelivery(delivery) {
  if (!delivery) return null;
  const item = delivery.toJSON ? delivery.toJSON() : delivery;
  return {
    latestDraftUrl: item.latestDraftUrl || null,
    publishedUrl: item.publishedUrl || null,
    publishedAt: item.publishedAt || null,
  };
}

router.post("/collaborations/:collaborationId/drafts", async (req, res) => {
  try {
    const identity = getTwitterIdentity(req);
    const idempotencyKey = getIdempotencyKey(req);
    const { documentId, url: draftUrl } = normalizeGoogleDocUrl(text(req.body?.draftUrl, "草稿链接", 2048, { required: true }));
    const precheck = await fetchGoogleDocText(documentId);
    if (!precheck.accessible) {
      throw publicError("无法访问该 Google Docs，请将文件权限调整为「持有链接的任何人可查看」后重试", 400, "GOOGLE_DOC_NOT_ACCESSIBLE");
    }
    const result = await pgInstance.transaction(async (transaction) => {
      const collaboration = await BusinessCollaboration.findByPk(req.params.collaborationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!collaboration) throw publicError("合作不存在", 404, "COLLABORATION_NOT_FOUND");
      if (collaboration.kolTwitterId !== identity.twitterId) throw publicError("这不是你的合作", 403, "COLLABORATION_FORBIDDEN");
      const replayed = await BusinessCollaborationReviewRound.findOne({
        where: { collaborationId: collaboration.id, submitIdempotencyKey: idempotencyKey },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (replayed) return { round: replayed, replay: true };
      const latestRound = await BusinessCollaborationReviewRound.findOne({
        where: { collaborationId: collaboration.id },
        order: [["roundNumber", "DESC"]],
        transaction,
      });
      const isStalledAi = latestRound
        && ["pending", "processing"].includes(latestRound.aiStatus)
        && (Date.now() - new Date(latestRound.createdAt).getTime() > 10 * 60 * 1000);
      const submittable = DRAFT_SUBMITTABLE_STATUSES.has(collaboration.status)
        || (collaboration.status === "draft_submitted" && (latestRound?.aiStatus === "error" || isStalledAi));
      if (!submittable) throw publicError("当前合作状态不能提交草稿", 409, "COLLABORATION_NOT_SUBMITTABLE");
      if (isStalledAi) {
        await latestRound.update({
          aiStatus: "error",
          aiResult: { error: "stalled_timeout", message: "AI review timed out, superseded by new draft" },
          aiReviewedAt: new Date(),
        }, { transaction });
      }
      const round = await BusinessCollaborationReviewRound.create({
        collaborationId: collaboration.id,
        roundNumber: Number(latestRound?.roundNumber || 0) + 1,
        draftUrl,
        aiStatus: "pending",
        humanStatus: "waiting_ai",
        submittedByAuthCenterUserId: identity.authCenterUserId,
        submitIdempotencyKey: idempotencyKey,
      }, { transaction });
      const delivery = await BusinessCollaborationDelivery.findOne({
        where: { collaborationId: collaboration.id },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (delivery) {
        await delivery.update({ latestDraftUrl: draftUrl }, { transaction });
      } else {
        await BusinessCollaborationDelivery.create({ collaborationId: collaboration.id, latestDraftUrl: draftUrl }, { transaction });
      }
      await collaboration.update({ status: "draft_submitted" }, { transaction });
      await audit({
        transaction,
        req,
        activityId: collaboration.activityId,
        invitationId: collaboration.invitationId,
        collaborationId: collaboration.id,
        action: "draft_submitted",
        actorType: "kol",
        metadata: { roundId: round.id, roundNumber: round.roundNumber, idempotencyKey },
      });
      return { round, replay: false };
    });
    if (!result.replay) {
      setImmediate(() => {
        runAiReviewForRound(result.round.id).catch((error) => {
          console.error("[business-collaboration] ai review dispatch failed:", error);
        });
      });
    }
    return res.json({ success: true, data: { round: serializeReviewRound(result.round), replay: result.replay } });
  } catch (error) {
    return sendError(res, error, "DRAFT_SUBMIT_FAILED");
  }
});

router.get("/collaborations/:collaborationId/reviews", async (req, res) => {
  try {
    const collaboration = await BusinessCollaboration.findByPk(req.params.collaborationId, {
      include: [
        { model: BusinessCollaborationActivity, as: "activity" },
        { model: BusinessCollaborationInvitation, as: "invitation" },
        { model: BusinessCollaborationDelivery, as: "delivery" },
      ],
    });
    if (!collaboration) throw publicError("合作不存在", 404, "COLLABORATION_NOT_FOUND");
    let allowed = false;
    try {
      await loadActiveAccess(collaboration.activityId, req.authCenter.user.id);
      allowed = true;
    } catch (_) {
      const identity = getOptionalTwitterIdentity(req);
      allowed = Boolean(identity && identity.twitterId === collaboration.kolTwitterId);
    }
    if (!allowed) throw publicError("你没有权限查看该合作的审核记录", 403, "COLLABORATION_FORBIDDEN");
    const rounds = await BusinessCollaborationReviewRound.findAll({
      where: { collaborationId: collaboration.id },
      order: [["roundNumber", "ASC"]],
    });
    res.set("Cache-Control", "no-store");
    return res.json({
      success: true,
      data: {
        collaboration: { id: collaboration.id, status: collaboration.status, confirmedAt: collaboration.confirmedAt },
        rounds: rounds.map(serializeReviewRound),
        delivery: serializeDelivery(collaboration.delivery),
      },
    });
  } catch (error) {
    return sendError(res, error, "COLLABORATION_REVIEWS_FAILED");
  }
});

router.post("/review-rounds/:roundId/human-decision", async (req, res) => {
  try {
    const idempotencyKey = getIdempotencyKey(req);
    const decision = text(req.body?.decision, "审核结论", 32, { required: true });
    if (!HUMAN_DECISIONS.has(decision)) throw publicError("审核结论只能是 approved 或 changes_requested", 400, "INVALID_INPUT");
    const comment = text(req.body?.comment, "审核意见", 2000, { required: decision === "changes_requested" });
    const result = await pgInstance.transaction(async (transaction) => {
      const initial = await BusinessCollaborationReviewRound.findByPk(req.params.roundId, {
        include: [{
          model: BusinessCollaboration,
          as: "collaboration",
          include: [{ model: BusinessCollaborationActivity, as: "activity" }],
        }],
        transaction,
      });
      if (!initial?.collaboration) throw publicError("审核轮次不存在", 404, "REVIEW_ROUND_NOT_FOUND");
      const activity = initial.collaboration.activity;
      if (activity?.reviewerMode !== "project") {
        throw publicError("该活动由 EchoHunt 运营审核，项目方无权处理", 403, "REVIEW_ROUND_NOT_ASSIGNED");
      }
      await loadActiveAccess(activity.id, req.authCenter.user.id, transaction, { lock: true });
      const round = await BusinessCollaborationReviewRound.findByPk(initial.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (round.decisionIdempotencyKey === idempotencyKey && HUMAN_DECISIONS.has(round.humanStatus)) {
        return { round, replay: true };
      }
      if (round.aiStatus !== "passed" || round.humanStatus !== "pending") {
        throw publicError("该轮草稿当前不能人工审核，需先通过 AI 初审", 409, "REVIEW_ROUND_NOT_DECIDABLE");
      }
      const now = new Date();
      await round.update({
        humanStatus: decision,
        humanComment: comment,
        humanReviewerType: "project",
        humanReviewerAuthCenterUserId: req.authCenter.user.id,
        humanReviewedAt: now,
        decisionIdempotencyKey: idempotencyKey,
      }, { transaction });
      const collaboration = await BusinessCollaboration.findByPk(round.collaborationId, { transaction, lock: transaction.LOCK.UPDATE });
      await collaboration.update({ status: decision === "approved" ? "approved_for_publish" : "human_changes" }, { transaction });
      await audit({
        transaction,
        req,
        activityId: collaboration.activityId,
        invitationId: collaboration.invitationId,
        collaborationId: collaboration.id,
        action: decision === "approved" ? "human_review_approved" : "human_review_changes_requested",
        actorType: "manager",
        metadata: { roundId: round.id, roundNumber: round.roundNumber, idempotencyKey },
      });
      return { round, replay: false };
    });
    return res.json({ success: true, data: { round: serializeReviewRound(result.round), replay: result.replay } });
  } catch (error) {
    return sendError(res, error, "REVIEW_ROUND_DECISION_FAILED");
  }
});

router.post("/collaborations/:collaborationId/published-link", async (req, res) => {
  try {
    const identity = getTwitterIdentity(req);
    const idempotencyKey = getIdempotencyKey(req);
    const publishedUrl = text(req.body?.publishedUrl, "正式推文链接", 2048, { required: true });
    if (!PUBLISHED_URL_PATTERN.test(publishedUrl)) {
      throw publicError("请提供有效的 X（Twitter）推文链接", 400, "INVALID_PUBLISHED_URL");
    }
    const result = await pgInstance.transaction(async (transaction) => {
      const collaboration = await BusinessCollaboration.findByPk(req.params.collaborationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!collaboration) throw publicError("合作不存在", 404, "COLLABORATION_NOT_FOUND");
      if (collaboration.kolTwitterId !== identity.twitterId) throw publicError("这不是你的合作", 403, "COLLABORATION_FORBIDDEN");
      let delivery = await BusinessCollaborationDelivery.findOne({
        where: { collaborationId: collaboration.id },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (delivery?.publishedIdempotencyKey === idempotencyKey) return { collaboration, delivery, replay: true };
      if (collaboration.status !== "approved_for_publish") {
        throw publicError("人工审核通过后才能提交正式链接", 409, "COLLABORATION_NOT_PUBLISHABLE");
      }
      const now = new Date();
      const values = { publishedUrl, publishedAt: now, publishedIdempotencyKey: idempotencyKey };
      if (delivery) {
        await delivery.update(values, { transaction });
      } else {
        delivery = await BusinessCollaborationDelivery.create({ collaborationId: collaboration.id, ...values }, { transaction });
      }
      await collaboration.update({ status: "published_submitted" }, { transaction });
      await audit({
        transaction,
        req,
        activityId: collaboration.activityId,
        invitationId: collaboration.invitationId,
        collaborationId: collaboration.id,
        action: "published_link_submitted",
        actorType: "kol",
        metadata: { publishedUrl, idempotencyKey },
      });
      return { collaboration, delivery, replay: false };
    });
    return res.json({
      success: true,
      data: {
        collaboration: { id: result.collaboration.id, status: result.collaboration.status, confirmedAt: result.collaboration.confirmedAt },
        delivery: serializeDelivery(result.delivery),
        replay: result.replay,
      },
    });
  } catch (error) {
    return sendError(res, error, "PUBLISHED_LINK_SUBMIT_FAILED");
  }
});

module.exports = router;
