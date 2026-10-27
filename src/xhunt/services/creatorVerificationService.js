const axios = require("axios");
const crypto = require("crypto");
const { DATA_SERVICE_BASE_URL } = require("../constants/dataService");

const SPECIAL_AUTHORED_RANK = 9999999;
const CREATOR_AUTH_URL = `${DATA_SERVICE_BASE_URL}/front/auth/creator`;
const CREATOR_RANK_URLS = {
  web3: `${DATA_SERVICE_BASE_URL}/fetch/twitter/rank`,
  ai: `${DATA_SERVICE_BASE_URL}/fetch/ai/rank`,
};
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const SUBMISSION_LOCK_SECONDS = 45;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 3;

function creatorVerificationError(code, status, publicMessage, details) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  error.publicMessage = publicMessage;
  if (details !== undefined) error.details = details;
  return error;
}

function getCooldownDays() {
  const configured = Number(process.env.CREATOR_VERIFICATION_COOLDOWN_DAYS);
  if (Number.isInteger(configured) && configured >= 1 && configured <= 365) return configured;
  return 30;
}

function normalizeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeCreatorCandidate(record, domain) {
  const authCreator = record?.auth_creator || record?.creatorAuth || null;
  const legacyStatus = authCreator?.status == null ? null : Number(authCreator.status);
  const kolRank = Number(record?.kolRank);
  const recordTime = normalizeDate(authCreator?.record_time || authCreator?.recordTime);
  const isSpecialApprovedRank = Number.isFinite(kolRank) && kolRank === SPECIAL_AUTHORED_RANK;

  let status = "NOT_APPLIED";
  if (legacyStatus === 2 || isSpecialApprovedRank) status = "APPROVED";
  else if (legacyStatus === 1) status = "PENDING";
  else if (legacyStatus === 3) status = "REJECTED";
  else if (legacyStatus === 4) status = "REVOKED";

  return {
    status,
    legacyStatus: Number.isFinite(legacyStatus) ? legacyStatus : null,
    recordTime,
    twitterId: authCreator?.twitter_id || authCreator?.twitterId || null,
    domain: domain || record?.domain || null,
  };
}

function candidatePriority(candidate) {
  if (candidate.status === "APPROVED") return 5;
  if (candidate.status === "PENDING") return 4;
  if (candidate.status === "REJECTED") return 3;
  if (candidate.status === "REVOKED") return 2;
  return 1;
}

function normalizeCreatorVerificationFromRankRecords(records, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const candidates = (Array.isArray(records) ? records : [])
    .map((item) => normalizeCreatorCandidate(item?.record ?? item, item?.domain))
    .sort((left, right) => {
      const priorityDiff = candidatePriority(right) - candidatePriority(left);
      if (priorityDiff) return priorityDiff;
      return Date.parse(right.recordTime || 0) - Date.parse(left.recordTime || 0);
    });
  const selected = candidates[0] || normalizeCreatorCandidate(null, null);

  let nextEligibleAt = null;
  if (["REJECTED", "REVOKED"].includes(selected.status) && selected.recordTime) {
    const next = new Date(selected.recordTime);
    next.setUTCDate(next.getUTCDate() + getCooldownDays());
    nextEligibleAt = next.toISOString();
  }

  const cooldownExpired = !!nextEligibleAt && new Date(nextEligibleAt).getTime() <= now.getTime();
  const canApply = selected.status === "NOT_APPLIED"
    || (["REJECTED", "REVOKED"].includes(selected.status) && cooldownExpired);

  return {
    status: selected.status,
    canApply,
    appliedAt: ["PENDING", "REJECTED", "REVOKED"].includes(selected.status)
      ? selected.recordTime
      : null,
    approvedAt: selected.status === "APPROVED" ? selected.recordTime : null,
    nextEligibleAt,
    twitterId: selected.twitterId || options.twitterId || null,
    sourceDomain: selected.domain,
  };
}

