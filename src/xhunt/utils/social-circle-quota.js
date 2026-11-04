const crypto = require("crypto");
const { getRateLimitIdentity } = require("./request-identity");

const SOCIAL_CIRCLE_FREE_DAILY_LIMIT = 6;
const SOCIAL_CIRCLE_VIP_DAILY_LIMIT = 30;

const SOCIAL_CIRCLE_QUOTA_CHECK_SCRIPT = `
local key = KEYS[1]
local target = ARGV[1]
local limit = tonumber(ARGV[2])

if redis.call("SISMEMBER", key, target) == 1 then
  return {1, redis.call("SCARD", key)}
end

local used = redis.call("SCARD", key)
if used >= limit then
  return {0, used}
end

return {1, used}
`;

const SOCIAL_CIRCLE_QUOTA_COMMIT_SCRIPT = `
local key = KEYS[1]
local target = ARGV[1]
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

if redis.call("SISMEMBER", key, target) == 1 then
  return {1, redis.call("SCARD", key), 0}
end

local used = redis.call("SCARD", key)
if used >= limit then
  return {0, used, 0}
end

redis.call("SADD", key, target)
redis.call("EXPIRE", key, ttl)
return {1, used + 1, 1}
`;

function getSocialCircleTarget(req) {
  const userId = String(req.query?.user_id || "").trim();
  if (/^[1-9]\d{0,19}$/.test(userId)) return `id:${userId}`;

  const username = String(req.query?.username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (/^[a-z0-9_]{1,15}$/.test(username)) return `username:${username}`;

  // cursor 属于已经查看过的同一个社交圈，不额外扣减 handler 额度。
  return null;
}

function getBeijingDayContext(now = new Date()) {
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = beijingTime.getUTCFullYear();
  const month = beijingTime.getUTCMonth();
  const day = beijingTime.getUTCDate();
  const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const nextMidnight = Date.UTC(year, month, day + 1) - 8 * 60 * 60 * 1000;

  return {
    date,
    resetTime: nextMidnight,
    ttlSeconds: Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000)),
  };
}

function createSocialCircleQuotaContext(req, isVip) {
  const target = getSocialCircleTarget(req);
  if (!target) return null;

  const limit = isVip
    ? SOCIAL_CIRCLE_VIP_DAILY_LIMIT
    : SOCIAL_CIRCLE_FREE_DAILY_LIMIT;
  const identityHash = crypto
    .createHash("sha256")
    .update(getRateLimitIdentity(req))
    .digest("hex");
  const dayContext = getBeijingDayContext();

  return {
    target,
    isVip,
    limit,
    key: `xhunt:social-circle:daily:${dayContext.date}:${identityHash}`,
    resetTime: dayContext.resetTime,
    ttlSeconds: dayContext.ttlSeconds,
  };
}

async function checkSocialCircleQuota(redisClient, context) {
  const result = await redisClient.eval(SOCIAL_CIRCLE_QUOTA_CHECK_SCRIPT, {
    keys: [context.key],
    arguments: [context.target, String(context.limit)],
  });

  return {
    allowed: Number(result?.[0]) === 1,
    used: Number(result?.[1]) || 0,
  };
}

function isSuccessfulSocialCircleResponse(data) {
  return (
    data?.code === 200 &&
    Array.isArray(data?.data?.items) &&
    data.data.items.length > 0
  );
}

function buildSocialCircleAvailabilityResponse(data) {
  return {
    code: 200,
    message: "success",
    data: {
      available: isSuccessfulSocialCircleResponse(data),
    },
  };
}

async function commitSocialCircleQuotaIfSuccessful(
  redisClient,
  context,
  data
) {
  if (!isSuccessfulSocialCircleResponse(data)) {
    return { charged: false };
  }

  const result = await redisClient.eval(SOCIAL_CIRCLE_QUOTA_COMMIT_SCRIPT, {
    keys: [context.key],
    arguments: [
      context.target,
      String(context.limit),
      String(context.ttlSeconds),
    ],
  });

  return {
    charged: Number(result?.[2]) === 1,
    allowed: Number(result?.[0]) === 1,
    used: Number(result?.[1]) || 0,
  };
}

function setSocialCircleQuotaHeaders(res, context, used) {
  res.setHeader("X-RateLimit-Limit", context.limit);
  res.setHeader(
    "X-RateLimit-Remaining",
    Math.max(0, context.limit - used)
  );
  res.setHeader("X-RateLimit-Reset", context.resetTime);
}

function buildSocialCircleLimitResponse(context, used) {
  return {
    code: 429,
    limitExceeded: true,
    message: context.isVip
      ? "超过每日查看限额"
      : "超过每日查看限额，免费申请VIP获取更多限额",
    isVip: context.isVip,
    limit: context.limit,
    used,
    remaining: 0,
    resetTime: context.resetTime,
  };
}

module.exports = {
  SOCIAL_CIRCLE_FREE_DAILY_LIMIT,
  SOCIAL_CIRCLE_VIP_DAILY_LIMIT,
  getSocialCircleTarget,
  getBeijingDayContext,
  createSocialCircleQuotaContext,
  checkSocialCircleQuota,
  buildSocialCircleAvailabilityResponse,
  commitSocialCircleQuotaIfSuccessful,
  setSocialCircleQuotaHeaders,
  buildSocialCircleLimitResponse,
};
