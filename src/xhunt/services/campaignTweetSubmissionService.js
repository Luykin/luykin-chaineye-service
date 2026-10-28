const crypto = require("crypto");
const { Op, QueryTypes } = require("sequelize");
const {
  pgInstance,
  AuthCenterXhuntIdentity,
  CampaignRegistration,
  XhuntCampaignTweetSubmission,
} = require("../../models/postgres-start");
const tweetSubmissionContract = require("../../../shared/xhunt/tweet-submission-contract.json");
const { normalizeCustomLeaderboardKey } = require("../utils/custom-leaderboard-key");
const { buildTweetDisplayTitle } = require("../utils/tweet-display-title");
const { getEchohuntTweetDetail } = require("./twitter-echohunt");

const PERIODS = new Set(tweetSubmissionContract.periods);
const TWEET_NOT_FOUND_MESSAGES = {
  "zh-CN": "推文不存在或已被删除，请检查链接",
  en: "This post does not exist or has been deleted. Please check the link",
};
const TWEET_AUTHOR_MISMATCH_MESSAGES = {
  "zh-CN": "该推文不属于当前登录的 X 账号，请提交本人发布的推文",
  en: "This post was not published by your connected X account. Please submit your own post",
};
const CURSOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

function submissionError(code, status = 400, publicMessage, details) {
  const error = new Error(code);
  error.status = status;
  if (publicMessage && typeof publicMessage === "object") {
    error.publicMessages = publicMessage;
    error.publicMessage = publicMessage["zh-CN"] || publicMessage.en || code;
  } else if (publicMessage) {
    error.publicMessage = publicMessage;
  }
  if (details !== undefined) error.details = details;
  return error;
}

function parsePositiveInteger(value, { min, max }) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function parseOptionalQueryString(value, errorCode) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw submissionError(errorCode, 400, "Query parameter must be a single string");
  }
  return value.trim();
}

function normalizeTweetSubmissionConfig(value) {
  if (!value || typeof value !== "object" || value.enabled !== true) return { enabled: false };
  const period = String(value.period || "").trim().toLowerCase();
  const periodLimit = parsePositiveInteger(value.periodLimit, tweetSubmissionContract.periodLimit);
  const totalLimit = parsePositiveInteger(value.totalLimit, tweetSubmissionContract.totalLimit);
  if (!PERIODS.has(period) || !periodLimit || !totalLimit) return { enabled: false, invalid: true };
  return { enabled: true, period, periodLimit, totalLimit };
}

function getTweetSubmissionLeaderboards(campaignConfig = {}) {
  if (campaignConfig.leaderboardMode !== "custom") return [];
  const items = Array.isArray(campaignConfig.customLeaderboards) ? campaignConfig.customLeaderboards : [];
  return items
    .map((item, index) => {
      const leaderboardKey = normalizeCustomLeaderboardKey(item?.id);
      const config = normalizeTweetSubmissionConfig(item?.tweetSubmission);
      return { item, index, leaderboardKey, ...config };
    })
    .filter((item) => item.leaderboardKey && item.enabled);
}

function findTweetSubmissionLeaderboard(campaignConfig, leaderboardKey) {
  const key = normalizeCustomLeaderboardKey(leaderboardKey);
  const matches = getTweetSubmissionLeaderboards(campaignConfig).filter((item) => item.leaderboardKey === key);
  return matches.length === 1 ? matches[0] : null;
}