async function fetchCreatorRankRecord(domain, twitterId) {
  const url = CREATOR_RANK_URLS[domain];
  if (!url) throw new Error(`Unsupported creator verification domain: ${domain}`);
  const response = await axios.get(url, {
    params: { user_ids: String(twitterId) },
    timeout: 7000,
  });
  const rows = response?.data?.data?.data;
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function fetchCreatorVerification(twitterId) {
  const normalizedTwitterId = String(twitterId || "").trim();
  if (!normalizedTwitterId) {
    throw creatorVerificationError(
      "TWITTER_ACCOUNT_REQUIRED",
      422,
      "请先连接 X 账号后再申请创作者认证。"
    );
  }

  const domains = Object.keys(CREATOR_RANK_URLS);
  const settled = await Promise.allSettled(
    domains.map((domain) => fetchCreatorRankRecord(domain, normalizedTwitterId))
  );
  const records = [];
  const errors = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      if (result.value) records.push({ domain: domains[index], record: result.value });
    } else {
      errors.push({ domain: domains[index], message: result.reason?.message || String(result.reason) });
    }
  });

  if (errors.length > 0) {
    throw creatorVerificationError(
      "CREATOR_VERIFICATION_STATUS_UNAVAILABLE",
      502,
      "创作者认证状态暂时无法查询，请稍后重试。"
    );
  }

  return normalizeCreatorVerificationFromRankRecords(records, { twitterId: normalizedTwitterId });
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!key || key.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(key)) {
    throw creatorVerificationError(
      "IDEMPOTENCY_KEY_REQUIRED",
      400,
      "缺少有效的 Idempotency-Key。"
    );
  }
  return key;
}

function hashKey(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function requireSubmissionRedis(redisClient) {
  if (
    !redisClient?.get
    || !redisClient?.set
    || !redisClient?.setEx
    || !redisClient?.incr
    || !redisClient?.expire
  ) {
    throw creatorVerificationError(
      "CREATOR_VERIFICATION_SUBMISSION_UNAVAILABLE",
      503,
      "创作者认证申请服务暂不可用，请稍后重试。"
    );
  }
  return redisClient;
}

async function enforceSubmissionRateLimit(redis, twitterId) {
  const key = `echohunt:creator-verification:rate:v1:${hashKey(twitterId)}`;
  let count;
  try {
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  } catch (_) {
    throw creatorVerificationError(
      "CREATOR_VERIFICATION_SUBMISSION_UNAVAILABLE",
      503,
      "创作者认证申请服务暂不可用，请稍后重试。"
    );
  }
  if (count <= RATE_LIMIT_MAX_REQUESTS) return;

  const ttl = typeof redis.ttl === "function"
    ? Number(await redis.ttl(key).catch(() => RATE_LIMIT_WINDOW_SECONDS))
    : RATE_LIMIT_WINDOW_SECONDS;
  const retryAfterSeconds = Number.isFinite(ttl) && ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS;
  throw creatorVerificationError(
    "CREATOR_VERIFICATION_RATE_LIMITED",
    429,
    "申请操作过于频繁，请稍后重试。",
    { retryAfterSeconds }
  );
}

function extractCreatorAction(payload) {
  return payload?.data?.data?.action || payload?.data?.action || payload?.action || null;
}

function statusError(verification) {
  if (verification.status === "PENDING") {
    return creatorVerificationError(
      "CREATOR_VERIFICATION_PENDING",
      409,
      "创作者认证正在审核中。",
      { creatorVerification: verification }
    );
  }
  if (verification.status === "APPROVED") {
    return creatorVerificationError(
      "CREATOR_VERIFICATION_ALREADY_APPROVED",
      409,
      "当前账号已经通过创作者认证。",
      { creatorVerification: verification }
    );
  }
  if (!verification.canApply) {
    return creatorVerificationError(
      "CREATOR_VERIFICATION_COOLDOWN",
      429,
      "当前暂时不能再次申请创作者认证。",
      { creatorVerification: verification }
    );
  }
  return null;
}

async function submitCreatorVerification({
  twitterId,
  authCenterUserId,
  idempotencyKey,
  redisClient,
} = {}) {
  const normalizedTwitterId = String(twitterId || "").trim();
  const normalizedAuthCenterUserId = String(authCenterUserId || "").trim();
  if (!normalizedTwitterId) {
    throw creatorVerificationError(
      "TWITTER_ACCOUNT_REQUIRED",
      422,
      "请先连接 X 账号后再申请创作者认证。"
    );
  }
  if (!normalizedAuthCenterUserId) {
    throw creatorVerificationError("AUTH_REQUIRED", 401, "请先登录后再申请创作者认证。");
  }

  const key = normalizeIdempotencyKey(idempotencyKey);
  const redis = requireSubmissionRedis(redisClient);
  const idempotencyCacheKey = `echohunt:creator-verification:idempotency:v1:${hashKey(`${normalizedAuthCenterUserId}:${key}`)}`;
  const cached = await redis.get(idempotencyCacheKey).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (_) {
      // Ignore malformed cache data and safely repeat the status checks below.
    }
  }

  await enforceSubmissionRateLimit(redis, normalizedTwitterId);

  const lockKey = `echohunt:creator-verification:lock:v1:${hashKey(normalizedTwitterId)}`;
  const lockToken = crypto.randomBytes(16).toString("hex");
  let acquired;
  try {
    acquired = await redis.set(lockKey, lockToken, { NX: true, EX: SUBMISSION_LOCK_SECONDS });
  } catch (_) {
    throw creatorVerificationError(
      "CREATOR_VERIFICATION_SUBMISSION_UNAVAILABLE",
      503,
      "创作者认证申请服务暂不可用，请稍后重试。"
    );
  }
  if (!acquired) {
    throw creatorVerificationError(
      "CREATOR_VERIFICATION_SUBMISSION_IN_PROGRESS",
      409,
      "创作者认证申请正在提交，请勿重复操作。"
    );
  }

  try {
    const current = await fetchCreatorVerification(normalizedTwitterId);
    const currentStatusError = statusError(current);
    if (currentStatusError) throw currentStatusError;

    let upstreamResponse;
    try {
      upstreamResponse = await axios.post(
        CREATOR_AUTH_URL,
        { user_id: normalizedTwitterId },
        {
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          timeout: 10000,
        }
      );
    } catch (error) {
      throw creatorVerificationError(
        "CREATOR_VERIFICATION_UPSTREAM_FAILED",
        502,
        "创作者认证申请提交失败，请稍后重试。",
        { upstreamStatus: error.response?.status || null }
      );
    }

    const action = extractCreatorAction(upstreamResponse?.data);
    if (!["已认证", "认证中", "禁止认证"].includes(action)) {
      throw creatorVerificationError(
        "CREATOR_VERIFICATION_UPSTREAM_INVALID_RESPONSE",
        502,
        "创作者认证服务返回了无法识别的结果，请稍后重试。"
      );
    }
    let result = await fetchCreatorVerification(normalizedTwitterId).catch(() => current);
    if (action === "已认证" && result.status !== "APPROVED") {
      result = { ...result, status: "APPROVED", canApply: false };
    } else if (action === "认证中" && !["APPROVED", "PENDING"].includes(result.status)) {
      result = { ...result, status: "PENDING", canApply: false, appliedAt: new Date().toISOString() };
    } else if (action === "禁止认证") {
      const deniedError = statusError(result);
      if (deniedError) throw deniedError;
      throw creatorVerificationError(
        "CREATOR_VERIFICATION_BLOCKED",
        409,
        "当前账号暂时不能申请创作者认证。",
        { creatorVerification: result }
      );
    }

    // The upstream application has already succeeded at this point. A cache write
    // failure must not turn that success into a client-visible 5xx; the status
    // pre-check above still prevents a retry from submitting an active request.
    await redis.setEx(idempotencyCacheKey, IDEMPOTENCY_TTL_SECONDS, JSON.stringify(result)).catch(() => {});
    return result;
  } finally {
    if (typeof redis.del === "function") {
      const currentToken = await redis.get(lockKey).catch(() => null);
      if (currentToken === lockToken) await redis.del(lockKey).catch(() => {});
    }
  }
}

module.exports = {
  SPECIAL_AUTHORED_RANK,
  creatorVerificationError,
  extractCreatorAction,
  fetchCreatorVerification,
  getCooldownDays,
  normalizeCreatorVerificationFromRankRecords,
  normalizeIdempotencyKey,
  submitCreatorVerification,
};