function parseTweetUrl(rawUrl) {
  const input = String(rawUrl || "").trim();
  if (!input || input.length > 2048) throw submissionError("INVALID_TWEET_URL", 400, "Please enter a valid X post URL");
  let url;
  try {
    url = new URL(input);
  } catch (_) {
    throw submissionError("INVALID_TWEET_URL", 400, "Please enter a valid X post URL");
  }
  const host = url.hostname.toLowerCase();
  if (!url.protocol.startsWith("https") || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(host)) {
    throw submissionError("INVALID_TWEET_URL", 400, "Please enter a valid X post URL");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const statusIndex = segments.findIndex((segment) => segment.toLowerCase() === "status");
  const tweetId = statusIndex >= 0 ? segments[statusIndex + 1] : "";
  if (!/^\d+$/.test(tweetId || "")) throw submissionError("INVALID_TWEET_URL", 400, "Please enter a valid X post URL");
  const handle = statusIndex > 0 && segments[0].toLowerCase() !== "i" ? segments[0] : "i";
  return { tweetId, tweetUrl: `https://x.com/${handle}/status/${tweetId}` };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getPeriodStart(period, now = new Date(), campaignStartAt) {
  if (period === "week" && campaignStartAt instanceof Date && !Number.isNaN(campaignStartAt.getTime())) {
    const elapsedWeeks = Math.max(0, Math.floor((now.getTime() - campaignStartAt.getTime()) / WEEK_MS));
    return new Date(campaignStartAt.getTime() + elapsedWeeks * WEEK_MS);
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "week") {
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  }
  return start;
}

function getCampaignStartAt(campaignConfig) {
  return new Date(campaignConfig?.enrollmentWindow?.startAt || "");
}

function assertSubmissionWindow(campaignConfig, now = new Date()) {
  const startAt = new Date(campaignConfig?.enrollmentWindow?.startAt || "");
  const endAt = new Date(campaignConfig?.enrollmentWindow?.endAt || "");
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw submissionError("INVALID_CAMPAIGN_WINDOW", 502, "Campaign submission window is unavailable");
  }
  if (now < startAt || now > endAt) {
    throw submissionError("OUTSIDE_SUBMISSION_WINDOW", 400, "Tweet submission is closed for this campaign");
  }
}

async function getUsage({ campaignKey, leaderboardKey, xHuntUserId, config, transaction, now = new Date(), campaignStartAt }) {
  const where = { campaignKey, leaderboardKey, xHuntUserId };
  const [totalUsed, periodUsed] = await Promise.all([
    XhuntCampaignTweetSubmission.count({ where, transaction }),
    XhuntCampaignTweetSubmission.count({
      where: { ...where, submittedAt: { [Op.gte]: getPeriodStart(config.period, now, campaignStartAt) } },
      transaction,
    }),
  ]);
  return {
    period: config.period,
    periodLimit: config.periodLimit,
    periodUsed,
    periodRemaining: Math.max(0, config.periodLimit - periodUsed),
    totalLimit: config.totalLimit,
    totalUsed,
    totalRemaining: Math.max(0, config.totalLimit - totalUsed),
  };
}

function serializeSubmission(record) {
  const item = typeof record?.toJSON === "function" ? record.toJSON() : record;
  return {
    id: item.id,
    campaignKey: item.campaignKey,
    leaderboardKey: item.leaderboardKey,
    tweetId: item.tweetId,
    tweetUrl: item.tweetUrl,
    title: item.tweetTitle || null,
    submittedAt: item.submittedAt,
    user: {
      twitterId: item.twitterId || null,
      username: item.twitterUsername || null,
    },
  };
}

function lockKey(campaignKey, leaderboardKey, xHuntUserId) {
  return crypto.createHash("sha256").update(`${campaignKey}:${leaderboardKey}:${xHuntUserId}`).digest("hex");
}

async function createTweetSubmission({
  campaignKey,
  leaderboardKey,
  campaignConfig,
  twitterIdentity,
  twitterIdentityRecord,
  authCenterUserId,
  tweetUrl,
}) {
  const leaderboard = findTweetSubmissionLeaderboard(campaignConfig, leaderboardKey);
  if (!leaderboard) throw submissionError("TWEET_SUBMISSION_DISABLED", 400, "Tweet submission is not enabled for this leaderboard");
  assertSubmissionWindow(campaignConfig);
  if (!twitterIdentity?.twitterId) throw submissionError("TWITTER_ID_REQUIRED", 400, "Please connect your X account first");
  const parsedTweet = parseTweetUrl(tweetUrl);

  const tweetDetail = await getEchohuntTweetDetail(twitterIdentityRecord, parsedTweet.tweetId);
  if (!tweetDetail) {
    throw submissionError("TWEET_NOT_FOUND", 404, TWEET_NOT_FOUND_MESSAGES);
  }
  if (!tweetDetail.authorId || tweetDetail.authorId !== String(twitterIdentity.twitterId)) {
    throw submissionError("TWEET_AUTHOR_MISMATCH", 403, TWEET_AUTHOR_MISMATCH_MESSAGES);
  }
  const tweetTitle = buildTweetDisplayTitle(tweetDetail.text);

  const result = await pgInstance.transaction(async (transaction) => {
    const registration = await CampaignRegistration.findOne({
      where: { campaign: campaignKey, twitterId: twitterIdentity.twitterId },
      order: [["registeredAt", "DESC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!registration) throw submissionError("CAMPAIGN_REGISTRATION_REQUIRED", 403, "Please register for this campaign before submitting a post");

    await pgInstance.query("SELECT pg_advisory_xact_lock(hashtext(:key))", {
      replacements: { key: lockKey(campaignKey, leaderboardKey, registration.xHuntUserId) },
      type: QueryTypes.SELECT,
      transaction,
    });

    const duplicate = await XhuntCampaignTweetSubmission.findOne({
      where: { campaignKey, leaderboardKey, xHuntUserId: registration.xHuntUserId, tweetId: parsedTweet.tweetId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (duplicate) throw submissionError("TWEET_ALREADY_SUBMITTED", 409, "This post has already been submitted to this leaderboard");

    const usage = await getUsage({
      campaignKey,
      leaderboardKey,
      xHuntUserId: registration.xHuntUserId,
      config: leaderboard,
      transaction,
      campaignStartAt: getCampaignStartAt(campaignConfig),
    });
    if (!usage.periodRemaining || !usage.totalRemaining) {
      throw submissionError("SUBMISSION_LIMIT_REACHED", 409, "Submission limit reached", usage);
    }

    const submission = await XhuntCampaignTweetSubmission.create({
      campaignKey,
      leaderboardKey,
      campaignRegistrationId: registration.id,
      xHuntUserId: registration.xHuntUserId,
      authCenterUserId: authCenterUserId || registration.authCenterUserId || null,
      twitterId: registration.twitterId,
      twitterUsername: registration.username || twitterIdentity.username || null,
      tweetTitle: tweetTitle || null,
      ...parsedTweet,
      submittedAt: new Date(),
    }, { transaction });
    const nextUsage = await getUsage({
      campaignKey,
      leaderboardKey,
      xHuntUserId: registration.xHuntUserId,
      config: leaderboard,
      transaction,
      campaignStartAt: getCampaignStartAt(campaignConfig),
    });
    return { submission, usage: nextUsage };
  });

  return { submission: serializeSubmission(result.submission), usage: result.usage };
}

async function getUserTweetSubmissions({
  campaignKey,
  campaignConfig,
  twitterIdentity,
  leaderboardKey,
  cursor,
  limit,
}) {
  const leaderboards = getTweetSubmissionLeaderboards(campaignConfig);
  const requestedLeaderboardKey = normalizeCustomLeaderboardKey(
    parseOptionalQueryString(leaderboardKey, "INVALID_LEADERBOARD_KEY")
  );
  const selectedLeaderboards = requestedLeaderboardKey
    ? leaderboards.filter((item) => item.leaderboardKey === requestedLeaderboardKey)
    : leaderboards;
  if (requestedLeaderboardKey && !selectedLeaderboards.length) {
    throw submissionError("LEADERBOARD_NOT_FOUND", 404, "Leaderboard not found");
  }
  if (cursor && selectedLeaderboards.length !== 1) {
    throw submissionError(
      "LEADERBOARD_KEY_REQUIRED_FOR_CURSOR",
      400,
      "leaderboardKey is required when cursor is provided"
    );
  }
  const normalizedLimit = normalizePageLimit(limit, tweetSubmissionContract.userHistoryPage);
  const decodedCursor = decodeCursor(cursor);
  if (!twitterIdentity?.twitterId) return { registered: false, leaderboards: [] };
  const registration = await CampaignRegistration.findOne({
    where: { campaign: campaignKey, twitterId: twitterIdentity.twitterId },
    order: [["registeredAt", "DESC"]],
  });
  if (!registration) return { registered: false, leaderboards: [] };
  const summaries = await Promise.all(selectedLeaderboards.map(async (leaderboard) => {
    const [usage, page] = await Promise.all([
      getUsage({
        campaignKey,
        leaderboardKey: leaderboard.leaderboardKey,
        xHuntUserId: registration.xHuntUserId,
        config: leaderboard,
        campaignStartAt: getCampaignStartAt(campaignConfig),
      }),
      listSubmissionPage({
        where: {
          campaignKey,
          leaderboardKey: leaderboard.leaderboardKey,
          xHuntUserId: registration.xHuntUserId,
        },
        decodedCursor,
        normalizedLimit,
      }),
    ]);
    return {
      leaderboardKey: leaderboard.leaderboardKey,
      config: {
        period: leaderboard.period,
        periodLimit: leaderboard.periodLimit,
        totalLimit: leaderboard.totalLimit,
      },
      usage,
      submissions: page.items,
      nextCursor: page.nextCursor,
    };
  }));
  return { registered: true, leaderboards: summaries };
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    if (typeof value !== "string") throw new Error("invalid cursor type");
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!parsed?.submittedAt || !parsed?.id || !CURSOR_ID_PATTERN.test(String(parsed.id))) {
      throw new Error("invalid cursor payload");
    }
    const submittedAt = new Date(parsed.submittedAt);
    if (Number.isNaN(submittedAt.getTime())) throw new Error("invalid cursor date");
    return { submittedAt, id: String(parsed.id) };
  } catch (_) {
    throw submissionError("INVALID_CURSOR", 400, "Invalid pagination cursor");
  }
}

function encodeCursor(item) {
  if (!item) return null;
  return Buffer.from(JSON.stringify({ submittedAt: item.submittedAt, id: item.id })).toString("base64url");
}

function normalizePageLimit(value, { defaultLimit, maxLimit }) {
  if (value === undefined || value === null || value === "") return defaultLimit;
  if (typeof value !== "string" && typeof value !== "number") {
    throw submissionError("INVALID_LIMIT", 400, `limit must be an integer between 1 and ${maxLimit}`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxLimit) {
    throw submissionError("INVALID_LIMIT", 400, `limit must be an integer between 1 and ${maxLimit}`);
  }
  return parsed;
}

function parseIsoDate(value, errorCode) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw submissionError(errorCode, 400, "Invalid ISO-8601 date");
  }
  const raw = value.trim();
  const parsed = new Date(raw);
  const [year, month, day] = raw.slice(0, 10).split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  const invalidCalendarDate =
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day;
  if (!ISO_8601_PATTERN.test(raw) || Number.isNaN(parsed.getTime()) || invalidCalendarDate) {
    throw submissionError(errorCode, 400, "Invalid ISO-8601 date");
  }
  return parsed;
}

async function listSubmissionPage({ where, decodedCursor, normalizedLimit }) {
  const queryWhere = { ...where };
  if (decodedCursor) {
    const existingAnd = Array.isArray(queryWhere[Op.and]) ? queryWhere[Op.and] : [];
    queryWhere[Op.and] = [...existingAnd, {
      [Op.or]: [
        { submittedAt: { [Op.lt]: decodedCursor.submittedAt } },
        { submittedAt: decodedCursor.submittedAt, id: { [Op.lt]: decodedCursor.id } },
      ],
    }];
  }
  const rows = await XhuntCampaignTweetSubmission.findAll({
    where: queryWhere,
    order: [["submittedAt", "DESC"], ["id", "DESC"]],
    limit: normalizedLimit + 1,
  });
  const hasMore = rows.length > normalizedLimit;
  const items = hasMore ? rows.slice(0, -1) : rows;
  return { items: items.map(serializeSubmission), nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
}

function buildSubmissionSearchCondition(query) {
  const keyword = parseOptionalQueryString(query, "INVALID_QUERY");
  if (!keyword) return null;
  if (keyword.length > 200) {
    throw submissionError("INVALID_QUERY", 400, "搜索关键词不能超过 200 个字符");
  }
  const escaped = keyword.replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escaped}%`;
  return {
    [Op.or]: [
      { tweetTitle: { [Op.iLike]: pattern } },
      { tweetId: { [Op.iLike]: pattern } },
      { tweetUrl: { [Op.iLike]: pattern } },
      { twitterUsername: { [Op.iLike]: pattern } },
      { twitterId: { [Op.iLike]: pattern } },
    ],
  };
}

async function listExternalTweetSubmissions({ campaignKey, leaderboardKey, from, to, cursor, limit, query }) {
  const fromDate = parseIsoDate(from, "INVALID_FROM");
  const toDate = parseIsoDate(to, "INVALID_TO");
  if (fromDate && toDate && fromDate > toDate) {
    throw submissionError("INVALID_DATE_RANGE", 400, "from must not be later than to");
  }
  const where = { campaignKey };
  const normalizedLeaderboardKey = normalizeCustomLeaderboardKey(
    parseOptionalQueryString(leaderboardKey, "INVALID_LEADERBOARD_KEY")
  );
  if (normalizedLeaderboardKey) where.leaderboardKey = normalizedLeaderboardKey;
  const submittedAt = {};
  if (fromDate) submittedAt[Op.gte] = fromDate;
  if (toDate) submittedAt[Op.lte] = toDate;
  if (Object.keys(submittedAt).length) where.submittedAt = submittedAt;
  const searchCondition = buildSubmissionSearchCondition(query);
  if (searchCondition) where[Op.and] = [searchCondition];
  return listSubmissionPage({
    where,
    decodedCursor: decodeCursor(cursor),
    normalizedLimit: normalizePageLimit(limit, tweetSubmissionContract.externalHistoryPage),
  });
}

async function replaceTweetSubmission({ id, campaignKey, tweetUrl }) {
  const where = { id: String(id || "").trim() };
  if (!where.id) throw submissionError("SUBMISSION_ID_REQUIRED", 400, "投稿记录 ID 不能为空");
  if (campaignKey) where.campaignKey = String(campaignKey).trim();

  const current = await XhuntCampaignTweetSubmission.findOne({ where });
  if (!current) throw submissionError("TWEET_SUBMISSION_NOT_FOUND", 404, "投稿记录不存在或已删除");

  const parsedTweet = parseTweetUrl(tweetUrl);
  const twitterId = String(current.twitterId || "").trim();
  const twitterIdentityRecord = twitterId
    ? await AuthCenterXhuntIdentity.findOne({
      where: {
        provider: "twitter",
        providerSubjectLower: twitterId.toLowerCase(),
      },
    })
    : null;
  if (!twitterIdentityRecord) {
    throw submissionError(
      "TWITTER_IDENTITY_NOT_FOUND",
      409,
      "未找到投稿用户的 X 授权，请让用户重新连接 X 后再重试"
    );
  }

  let tweetDetail;
  try {
    tweetDetail = await getEchohuntTweetDetail(twitterIdentityRecord, parsedTweet.tweetId);
  } catch (error) {
    if (error?.message === "X_REAUTH_REQUIRED") {
      throw submissionError(
        "TWITTER_REAUTH_REQUIRED",
        409,
        "投稿用户的 X 授权已失效，请让用户重新连接 X 后再重试"
      );
    }
    if (error?.status === 429) {
      throw submissionError("TWITTER_RATE_LIMITED", 429, "X 接口暂时限流，请稍后重试");
    }
    throw submissionError("TWITTER_LOOKUP_FAILED", 502, "暂时无法读取新推文，请稍后重试");
  }
  if (!tweetDetail) {
    throw submissionError("TWEET_NOT_FOUND", 404, TWEET_NOT_FOUND_MESSAGES);
  }
  if (!tweetDetail.authorId || tweetDetail.authorId !== twitterId) {
    throw submissionError(
      "TWEET_AUTHOR_MISMATCH",
      403,
      "新链接必须仍然是原投稿用户本人发布的推文"
    );
  }
  const tweetTitle = buildTweetDisplayTitle(tweetDetail.text);

  try {
    return await pgInstance.transaction(async (transaction) => {
      const locked = await XhuntCampaignTweetSubmission.findOne({
        where,
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!locked) throw submissionError("TWEET_SUBMISSION_NOT_FOUND", 404, "投稿记录不存在或已删除");

      const duplicate = await XhuntCampaignTweetSubmission.findOne({
        where: {
          campaignKey: locked.campaignKey,
          leaderboardKey: locked.leaderboardKey,
          xHuntUserId: locked.xHuntUserId,
          tweetId: parsedTweet.tweetId,
          id: { [Op.ne]: locked.id },
        },
        transaction,
      });
      if (duplicate) {
        throw submissionError(
          "TWEET_ALREADY_SUBMITTED",
          409,
          "该用户已经向这个榜单提交过这条推文"
        );
      }

      const before = serializeSubmission(locked);
      await locked.update({
        ...parsedTweet,
        tweetTitle: tweetTitle || null,
        twitterUsername: tweetDetail.authorUsername || locked.twitterUsername || null,
      }, { transaction });
      return { before, submission: serializeSubmission(locked) };
    });
  } catch (error) {
    if (error?.name === "SequelizeUniqueConstraintError") {
      throw submissionError(
        "TWEET_ALREADY_SUBMITTED",
        409,
        "该用户已经向这个榜单提交过这条推文"
      );
    }
    throw error;
  }
}

module.exports = {
  submissionError,
  normalizeTweetSubmissionConfig,
  getTweetSubmissionLeaderboards,
  createTweetSubmission,
  getUserTweetSubmissions,
  listExternalTweetSubmissions,
  replaceTweetSubmission,
};
