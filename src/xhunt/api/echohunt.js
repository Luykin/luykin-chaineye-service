const express = require("express");
const axios = require("axios");
const { Op } = require("sequelize");
const {
  pgInstance,
  XHuntUser,
  CampaignRegistration,
  XHuntWebsiteCampaign,
  XHuntKolCollaboration,
  AuthCenterXhuntUser,
  AuthCenterXhuntIdentity,
  AuthCenterXhuntPasswordCredential,
  AuthCenterXhuntClient,
  AuthCenterXhuntSession,
  AuthCenterXhuntAuditLog,
} = require("../../models/postgres-start");
const {
  PROVIDERS,
  findActiveClient,
  upsertOAuthIdentityLogin,
  loadUserIdentities,
  createAuditLog,
} = require("../auth-center/services/auth");
const { createSessionAndToken, refreshSessionToken } = require("../auth-center/services/token");
const { buildPublicUser } = require("../auth-center/services/display-name");
const { authenticateAuthCenterToken } = require("../auth-center/middleware/auth");
const { isRequestXHuntVip, isRequestInternalTestUser } = require("../constants/xhuntVip");
const {
  generateEchohuntTwitterAuthUrl,
  getEchohuntTwitterTokens,
  getEchohuntTwitterUserInfo,
} = require("../services/twitter-echohunt");
const {
  buildCampaignListItem,
  buildCampaignDetail,
  buildPluginCampaign,
} = require("../services/websiteCampaignService");
const {
  getStaticLeaderboardManifest,
  getStaticLeaderboardBundle,
  emptyLeaderboardBundle,
  buildCustomLeaderboardBundle,
  findUserInBundle,
  findUserHistoricalCampaigns,
} = require("../services/echohuntLeaderboardService");
const {
  normalizeRegistrationContact,
  loadCampaignConfigForRegistration,
  registerCampaignParticipant,
  fetchCampaignRankByDomain,
} = require("../services/campaignRegistrationService");
const {
  getCustomLeaderboardData,
  getCustomUserActivityData,
  isYziLabsCampaign,
} = require("../services/campaignLeaderboardService");
const {
  createBindingChallenge,
  getBindingStatus,
  verifyBindingPost,
  revokeBinding,
  getBinanceSquareBindingErrorMessage,
} = require("../services/binanceSquareBindingService");
const echohuntKolMatchRoutes = require("./echohunt-kol-match");
const router = express.Router();

router.use("/kol-match", echohuntKolMatchRoutes);

const ECHOHUNT_CLIENT_KEY = process.env.ECHOHUNT_AUTH_CLIENT_KEY || "echohunt";
const ECHOHUNT_OAUTH_STATE_TTL_SECONDS = 8 * 60;
const authModels = {
  pgInstance,
  AuthCenterXhuntUser,
  AuthCenterXhuntIdentity,
  AuthCenterXhuntPasswordCredential,
  AuthCenterXhuntClient,
  AuthCenterXhuntSession,
  AuthCenterXhuntAuditLog,
  XHuntUser,
};

function getRequestLanguage(req) {
  return normalizeLang(
    req?.query?.lang ||
      req?.query?.["x-language"] ||
      req?.headers?.["x-echohunt-language"] ||
      req?.headers?.["accept-language"]
  );
}

function getLocalizedPublicMessage(error, fallback, req) {
  const lang = getRequestLanguage(req);
  const code = error.message || fallback;
  if (error.publicMessages?.[lang]) return error.publicMessages[lang];
  const binanceSquareMessage = getBinanceSquareBindingErrorMessage(code, lang);
  if (binanceSquareMessage) return binanceSquareMessage;
  return error.publicMessage || undefined;
}

function sendError(res, error, fallback = "ECHOHUNT_ERROR", extra = {}) {
  const status = error.status || 500;
  return res.status(status).json({
    success: false,
    error: error.message || fallback,
    message: getLocalizedPublicMessage(error, fallback, res.req),
    ...extra,
  });
}

function publicError(message, status = 400, publicMessage) {
  const err = new Error(message);
  err.status = status;
  if (publicMessage) err.publicMessage = publicMessage;
  return err;
}

function normalizeLang(value) {
  const raw = String(value || "").trim().toLowerCase();
  const primary = raw.split(",")[0].split(";")[0].trim();
  if (primary === "en" || primary.startsWith("en-")) return "en";
  if (primary === "zh" || primary.startsWith("zh-") || primary === "cn") return "zh-CN";
  return "zh-CN";
}

function normalizeUpstreamLang(value) {
  return normalizeLang(value) === "en" ? "en" : "zh";
}

function normalizeCampaign(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw.trim();
}

function normalizeTesterHandle(value) {
  if (Array.isArray(value)) return normalizeTesterHandle(value[0]);
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/^@+/, "").toLowerCase();
}

function isCampaignTester(campaign, viewer) {
  if (!campaign || !viewer) return false;
  const list = Array.isArray(campaign.testList) ? campaign.testList : [];
  const requestIdentifiers = [viewer.username, viewer.twitterId]
    .map(normalizeTesterHandle)
    .filter(Boolean);
  if (!requestIdentifiers.length) return false;
  return list.some((item) => requestIdentifiers.includes(normalizeTesterHandle(item)));
}

function getTwitterIdentityFromAuth(req) {
  const identities = req.authCenter?.identities || [];
  const twitter = identities.find((item) => item.provider === PROVIDERS.TWITTER);
  if (!twitter) return null;
  return {
    twitterId: String(twitter.providerSubject || "").trim(),
    username: twitter.username || null,
    displayName: twitter.displayName || twitter.username || null,
    avatar: twitter.avatar || null,
    authCenterUserId: req.authCenter?.user?.id || null,
    xhuntUserId: req.authCenter?.user?.xhuntUserId || null,
  };
}

async function getViewerTwitterIdForLeaderboard(req) {
  const twitterIdentity = getTwitterIdentityFromAuth(req);
  let twitterId = twitterIdentity?.twitterId || "";
  if (req.authCenter?.user?.xhuntUserId) {
    const xhuntUser = await XHuntUser.findByPk(req.authCenter.user.xhuntUserId, {
      attributes: ["twitterId"],
    }).catch(() => null);
    twitterId = xhuntUser?.twitterId || twitterId;
  }
  return String(twitterId || "").trim();
}

function buildNotRankedCampaignRank(record, campaignKey) {
  const row = typeof record?.toJSON === "function" ? record.toJSON() : (record || {});
  const title = row.displayNameEn || row.displayNameZh || campaignKey || null;
  return {
    campaignKey: campaignKey || null,
    title,
    project: title,
    status: row.webStatus || null,
    prize: null,
    tracks: [],
    winners: [],
    bestRank: null,
    estimatedRewards: [],
    rankStatus: "not_ranked",
    rankMessage: "USER_NOT_RANKED",
    notRanked: true,
  };
}

async function checkEchohuntBindingRateLimit(req, action, limit, ttlSeconds) {
  const twitterIdentity = getTwitterIdentityFromAuth(req);
  const keySubject = twitterIdentity?.twitterId || req.authCenter?.user?.id || req.ip || "unknown";
  const key = `echohunt:bs-binding:rl:${action}:${keySubject}`;
  const redis = req.redisClient;
  if (!redis?.incr) return;
  const count = await redis.incr(key).catch(() => 0);
  if (count === 1 && redis.expire) {
    await redis.expire(key, ttlSeconds).catch(() => {});
  }
  if (count > limit) {
    throw publicError("RATE_LIMITED", 429, "操作太频繁，请稍后再试。");
  }
}

function serializeRegistration(record) {
  if (!record) return null;
  const json = typeof record.toJSON === "function" ? record.toJSON() : record;
  const { xHuntUserId: _omit, authCenterUserId: _auth, registrationMetadata: metadata, ...safe } = json;
  return {
    ...safe,
    authCenterUserId: _auth || null,
    registrationMetadata: metadata || null,
  };
}

function buildEchohuntUserPayload(authUser, xhuntUser, twitterIdentity = null) {
  return {
    id: authUser?.id || null,
    xhuntUserId: xhuntUser?.id || authUser?.xhuntUserId || null,
    twitterId: twitterIdentity?.twitterId || authUser?.primaryTwitterId || xhuntUser?.twitterId || null,
    username: twitterIdentity?.username || xhuntUser?.username || null,
    displayName: twitterIdentity?.displayName || xhuntUser?.displayName || null,
    avatar: twitterIdentity?.avatar || xhuntUser?.avatar || authUser?.avatar || null,
    userSource: xhuntUser?.userSource || null,
  };
}

function normalizeCollaborationTelegram(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  let username = raw.replace(/^@+/, "");
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const host = url.hostname.replace(/^www\./i, "").toLowerCase();
      if (!["t.me", "telegram.me"].includes(host)) {
        throw publicError("COLLABORATION_TELEGRAM_INVALID", 400, "Telegram 格式不正确。");
      }
      username = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "").replace(/^@+/, "");
    } catch (error) {
      if (error.status) throw error;
      throw publicError("COLLABORATION_TELEGRAM_INVALID", 400, "Telegram 格式不正确。");
    }
  }

  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    throw publicError("COLLABORATION_TELEGRAM_INVALID", 400, "Telegram 格式不正确。");
  }
  return `@${username}`;
}

function normalizeCollaborationEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) return null;
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw publicError("COLLABORATION_EMAIL_INVALID", 400, "Email 格式不正确。");
  }
  return email;
}

function normalizeCollaborationCurrency(value, fallback = "USDT") {
  const currency = String(value || fallback).trim().toUpperCase();
  if (!["USDT", "USD"].includes(currency)) {
    throw publicError("COLLABORATION_CURRENCY_INVALID", 400, "报价币种不支持。");
  }
  return currency;
}

function normalizeCollaborationPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().replace(/,/g, "");
  if (!text) return null;
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(text) || Number(text) <= 0) {
    throw publicError("COLLABORATION_PRICE_INVALID", 400, "报价必须大于 0，且最多保留两位小数。");
  }
  const [integerPart, decimalPart = ""] = text.split(".");
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "") || "0";
  return `${normalizedInteger}.${decimalPart.padEnd(2, "0")}`;
}

function normalizeKolCollaborationPayload(body = {}) {
  if (typeof body.acceptingNewInvitations !== "boolean") {
    throw publicError("COLLABORATION_STATUS_REQUIRED", 400, "请设置是否接受邀约。");
  }

  const telegram = normalizeCollaborationTelegram(body.telegram);
  const email = normalizeCollaborationEmail(body.email);
  if (body.acceptingNewInvitations && !telegram && !email) {
    throw publicError("COLLABORATION_CONTACT_REQUIRED", 400, "接受邀约时，Telegram 和 Email 至少填写一项。");
  }

  return {
    acceptingNewInvitations: body.acceptingNewInvitations,
    telegram,
    email,
    shortPostPrice: normalizeCollaborationPrice(body.shortPostPrice),
    shortPostCurrency: normalizeCollaborationCurrency(body.shortPostCurrency),
    threadPrice: normalizeCollaborationPrice(body.threadPrice),
    threadCurrency: normalizeCollaborationCurrency(body.threadCurrency),
  };
}

function serializeKolCollaboration(record) {
  if (!record) return null;
  const json = typeof record.toJSON === "function" ? record.toJSON() : record;
  return {
    id: json.id,
    status: json.acceptingNewInvitations ? "ACTIVE" : "PAUSED",
    acceptingNewInvitations: !!json.acceptingNewInvitations,
    telegram: json.telegram || null,
    email: json.email || null,
    shortPostPrice: json.shortPostPrice === null || json.shortPostPrice === undefined ? null : String(json.shortPostPrice),
    shortPostCurrency: json.shortPostCurrency || "USDT",
    threadPrice: json.threadPrice === null || json.threadPrice === undefined ? null : String(json.threadPrice),
    threadCurrency: json.threadCurrency || "USDT",
    twitterId: json.twitterId || null,
    twitterUsername: json.twitterUsername || null,
    createdAt: json.createdAt || null,
    updatedAt: json.updatedAt || null,
  };
}

function mergeSourceMetadata(current, patch) {
  const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  return {
    ...base,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

async function ensureXHuntUserForEchohunt(twitterProfile, options = {}) {
  const twitterId = String(twitterProfile?.id || twitterProfile?.twitterId || "").trim();
  if (!twitterId) throw publicError("TWITTER_ID_REQUIRED", 400);

  const username = twitterProfile.username || null;
  const displayName = twitterProfile.name || twitterProfile.displayName || username || null;
  const avatar = twitterProfile.profile_image_url || twitterProfile.avatar || null;
  const transaction = options.transaction || null;

  let user = await XHuntUser.findOne({ where: { twitterId }, transaction });
  if (!user) {
    try {
      user = await XHuntUser.create(
        {
          twitterId,
          username,
          displayName,
          avatar,
          userSource: "echohunt_web",
          createdFromClient: "echohunt",
          lastLoginClient: "echohunt",
          sourceMetadata: {
            firstEchohuntLoginAt: new Date().toISOString(),
            echohuntAuthCenterUserId: options.authCenterUserId || null,
          },
        },
        { transaction }
      );
      return user;
    } catch (error) {
      // 并发登录时可能已由另一个请求创建，回读即可。
      user = await XHuntUser.findOne({ where: { twitterId }, transaction });
      if (!user) throw error;
    }
  }

  const currentSource = user.userSource || "extension";
  const nextSource = currentSource === "echohunt_web" ? "echohunt_web" : "mixed";
  await user.update(
    {
      username: username || user.username,
      displayName: displayName || user.displayName,
      avatar: avatar || user.avatar,
      userSource: nextSource,
      lastLoginClient: "echohunt",
      sourceMetadata: mergeSourceMetadata(user.sourceMetadata, {
        lastEchohuntLoginAt: new Date().toISOString(),
        echohuntAuthCenterUserId: options.authCenterUserId || null,
      }),
    },
    { transaction }
  );
  return user;
}

async function findCampaignRecord(identifier) {
  const key = normalizeCampaign(identifier);
  if (!key) return null;
  // EchoHunt 详情/榜单要兼容原网站活动接口的数据口径：
  // 只排除 draft/archived，不额外按 isDeleted 过滤，避免历史网站专属活动被漏掉。
  return XHuntWebsiteCampaign.findOne({
    where: {
      webStatus: { [Op.notIn]: ["draft", "archived"] },
      [Op.or]: [{ campaignKey: key }, { slug: key }, { nacosCampaignId: key }],
    },
  });
}

function isViewerAllowedForTesting(pluginCampaign, viewer) {
  if (!pluginCampaign?.testingPhase) return true;
  // EchoHunt 测试活动只按活动自身 testList 放行。
  // 这里故意不再判断 internal_test，避免 testList 中的正式测试用户看不到活动。
  return isCampaignTester(pluginCampaign, viewer);
}

function localizeTextValue(value, lang, fallback = "") {
  if (!value) return fallback;
  if (typeof value === "string") return value || fallback;
  if (typeof value === "object") {
    if (lang === "en") return value.en || value.zh || value["zh-CN"] || value.zh_cn || fallback;
    return value.zh || value["zh-CN"] || value.zh_cn || value.en || fallback;
  }
  return fallback;
}

function localizeTaskTitle(title, lang) {
  return localizeTextValue(title, lang, "");
}

function summarizeCustomLeaderboards(list, lang = "zh-CN") {
  return (Array.isArray(list) ? list : []).map((item, index) => {
    const id = String(item.id || item.distributionType || `custom-${index}`).trim() || `custom-${index}`;
    const name = localizeTextValue(item.name, lang, id);
    const shortName = localizeTextValue(item.short_name, lang, name);
    return {
      id,
      name,
      short_name: shortName,
      amount: item.amount ?? null,
      participantCount: item.participantCount ?? null,
      distributionType: item.distributionType || null,
      unit: item.unit || null,
    };
  });
}

function buildCustomLeaderboardTrackSummaries(pluginCampaign, lang = "zh-CN") {
  if (pluginCampaign?.leaderboardMode !== "custom") return [];
  return summarizeCustomLeaderboards(pluginCampaign.customLeaderboards, lang).map((item) => ({
    id: item.id,
    type: "leaderboard",
    title: item.name || item.id,
    shortTitle: item.short_name || item.name || item.id,
    sourceKey: item.id,
    winnerKey: null,
    reward: item.amount === null || item.amount === undefined || item.amount === "" ? null : `${item.amount}${item.unit ? ` ${item.unit}` : ""}`,
    counts: {},
  }));
}

function buildRewardSummary(pluginCampaign, lang = "zh-CN") {
  return {
    poi: {
      amount: pluginCampaign.rewardAmount ?? null,
      unit: pluginCampaign.rewardUnit || null,
      participantCount: pluginCampaign.rewardParticipantCount ?? null,
      distributionType: pluginCampaign.rewardDistributionType || null,
    },
    pow: pluginCampaign.enablePowLeaderboard
      ? {
          amount: pluginCampaign.powAmount ?? null,
          unit: pluginCampaign.powUnit || null,
          participantCount: pluginCampaign.powWinnerCount ?? null,
          distributionType: pluginCampaign.powDistributionType || null,
        }
      : null,
    content: pluginCampaign.enableEssayContest
      ? {
          amount: pluginCampaign.essayContestAmount ?? null,
          unit: pluginCampaign.essayContestUnit || null,
          participantCount: pluginCampaign.essayContestWinnerCount ?? null,
        }
      : null,
    custom: summarizeCustomLeaderboards(pluginCampaign.customLeaderboards, lang),
  };
}

function buildEchohuntCampaignListItem(record, lang, viewer) {
  const base = buildCampaignListItem(record, lang);
  const plugin = buildPluginCampaign(record, { channel: "echohunt" });
  return {
    ...base,
    testingPhase: !!plugin.testingPhase,
    viewerCanSeeTesting: !!plugin.testingPhase && isViewerAllowedForTesting(plugin, viewer),
    displayDomains: plugin.displayDomains || ["web3"],
    tags: Array.isArray(plugin.tags) ? plugin.tags : [],
    registrationConfig: {
      allowEmailRegistration: plugin.allowEmailRegistration === true,
      threshold: plugin.threshold ?? null,
      includeCreator: !!plugin.includeCreator,
    },
    leaderboardConfig: {
      leaderboardMode: plugin.leaderboardMode || "traditional",
      enablePowLeaderboard: !!plugin.enablePowLeaderboard,
      enableEssayContest: !!plugin.enableEssayContest,
      leaderboardApiUrl: plugin.leaderboardApiUrl || null,
      userActivityApiUrl: plugin.userActivityApiUrl || null,
      mockCustomLeaderboardDataEnabled: plugin.mockCustomLeaderboardDataEnabled === true,
      customLeaderboards: summarizeCustomLeaderboards(plugin.customLeaderboards, lang),
    },
    rewardSummary: buildRewardSummary(plugin, lang),
    leaderboardTracks: buildCustomLeaderboardTrackSummaries(plugin, lang),
    guideUrl: record.guideUrl || null,
    activeUrl: record.activeUrl || null,
    tasksSummary: (Array.isArray(plugin.tasks) ? plugin.tasks : []).map((task) => ({
      id: task.id,
      type: task.type,
      title: localizeTaskTitle(task.title, lang),
      url: task.url || null,
      autoComplete: !!task.autoComplete,
    })),
  };
}

function mergeStaticLeaderboardSummary(item, staticCampaign) {
  if (!item || !staticCampaign?.dataUrl) return item;
  return {
    ...item,
    leaderboardSummary: staticCampaign.summary || null,
    leaderboardTracks: Array.isArray(staticCampaign.tracks) ? staticCampaign.tracks : [],
    leaderboardDataUrl: staticCampaign.dataUrl || null,
    hasStaticLeaderboardData: true,
  };
}

function isCampaignEffectivelyEnded(item) {
  if (!item) return false;
  if (item.status === "ended" || item.webStatus === "ended") return true;
  if (!item.endAt) return false;
  const endAt = new Date(item.endAt).getTime();
  return Number.isFinite(endAt) && endAt <= Date.now();
}

function collectBundleLeaderboardRows(bundle) {
  const rows = [];
  const leaderboards = bundle?.leaderboards?.all || bundle?.leaderboards || {};
  if (!leaderboards || typeof leaderboards !== "object") return rows;
  Object.values(leaderboards).forEach((value) => {
    if (Array.isArray(value)) rows.push(...value);
  });
  return rows;
}

function parseMetricNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(typeof value === "string" ? value.replace(/,/g, "") : value);
  return Number.isFinite(num) ? num : null;
}

function getFirstMetricValue(sources, keys) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      const value = source[key];
      if (parseMetricNumber(value) !== null) return value;
    }
  }
  return null;
}

function extractRawLeaderboardSummary(rawResponse) {
  const raw = rawResponse?.raw && typeof rawResponse.raw === "object" ? rawResponse.raw : rawResponse;
  const sources = [
    rawResponse,
    rawResponse?.summary,
    rawResponse?.stats,
    rawResponse?.data,
    rawResponse?.data?.summary,
    rawResponse?.data?.stats,
    rawResponse?.data?.data,
    rawResponse?.data?.data?.summary,
    rawResponse?.data?.data?.stats,
    raw,
    raw?.summary,
    raw?.stats,
    raw?.data,
    raw?.data?.summary,
    raw?.data?.stats,
    raw?.data?.data,
    raw?.data?.data?.summary,
    raw?.data?.data?.stats,
  ];

  return {
    participants: getFirstMetricValue(sources, [
      "participants",
      "hunters",
      "totalHunters",
      "total_hunters",
      "participantCount",
      "participant_count",
      "userCount",
      "user_count",
      "totalUsers",
      "total_users",
    ]),
    tweets: getFirstMetricValue(sources, [
      "tweets",
      "totalTweets",
      "total_tweets",
      "tweetCount",
      "tweet_count",
      "posts",
      "totalPosts",
      "total_posts",
    ]),
    views: getFirstMetricValue(sources, [
      "views",
      "totalViews",
      "total_views",
      "viewCount",
      "view_count",
      "impressions",
      "totalImpressions",
      "total_impressions",
    ]),
    engagement: getFirstMetricValue(sources, [
      "engagement",
      "totalEngagement",
      "total_engagement",
      "interactions",
      "totalInteractions",
      "total_interactions",
      "likes",
      "totalLikes",
      "total_likes",
      "likeCount",
      "like_count",
    ]),
    bridges: getFirstMetricValue(sources, ["bridges", "totalBridges", "total_bridges", "bridgeCount", "bridge_count"]),
    updatedAt:
      rawResponse?.leaderboardDataUpdatedAt ||
      rawResponse?.updatedAt ||
      rawResponse?.data?.leaderboardDataUpdatedAt ||
      rawResponse?.data?.updatedAt ||
      rawResponse?.data?.data?.leaderboardDataUpdatedAt ||
      rawResponse?.data?.data?.updatedAt ||
      raw?.leaderboardDataUpdatedAt ||
      raw?.updatedAt ||
      raw?.data?.leaderboardDataUpdatedAt ||
      raw?.data?.updatedAt ||
      raw?.data?.data?.leaderboardDataUpdatedAt ||
      raw?.data?.data?.updatedAt ||
      null,
  };
}

function summarizeLeaderboardBundle(bundle, rawResponse = null) {
  const base = bundle?.summary && typeof bundle.summary === "object" ? bundle.summary : {};
  const rawSummary = extractRawLeaderboardSummary(rawResponse);
  const rows = collectBundleLeaderboardRows(bundle);
  const userKeys = new Set();
  rows.forEach((row) => {
    const key = row?.twitterId || row?.twitter_id || row?.user_id || row?.username || row?.handle;
    if (key) userKeys.add(String(key).trim().toLowerCase());
  });

  const countFromTracks = (Array.isArray(bundle?.tracks) ? bundle.tracks : []).reduce((max, track) => {
    const allCount = Number(track?.counts?.all);
    return Number.isFinite(allCount) ? Math.max(max, allCount) : max;
  }, 0);

  const sumRows = (fieldNames) => {
    const values = rows
      .map((row) => fieldNames.map((field) => Number(row?.[field])).find((value) => Number.isFinite(value)))
      .filter((value) => Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const pickPositiveNumber = (value, fallback) => {
    const num = parseMetricNumber(value);
    return Number.isFinite(num) && num > 0 ? value : fallback;
  };

  return {
    participants: pickPositiveNumber(rawSummary.participants ?? base.participants, userKeys.size || countFromTracks || rows.length || 0),
    tweets: pickPositiveNumber(rawSummary.tweets ?? base.tweets, sumRows(["tweets", "tweet_count"])),
    views: pickPositiveNumber(rawSummary.views ?? base.views, sumRows(["views", "view_count"])),
    engagement: pickPositiveNumber(rawSummary.engagement ?? base.engagement, sumRows(["engagement", "likes", "like_count"])),
    bridges: rawSummary.bridges ?? base.bridges ?? null,
    updatedAt: rawSummary.updatedAt || base.updatedAt || bundle?.leaderboardDataUpdatedAt || bundle?.updatedAt || bundle?.generatedAt || null,
  };
}

function mergeDynamicLeaderboardSummary(item, bundle, rawResponse = null) {
  if (!item || !bundle) return item;
  return {
    ...item,
    leaderboardSummary: summarizeLeaderboardBundle(bundle, rawResponse),
    leaderboardTracks: Array.isArray(bundle.tracks) ? bundle.tracks : [],
    leaderboardDataUrl: null,
    hasStaticLeaderboardData: false,
    leaderboardDataSource: "configured_custom",
  };
}

async function mergeDynamicEndedLeaderboardSummary(item, options = {}) {
  if (!isCampaignEffectivelyEnded(item)) return item;
  if (item?.leaderboardConfig?.leaderboardMode !== "custom") return item;

  try {
    const rawLeaderboard = await getCustomLeaderboardData(item, {
      campaign: item.campaignKey || item.slug || item.nacosCampaignId,
      channel: "echohunt",
      viewerTwitterId: options.viewerTwitterId || "",
    });
    const bundle = buildCustomLeaderboardBundle(item, rawLeaderboard);
    return mergeDynamicLeaderboardSummary(item, bundle, rawLeaderboard);
  } catch (error) {
    console.warn("[EchoHunt] ended campaign dynamic leaderboard summary fetch warn:", error.message || error);
    return item;
  }
}

function getCustomActivityTrackId(campaign) {
  const customLeaderboards = Array.isArray(campaign?.leaderboardConfig?.customLeaderboards)
    ? campaign.leaderboardConfig.customLeaderboards
    : [];
  const first = customLeaderboards[0] || null;
  return String(first?.id || first?.distributionType || "custom-0").trim() || "custom-0";
}

function ensureUserIdentityOnActivityRow(row, user) {
  if (!row || typeof row !== "object") return row;
  const hasIdentity =
    row.twitterId ||
    row.twitter_id ||
    row.user_id ||
    row.username ||
    row.handler ||
    row.handle ||
    row.screen_name;
  if (hasIdentity) return row;
  return {
    ...row,
    twitterId: user?.twitterId || null,
    username: user?.username || null,
  };
}

function normalizeCustomUserActivityForBundle(campaign, rawActivity, user) {
  const source = rawActivity?.leaderboards && typeof rawActivity.leaderboards === "object"
    ? rawActivity.leaderboards
    : {};
  const leaderboards = {};

  Object.entries(source).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      leaderboards[key] = value.map((row) => ensureUserIdentityOnActivityRow(row, user));
      return;
    }
    if (value && typeof value === "object") {
      const rows = Array.isArray(value.items)
        ? value.items
        : Array.isArray(value.rows)
          ? value.rows
          : [value];
      leaderboards[key] = rows.map((row) => ensureUserIdentityOnActivityRow(row, user));
    }
  });

  if (!Object.keys(leaderboards).length && rawActivity && typeof rawActivity === "object" && rawActivity.rank !== undefined) {
    leaderboards[getCustomActivityTrackId(campaign)] = [ensureUserIdentityOnActivityRow(rawActivity, user)];
  }

  return {
    ...rawActivity,
    leaderboards,
  };
}

async function fetchCustomCampaignHistoryFromInterfaces(campaign, user, campaignKey) {
  if (campaign?.leaderboardConfig?.leaderboardMode !== "custom") return null;

  const userActivityUserId = user?.username || user?.twitterId || "";
  if (campaign.leaderboardConfig.userActivityApiUrl || isYziLabsCampaign(campaignKey)) {
    try {
      const rawActivity = await getCustomUserActivityData(campaign, userActivityUserId, {
        campaign: campaignKey,
        channel: "echohunt",
        twitterId: user?.twitterId,
        username: user?.username,
      });
      const activityBundle = buildCustomLeaderboardBundle(
        campaign,
        normalizeCustomUserActivityForBundle(campaign, rawActivity, user)
      );
      const found = findUserInBundle(activityBundle, user);
      if (found) return found;
    } catch (activityError) {
      console.warn("[EchoHunt] custom user activity fetch warn:", activityError.message || activityError);
    }
  }

  try {
    const rawLeaderboard = await getCustomLeaderboardData(campaign, {
      campaign: campaignKey,
      channel: "echohunt",
      viewerTwitterId: user?.twitterId,
    });
    const customBundle = buildCustomLeaderboardBundle(campaign, rawLeaderboard);
    return findUserInBundle(customBundle, user);
  } catch (customError) {
    console.warn("[EchoHunt] custom campaign rank fetch warn:", customError.message || customError);
    return null;
  }
}

function normalizeHistoryKey(value) {
  return String(value || "").trim().toLowerCase();
}

function getHistoryDedupKeys(item) {
  return [item?.campaignKey, item?.slug, item?.nacosCampaignId]
    .map(normalizeHistoryKey)
    .filter(Boolean);
}

function addHistoricalCampaignToMap(map, item) {
  if (!item) return;
  const keys = getHistoryDedupKeys(item);
  const existingKey = keys.find((key) => map.has(key));
  if (existingKey) {
    const existing = map.get(existingKey);
    const existingTrackCount = (existing?.tracks || []).length + (existing?.winners || []).length;
    const nextTrackCount = (item?.tracks || []).length + (item?.winners || []).length;
    // 同一个活动同时存在静态和接口数据时，优先保留信息更完整的结果。
    if (nextTrackCount > existingTrackCount) {
      keys.forEach((key) => map.set(key, item));
    }
    return;
  }
  if (keys.length) {
    keys.forEach((key) => map.set(key, item));
    return;
  }
  map.set(`unknown:${map.size}`, item);
}

function getHistoricalCampaignSortTime(item) {
  const candidates = [item?.endAt, item?.startAt];
  for (const value of candidates) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function sortHistoricalCampaigns(items) {
  return [...items].sort((a, b) => {
    const timeDiff = getHistoricalCampaignSortTime(b) - getHistoricalCampaignSortTime(a);
    if (timeDiff) return timeDiff;
    return String(a?.title || a?.campaignKey || "").localeCompare(String(b?.title || b?.campaignKey || ""));
  });
}

function mergeHistoricalCampaignSources(...sources) {
  const map = new Map();
  sources.flat().forEach((item) => addHistoricalCampaignToMap(map, item));
  return sortHistoricalCampaigns(Array.from(new Set(map.values())));
}

function shouldFetchDynamicCampaignHistory(campaign, campaignKey) {
  if (campaign?.leaderboardConfig?.leaderboardMode !== "custom") return false;
  const config = campaign.leaderboardConfig || {};
  return !!(
    config.userActivityApiUrl ||
    config.leaderboardApiUrl ||
    config.mockCustomLeaderboardDataEnabled ||
    isYziLabsCampaign(campaignKey)
  );
}

async function findUserDynamicCampaignHistories(user, options = {}) {
  const lang = options.lang || "zh-CN";
  const viewer = user ? { username: user.username, twitterId: user.twitterId } : null;

  const records = await XHuntWebsiteCampaign.findAll({
    where: {
      webStatus: { [Op.notIn]: ["draft", "archived"] },
    },
  });

  const candidates = records
    .map((record) => ({
      record,
      campaign: buildEchohuntCampaignListItem(record, lang, viewer),
      plugin: buildPluginCampaign(record, { channel: "echohunt" }),
    }))
    .filter(({ campaign, plugin }) => {
      if (plugin.testingPhase && (!viewer || !isViewerAllowedForTesting(plugin, viewer))) return false;
      const campaignKey = campaign.campaignKey || campaign.slug || campaign.nacosCampaignId;
      return shouldFetchDynamicCampaignHistory(campaign, campaignKey);
    });

  const settled = await Promise.allSettled(
    candidates.map(async ({ campaign }) => {
      const campaignKey = campaign.campaignKey || campaign.slug || campaign.nacosCampaignId;
      return fetchCustomCampaignHistoryFromInterfaces(campaign, user, campaignKey);
    })
  );

  return settled
    .map((result, index) => {
      if (result.status === "fulfilled") return result.value;
      const campaignKey = candidates[index]?.campaign?.campaignKey || candidates[index]?.campaign?.slug || "unknown";
      console.warn("[EchoHunt] dynamic historical campaign fetch warn:", campaignKey, result.reason?.message || result.reason);
      return null;
    })
    .filter(Boolean);
}

function buildEchohuntCampaignDetail(record, lang) {
  const detail = buildCampaignDetail(record, lang);
  const plugin = buildPluginCampaign(record, { channel: "echohunt" });
  const listAssets = detail.websiteExtra && typeof detail.websiteExtra === "object" && detail.websiteExtra.listAssets && typeof detail.websiteExtra.listAssets === "object"
    ? detail.websiteExtra.listAssets
    : {};
  return {
    ...detail,
    echohuntHeroImage: listAssets.echohuntHeroImage || null,
    testingPhase: !!plugin.testingPhase,
    displayDomains: plugin.displayDomains || ["web3"],
    tags: Array.isArray(plugin.tags) ? plugin.tags : [],
    tasks: (Array.isArray(plugin.tasks) ? plugin.tasks : []).map((task) => ({
      id: task.id,
      type: task.type,
      title: localizeTaskTitle(task.title, lang),
      url: task.url || null,
      autoComplete: !!task.autoComplete,
    })),
    registration: {
      open: detail.webStatus === "live" || detail.webStatus === "coming_soon",
      allowEmailRegistration: plugin.allowEmailRegistration === true,
      threshold: plugin.threshold ?? null,
      includeCreator: !!plugin.includeCreator,
    },
    leaderboardConfig: {
      leaderboardMode: plugin.leaderboardMode || "traditional",
      enablePowLeaderboard: !!plugin.enablePowLeaderboard,
      enableEssayContest: !!plugin.enableEssayContest,
      leaderboardApiUrl: plugin.leaderboardApiUrl || null,
      userActivityApiUrl: plugin.userActivityApiUrl || null,
      mockCustomLeaderboardDataEnabled: plugin.mockCustomLeaderboardDataEnabled === true,
      customLeaderboards: summarizeCustomLeaderboards(plugin.customLeaderboards, lang),
    },
    rewardSummary: buildRewardSummary(plugin, lang),
  };
}

async function fetchEchohuntRankSummary(twitterId) {
  const domains = ["web3", "ai"];
  const settled = await Promise.allSettled(domains.map((domain) => fetchCampaignRankByDomain(domain, twitterId)));
  const byDomain = {};
  const errors = [];

  settled.forEach((result, index) => {
    const domain = domains[index];
    if (result.status === "fulfilled") {
      byDomain[domain] = result.value;
    } else {
      byDomain[domain] = null;
      errors.push({ domain, message: result.reason?.message || String(result.reason) });
    }
  });

  const creatorDomain = domains.find((domain) => byDomain[domain]?.isCreatorAuthed) || null;
  const creatorAuth = creatorDomain ? byDomain[creatorDomain].creatorAuth : null;

  return {
    domains: byDomain,
    web3: byDomain.web3 || null,
    ai: byDomain.ai || null,
    isCreatorAuthed: !!creatorDomain,
    creatorDomain,
    creatorAuth,
    errors,
  };
}

async function fetchTwitterProfile(twitterId, lang) {
  if (!twitterId) return null;
  const response = await axios.get("https://data.cryptohunt.ai/fetch/twitter/user", {
    params: { user_id: twitterId, "x-language": normalizeUpstreamLang(lang) },
    timeout: 8000,
  });
  return response?.data?.data?.data || null;
}

async function fetchSoulProfile(twitterId, lang) {
  if (!twitterId) return null;
  const response = await axios.get("https://data.cryptohunt.ai/pro/api/soul_by_user_id", {
    params: { user_id: twitterId, "x-language": normalizeUpstreamLang(lang) },
    timeout: 8000,
  });
  return response?.data || null;
}

function normalizeProfilePayload(raw) {
  if (!raw) return null;
  return {
    classification: raw.ai?.classification || null,
    isKol: raw.isKol ?? null,
    isCn: raw.ai?.is_cn ?? null,
    rank: raw.feature?.rank || null,
    rankAi: raw.feature?.rank_ai || null,
    raw,
  };
}

function normalizeSoulPayload(raw) {
  if (!raw || raw.score === undefined) return null;
  return {
    score: raw.score,
    contentAnalysis: raw.content_analysis ?? null,
    engagementAnalysis: raw.engagement_analysis ?? null,
    kolInteraction: raw.kol_interaction ?? null,
    profileAnalysis: raw.profile_analysis ?? null,
    xhuntAnalysis: raw.xhunt_analysis ?? null,
    reason: raw.reason || null,
    reasonEn: raw.reason_en || null,
    handle: raw.handle || null,
    name: raw.name || null,
  };
}

function buildSummaryFromHistorical(joinedCampaigns, historicalCampaigns) {
  const estimatedRewards = historicalCampaigns.flatMap((item) =>
    (item.estimatedRewards || []).map((reward) => ({
      ...reward,
      campaignKey: item.campaignKey,
      title: item.title,
      project: item.project,
    }))
  );
  return {
    joinedCampaigns,
    historicalCampaignRanks: historicalCampaigns.filter((item) => (item.tracks || []).length > 0).length,
    historicalWinnerCount: historicalCampaigns.reduce((sum, item) => sum + ((item.winners || []).length), 0),
    estimatedRewards,
  };
}

router.post("/auth/x/url", async (req, res) => {
  try {
    const returnUrl = typeof req.body?.returnUrl === "string" ? req.body.returnUrl.trim() : "";
    const { url, state } = await generateEchohuntTwitterAuthUrl(async (state, codeVerifier) => {
      await req.redisClient.setEx(
        `echohunt:x_oauth_state:${state}`,
        ECHOHUNT_OAUTH_STATE_TTL_SECONDS,
        JSON.stringify({
          codeVerifier,
          returnUrl,
          clientKey: ECHOHUNT_CLIENT_KEY,
          createdAt: Date.now(),
        })
      );
    });
    return res.json({ success: true, url, state });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_X_AUTH_URL_FAILED");
  }
});

router.post("/auth/x/callback", async (req, res) => {
  const transaction = await pgInstance.transaction();
  try {
    const { code, state } = req.body || {};
    if (!code || !state) throw publicError("CODE_AND_STATE_REQUIRED", 400);

    const cacheKey = `echohunt:x_oauth_state:${state}`;
    const raw = await req.redisClient.get(cacheKey);
    const cached = raw ? JSON.parse(raw) : null;
    if (!cached?.codeVerifier) throw publicError("INVALID_OR_EXPIRED_STATE", 400);
    await req.redisClient.del(cacheKey);

    const { accessToken, refreshToken, expiresIn } = await getEchohuntTwitterTokens(code, cached.codeVerifier);
    const twitterUser = await getEchohuntTwitterUserInfo(accessToken);

    const result = await upsertOAuthIdentityLogin(
      authModels,
      PROVIDERS.TWITTER,
      {
        providerSubject: twitterUser.id,
        providerSubjectLower: twitterUser.id,
        username: twitterUser.username,
        displayName: twitterUser.name,
        avatar: twitterUser.profile_image_url,
        accessToken,
        refreshToken,
        tokenExpiry: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      },
      transaction
    );

    const xhuntUser = await ensureXHuntUserForEchohunt(twitterUser, {
      transaction,
      authCenterUserId: result.user.id,
    });

    await result.user.update(
      {
        xhuntUserId: xhuntUser.id,
        primaryTwitterId: String(twitterUser.id),
        avatar: twitterUser.profile_image_url || result.user.avatar,
      },
      { transaction }
    );
    result.user.xhuntUserId = xhuntUser.id;

    await createAuditLog(authModels, req, {
      userId: result.user.id,
      clientKey: ECHOHUNT_CLIENT_KEY,
      eventType: "login_success",
      provider: PROVIDERS.TWITTER,
      success: true,
      metadata: { source: "echohunt" },
    });

    const client = await findActiveClient(authModels, ECHOHUNT_CLIENT_KEY);
    const tokenPayload = await createSessionAndToken({
      models: authModels,
      user: result.user,
      client,
      clientKey: ECHOHUNT_CLIENT_KEY,
      req,
      transaction,
    });
    const identities = await loadUserIdentities(authModels, result.user.id, transaction);

    await transaction.commit();
    return res.json({
      success: true,
      token: tokenPayload.token,
      user: {
        ...buildPublicUser(result.user, identities),
        ...buildEchohuntUserPayload(result.user, xhuntUser, {
          twitterId: twitterUser.id,
          username: twitterUser.username,
          displayName: twitterUser.name,
          avatar: twitterUser.profile_image_url,
        }),
        isNewUser: !!result.isNewUser,
      },
      isNewUser: !!result.isNewUser,
    });
  } catch (error) {
    await transaction.rollback();
    await createAuditLog(authModels, req, {
      clientKey: ECHOHUNT_CLIENT_KEY,
      eventType: "login_failed",
      provider: PROVIDERS.TWITTER,
      success: false,
      reason: error.message,
      metadata: { source: "echohunt" },
    });
    return sendError(res, error, "ECHOHUNT_X_CALLBACK_FAILED");
  }
});

router.post("/auth/token/refresh", async (req, res) => {
  try {
    const refreshToken = req.body?.refreshToken;
    if (!refreshToken) throw publicError("REFRESH_TOKEN_REQUIRED", 400);
    const result = await refreshSessionToken({ models: authModels, refreshToken, req });
    const twitterIdentity = (result.identities || []).find((item) => item.provider === PROVIDERS.TWITTER);
    const xhuntUser = result.user?.xhuntUserId ? await XHuntUser.findByPk(result.user.xhuntUserId) : null;
    return res.json({
      success: true,
      token: result.token,
      user: {
        ...buildPublicUser(result.user, result.identities),
        ...buildEchohuntUserPayload(result.user, xhuntUser, twitterIdentity ? {
          twitterId: twitterIdentity.providerSubject,
          username: twitterIdentity.username,
          displayName: twitterIdentity.displayName,
          avatar: twitterIdentity.avatar,
        } : null),
      },
    });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_TOKEN_REFRESH_FAILED");
  }
});

router.post("/auth/logout", authenticateAuthCenterToken(), async (req, res) => {
  try {
    await req.authCenter.session.update({ revokedAt: new Date(), revokeReason: "echohunt_logout" });
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_LOGOUT_FAILED");
  }
});

router.get("/me", authenticateAuthCenterToken(), async (req, res) => {
  try {
    const lang = normalizeLang(req.query.lang || req.query["x-language"]);
    const twitterIdentity = getTwitterIdentityFromAuth(req);
    if (!twitterIdentity?.twitterId) throw publicError("TWITTER_ID_REQUIRED", 400);

    let xhuntUser = req.authCenter.user.xhuntUserId ? await XHuntUser.findByPk(req.authCenter.user.xhuntUserId) : null;
    if (!xhuntUser) {
      xhuntUser = await ensureXHuntUserForEchohunt({
        id: twitterIdentity.twitterId,
        username: twitterIdentity.username,
        name: twitterIdentity.displayName,
        profile_image_url: twitterIdentity.avatar,
      }, { authCenterUserId: req.authCenter.user.id });
      await req.authCenter.user.update({ xhuntUserId: xhuntUser.id });
    }

    const historyIdentity = {
      ...twitterIdentity,
      twitterId: xhuntUser?.twitterId || twitterIdentity.twitterId,
      username: xhuntUser?.username || twitterIdentity.username,
    };

    const [profileResult, soulResult, staticHistoryResult, dynamicHistoryResult, joinedCountResult, rankSummaryResult] = await Promise.allSettled([
      fetchTwitterProfile(twitterIdentity.twitterId, lang),
      fetchSoulProfile(twitterIdentity.twitterId, lang),
      findUserHistoricalCampaigns(historyIdentity),
      findUserDynamicCampaignHistories(historyIdentity, { lang }),
      CampaignRegistration.count({ where: { twitterId: twitterIdentity.twitterId } }),
      fetchEchohuntRankSummary(twitterIdentity.twitterId),
    ]);

    const rawProfile = profileResult.status === "fulfilled" ? profileResult.value : null;
    const rawSoul = soulResult.status === "fulfilled" ? soulResult.value : null;
    const staticHistoricalCampaigns = staticHistoryResult.status === "fulfilled" ? staticHistoryResult.value : [];
    const dynamicHistoricalCampaigns = dynamicHistoryResult.status === "fulfilled" ? dynamicHistoryResult.value : [];
    const historicalCampaigns = mergeHistoricalCampaignSources(staticHistoricalCampaigns, dynamicHistoricalCampaigns);
    const joinedCampaigns = joinedCountResult.status === "fulfilled" ? joinedCountResult.value : 0;
    const profile = normalizeProfilePayload(rawProfile);
    const soul = normalizeSoulPayload(rawSoul);
    const rankSummary = rankSummaryResult.status === "fulfilled" ? rankSummaryResult.value : null;
    const isVip = isRequestXHuntVip(req);
    const isInternalTestUser = isRequestInternalTestUser(req);

    if (profile?.rank?.kolRank || profile?.classification) {
      xhuntUser.update({
        kolRank20W: profile.rank?.kolRank && Number(profile.rank.kolRank) > 0 ? parseInt(profile.rank.kolRank, 10) : xhuntUser.kolRank20W,
        classification: profile.classification || xhuntUser.classification,
      }).catch(() => {});
    }

    res.set("Cache-Control", "private, max-age=120");
    return res.json({
      success: true,
      user: {
        ...buildEchohuntUserPayload(req.authCenter.user, xhuntUser, twitterIdentity),
        isVip,
        isXHuntVip: isVip,
        isInternalTestUser,
      },
      profile: profile
        ? {
            ...profile,
            soul,
            ranks: rankSummary?.domains || null,
            isCreatorAuthed: !!rankSummary?.isCreatorAuthed,
            creatorAuth: rankSummary?.creatorAuth || null,
          }
        : {
            soul,
            ranks: rankSummary?.domains || null,
            isCreatorAuthed: !!rankSummary?.isCreatorAuthed,
            creatorAuth: rankSummary?.creatorAuth || null,
          },
      ranks: rankSummary,
      historicalCampaigns,
      summary: buildSummaryFromHistorical(joinedCampaigns, historicalCampaigns),
    });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_ME_FAILED");
  }
});

router.get("/me/collaboration", authenticateAuthCenterToken(), async (req, res) => {
  try {
    const twitterIdentity = getTwitterIdentityFromAuth(req);
    if (!twitterIdentity?.twitterId) throw publicError("TWITTER_ID_REQUIRED", 400, "请先使用 X 登录 EchoHunt。");

    const record = await XHuntKolCollaboration.findOne({
      where: {
        [Op.or]: [
          { authCenterUserId: req.authCenter.user.id },
          { twitterId: twitterIdentity.twitterId },
        ],
      },
      order: [["updatedAt", "DESC"]],
    });

    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: serializeKolCollaboration(record) });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_COLLABORATION_FAILED");
  }
});

router.put("/me/collaboration", authenticateAuthCenterToken(), async (req, res) => {
  try {
    const twitterIdentity = getTwitterIdentityFromAuth(req);
    if (!twitterIdentity?.twitterId) throw publicError("TWITTER_ID_REQUIRED", 400, "请先使用 X 登录 EchoHunt。");
    const payload = normalizeKolCollaborationPayload(req.body || {});

    const record = await pgInstance.transaction(async (transaction) => {
      const xhuntUser = await ensureXHuntUserForEchohunt(
        {
          id: twitterIdentity.twitterId,
          username: twitterIdentity.username,
          name: twitterIdentity.displayName,
          profile_image_url: twitterIdentity.avatar,
        },
        { authCenterUserId: req.authCenter.user.id, transaction }
      );

      if (!req.authCenter.user.xhuntUserId && xhuntUser?.id) {
        await req.authCenter.user.update({ xhuntUserId: xhuntUser.id }, { transaction });
      }

      const recordPayload = {
        ...payload,
        authCenterUserId: req.authCenter.user.id,
        xhuntUserId: xhuntUser?.id || req.authCenter.user.xhuntUserId || null,
        twitterId: twitterIdentity.twitterId,
        twitterUsername: twitterIdentity.username || null,
        metadata: {
          source: "echohunt_web",
          updatedBy: "kol_self",
        },
      };

      const existing = await XHuntKolCollaboration.findOne({
        where: {
          [Op.or]: [
            { authCenterUserId: req.authCenter.user.id },
            { twitterId: twitterIdentity.twitterId },
          ],
        },
        order: [["updatedAt", "DESC"]],
        transaction,
        lock: true,
      });

      if (existing) {
        await existing.update(recordPayload, { transaction });
        return existing;
      }

      return XHuntKolCollaboration.create(recordPayload, { transaction });
    }).catch(async (error) => {
      const code = error?.parent?.code || error?.original?.code || error?.code;
      if (code !== "23505") throw error;
      const existing = await XHuntKolCollaboration.findOne({
        where: {
          [Op.or]: [
            { authCenterUserId: req.authCenter.user.id },
            { twitterId: twitterIdentity.twitterId },
          ],
        },
        order: [["updatedAt", "DESC"]],
      });
      if (!existing) throw error;
      await existing.update({
        ...payload,
        authCenterUserId: req.authCenter.user.id,
        twitterId: twitterIdentity.twitterId,
        twitterUsername: twitterIdentity.username || null,
      });
      return existing;
    });

    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: serializeKolCollaboration(record) });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_COLLABORATION_FAILED");
  }
});

router.get("/binance-square-binding/me", authenticateAuthCenterToken(), async (req, res) => {
  try {
    const twitterIdentity = getTwitterIdentityFromAuth(req);
    if (!twitterIdentity?.twitterId) throw publicError("TWITTER_ID_REQUIRED", 400, "请先连接 Twitter 账号后再绑定 Binance Square。");
    const data = await getBindingStatus(twitterIdentity);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_BINANCE_SQUARE_BINDING_STATUS_FAILED");
  }
});

router.post("/binance-square-binding/challenge", authenticateAuthCenterToken(), async (req, res) => {
  try {
    await checkEchohuntBindingRateLimit(req, "challenge", 3, 60);
    const twitterIdentity = getTwitterIdentityFromAuth(req);
    if (!twitterIdentity?.twitterId) throw publicError("TWITTER_ID_REQUIRED", 400, "请先连接 Twitter 账号后再绑定 Binance Square。");
    const data = await createBindingChallenge(twitterIdentity);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_BINANCE_SQUARE_BINDING_CHALLENGE_FAILED");
  }
});

router.post("/binance-square-binding/verify", authenticateAuthCenterToken(), async (req, res) => {
  try {
    await checkEchohuntBindingRateLimit(req, "verify", 5, 60);
    const twitterIdentity = getTwitterIdentityFromAuth(req);
    if (!twitterIdentity?.twitterId) throw publicError("TWITTER_ID_REQUIRED", 400, "请先连接 Twitter 账号后再绑定 Binance Square。");
    const challengeId = parseInt(req.body?.challengeId, 10);
    const postUrl = typeof req.body?.postUrl === "string" ? req.body.postUrl.trim() : "";
    if (!challengeId || !Number.isFinite(challengeId)) throw publicError("CHALLENGE_ID_REQUIRED", 400, "验证码参数缺失，请重新生成。");
    if (!postUrl) throw publicError("POST_URL_REQUIRED", 400, "请粘贴 Binance Square 帖子链接。");
    const data = await verifyBindingPost(twitterIdentity, { challengeId, postUrl });
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_BINANCE_SQUARE_BINDING_VERIFY_FAILED");
  }
});

router.delete("/binance-square-binding/me", authenticateAuthCenterToken(), async (req, res) => {
  try {
    await checkEchohuntBindingRateLimit(req, "unbind", 5, 60);
    const twitterIdentity = getTwitterIdentityFromAuth(req);
    if (!twitterIdentity?.twitterId) throw publicError("TWITTER_ID_REQUIRED", 400, "请先连接 Twitter 账号后再绑定 Binance Square。");
    const data = await revokeBinding(twitterIdentity);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_BINANCE_SQUARE_BINDING_REVOKE_FAILED");
  }
});

router.get("/campaigns", authenticateAuthCenterToken({ optional: true }), async (req, res) => {
  try {
    const lang = normalizeLang(req.query.lang || req.query["x-language"]);
    const twitterIdentity = getTwitterIdentityFromAuth(req);
    const viewer = twitterIdentity ? { username: twitterIdentity.username, twitterId: twitterIdentity.twitterId } : null;
    let hasTesting = false;
    const staticManifest = await getStaticLeaderboardManifest().catch(() => null);
    const staticCampaignMap = new Map();
    (Array.isArray(staticManifest?.campaigns) ? staticManifest.campaigns : []).forEach((item) => {
      if (item?.key) {
        staticCampaignMap.set(String(item.key), item);
        staticCampaignMap.set(String(item.key).toLowerCase(), item);
      }
    });

    // EchoHunt 活动列表永远不返回 draft/archived。
    // 预热/进行中/领奖/已结束可以返回；测试活动在 JS 层继续按 testList 精准过滤。
    // 注意：即使是测试活动，只要仍是 draft，也不应该对 EchoHunt 前端返回。
    const records = await XHuntWebsiteCampaign.findAll({
      where: {
        webStatus: { [Op.notIn]: ["draft", "archived"] },
      },
    });

    const viewerTwitterId = await getViewerTwitterIdForLeaderboard(req);
    const data = await Promise.all(records
      .map((record) => ({ record, plugin: buildPluginCampaign(record, { channel: "echohunt" }) }))
      .filter(({ plugin }) => {
        if (!plugin.testingPhase) return true;
        const allowed = !!viewer && isViewerAllowedForTesting(plugin, viewer);
        if (allowed) hasTesting = true;
        return allowed;
      })
      .map(async ({ record }) => {
        const item = buildEchohuntCampaignListItem(record, lang, viewer);
        const dataKey = item.campaignKey || item.slug || item.nacosCampaignId;
        const staticCampaign =
          staticCampaignMap.get(String(dataKey || "")) ||
          staticCampaignMap.get(String(dataKey || "").toLowerCase()) ||
          staticCampaignMap.get(String(item.slug || "")) ||
          staticCampaignMap.get(String(item.slug || "").toLowerCase()) ||
          staticCampaignMap.get(String(item.nacosCampaignId || "")) ||
          staticCampaignMap.get(String(item.nacosCampaignId || "").toLowerCase());
        const mergedItem = mergeStaticLeaderboardSummary(item, staticCampaign);
        if (mergedItem.hasStaticLeaderboardData) return mergedItem;
        return mergeDynamicEndedLeaderboardSummary(mergedItem, { viewerTwitterId });
      }));

    data
      .sort((a, b) => Number(b.sortOrder || 0) - Number(a.sortOrder || 0));

    return res.json({
      success: true,
      data,
      viewer: {
        loggedIn: !!viewer,
        isTester: hasTesting,
      },
    });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_CAMPAIGNS_FAILED");
  }
});

router.get("/leaderboard/manifest", async (req, res) => {
  try {
    const data = await getStaticLeaderboardManifest();
    res.set("Cache-Control", "public, max-age=300");
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_LEADERBOARD_MANIFEST_FAILED");
  }
});

router.get("/campaigns/:campaignKey/leaderboard", authenticateAuthCenterToken({ optional: true }), async (req, res) => {
  try {
    const campaignKey = normalizeCampaign(req.params.campaignKey);
    const bundle = await getStaticLeaderboardBundle(campaignKey);
    if (bundle) {
      res.set("Cache-Control", "public, max-age=300");
      return res.json({ success: true, source: "static", data: bundle });
    }

    const lang = normalizeLang(req.query.lang);
    const record = await findCampaignRecord(campaignKey);
    const fallbackCampaign = record ? { ...buildEchohuntCampaignListItem(record, lang, null, req), lang } : { campaignKey, lang };
    if (fallbackCampaign?.leaderboardConfig?.leaderboardMode === "custom") {
      try {
        const rawLeaderboard = await getCustomLeaderboardData(fallbackCampaign, {
          campaign: campaignKey,
          channel: "echohunt",
          viewerTwitterId: await getViewerTwitterIdForLeaderboard(req),
        });
        const customBundle = buildCustomLeaderboardBundle(fallbackCampaign, rawLeaderboard);
        customBundle.summary = summarizeLeaderboardBundle(customBundle, rawLeaderboard);
        if (isYziLabsCampaign(campaignKey)) {
          res.set("Cache-Control", "private, max-age=80");
          res.set("Vary", "Authorization");
        } else {
          res.set("Cache-Control", "public, max-age=120");
        }
        return res.json({ success: true, source: "configured_custom", data: customBundle });
      } catch (customError) {
        console.warn("[EchoHunt] custom leaderboard fetch warn:", customError.message || customError);
      }
    }
    return res.json({ success: true, source: "empty", data: emptyLeaderboardBundle(fallbackCampaign) });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_LEADERBOARD_FAILED");
  }
});

router.get("/campaigns/:campaignKey/me", authenticateAuthCenterToken({ optional: true }), async (req, res) => {
  try {
    const campaignKey = normalizeCampaign(req.params.campaignKey);
    const record = await findCampaignRecord(campaignKey);
    const normalizedCampaign = record?.campaignKey || campaignKey;
    if (!normalizedCampaign) throw publicError("CAMPAIGN_REQUIRED", 400);

    const totalRegistrations = await CampaignRegistration.count({ where: { campaign: normalizedCampaign } }).catch(() => 0);
    const twitterIdentity = getTwitterIdentityFromAuth(req);
    if (!twitterIdentity?.twitterId) {
      return res.json({ success: true, registered: false, totalRegistrations, user: null, registration: null, rank: null });
    }

    const registration = await CampaignRegistration.findOne({
      where: { campaign: normalizedCampaign, twitterId: twitterIdentity.twitterId },
      order: [["registeredAt", "DESC"]],
      include: [{ model: XHuntUser, as: "xHuntUser", attributes: ["id", "inviteCode", "displayName", "classification", "userSource"] }],
    });

    let rankIdentity = twitterIdentity;
    if (req.authCenter?.user?.xhuntUserId) {
      const xhuntUser = await XHuntUser.findByPk(req.authCenter.user.xhuntUserId, {
        attributes: ["twitterId", "username"],
      }).catch(() => null);
      rankIdentity = {
        ...twitterIdentity,
        twitterId: xhuntUser?.twitterId || twitterIdentity.twitterId,
        username: xhuntUser?.username || twitterIdentity.username,
      };
    }

    const historicalCampaigns = await findUserHistoricalCampaigns(rankIdentity).catch(() => []);
    let campaignHistory = historicalCampaigns.find((item) => item.campaignKey === normalizedCampaign || item.campaignKey === campaignKey) || null;

    if (!campaignHistory && record) {
      const lang = normalizeLang(req.query.lang);
      const fallbackCampaign = {
        ...buildEchohuntCampaignListItem(record, lang, {
          username: rankIdentity.username,
          twitterId: rankIdentity.twitterId,
        }, req),
        lang,
      };

      if (fallbackCampaign?.leaderboardConfig?.leaderboardMode === "custom") {
        campaignHistory = await fetchCustomCampaignHistoryFromInterfaces(fallbackCampaign, rankIdentity, normalizedCampaign);
      }
    }

    if (!campaignHistory && isYziLabsCampaign(normalizedCampaign)) {
      campaignHistory = buildNotRankedCampaignRank(record, normalizedCampaign);
    }

    if (!registration) {
      return res.json({
        success: true,
        registered: false,
        totalRegistrations,
        user: rankIdentity,
        registration: null,
        rank: campaignHistory,
      });
    }

    res.set("Cache-Control", "private, max-age=80");
    return res.json({
      success: true,
      registered: true,
      totalRegistrations,
      user: rankIdentity,
      registration: serializeRegistration(registration),
      rank: campaignHistory,
    });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_CAMPAIGN_ME_FAILED");
  }
});

router.get("/campaigns/:campaignKey", authenticateAuthCenterToken({ optional: true }), async (req, res) => {
  try {
    const record = await findCampaignRecord(req.params.campaignKey);
    if (!record) throw publicError("CAMPAIGN_NOT_FOUND", 404, "Campaign not found");
    const lang = normalizeLang(req.query.lang || req.query["x-language"]);
    return res.json({ success: true, data: buildEchohuntCampaignDetail(record, lang) });
  } catch (error) {
    return sendError(res, error, "ECHOHUNT_CAMPAIGN_DETAIL_FAILED");
  }
});

// EchoHunt Web 活动报名接口：
// 1. 使用 Auth Center token 校验登录态，并从登录身份中读取 Twitter 身份；
// 2. EchoHunt 入口负责把 Auth Center 用户关联/创建为原 XHuntUser；
// 3. 活动状态、报名窗口、EVM/Email、排名门槛、账号质量、重复报名、写表等规则交给公共报名 service；
// 4. 写入 CampaignRegistration，来源标记为 echohunt_web，与插件报名共用同一张表。
router.post("/campaigns/:campaignKey/register", authenticateAuthCenterToken(), async (req, res) => {
  try {
    const record = await findCampaignRecord(req.params.campaignKey);
    if (!record) throw publicError("CAMPAIGN_NOT_FOUND", 404, "Campaign not found");
    const normalizedCampaign = record?.campaignKey || normalizeCampaign(req.params.campaignKey);
    if (!normalizedCampaign) throw publicError("CAMPAIGN_REQUIRED", 400);

    const twitterIdentity = getTwitterIdentityFromAuth(req);
    if (!twitterIdentity?.twitterId) throw publicError("TWITTER_ID_REQUIRED", 400);

    const xhuntUser = await ensureXHuntUserForEchohunt(
      {
        id: twitterIdentity.twitterId,
        username: twitterIdentity.username,
        name: twitterIdentity.displayName,
        profile_image_url: twitterIdentity.avatar,
      },
      { authCenterUserId: req.authCenter.user.id }
    );
    if (!req.authCenter.user.xhuntUserId || req.authCenter.user.xhuntUserId !== xhuntUser.id) {
      req.authCenter.user.update({ xhuntUserId: xhuntUser.id }).catch(() => {});
    }

    const existingByTwitter = await CampaignRegistration.findOne({
      where: { campaign: normalizedCampaign, twitterId: twitterIdentity.twitterId },
      order: [["registeredAt", "DESC"]],
    });
    if (existingByTwitter) {
      return res.status(409).json({
        success: false,
        error: "ALREADY_REGISTERED",
        message: "You have already registered for this campaign",
        registration: serializeRegistration(existingByTwitter),
      });
    }

    const found = await loadCampaignConfigForRegistration(normalizedCampaign, req, {
      channel: "echohunt",
      viewer: { username: twitterIdentity.username, twitterId: twitterIdentity.twitterId },
      allowComingSoonWarmup: String(record.webStatus || "").toLowerCase() === "coming_soon",
    });

    const rawEmail = req.body?.email !== undefined ? req.body.email : req.body?.emil;
    const contact = normalizeRegistrationContact({ evmAddress: req.body?.evmAddress, email: rawEmail });

    if (req.body?.agreements && (req.body.agreements.terms === false || req.body.agreements.disclosure === false)) {
      throw publicError("AGREEMENT_REQUIRED", 400, "Please accept campaign terms and disclosure policy");
    }

    const registrationUrl = typeof req.body?.registrationUrl === "string" ? req.body.registrationUrl : (req.headers["x-xhunt-web-page-url"] || req.headers.referer || null);
    const result = await registerCampaignParticipant({
      req,
      campaign: normalizedCampaign,
      campaignConfig: found,
      user: {
        xHuntUserId: xhuntUser.id,
        authCenterUserId: req.authCenter.user.id,
        twitterId: twitterIdentity.twitterId,
        username: twitterIdentity.username,
        displayName: twitterIdentity.displayName,
        avatar: twitterIdentity.avatar,
      },
      userRecord: xhuntUser,
      contact,
      registrationUrl,
      registrationSource: "echohunt_web",
      registrationClient: "echohunt",
      registrationMetadata: {
        agreements: req.body?.agreements || null,
        taskState: req.body?.taskState || null,
        userAgent: req.headers["user-agent"] || null,
        pageUrl: registrationUrl,
        source: "echohunt_web",
      },
      cooldownKey: `echohunt:campaign:${normalizedCampaign}:register:cd:${req.authCenter.user.id}`,
      updateUserEvmAddress: true,
    });

    return res.json({ success: true, registration: serializeRegistration(result.registration) });
  } catch (error) {
    if (error.message === "ALREADY_REGISTERED" && error.details) {
      return res.status(409).json({
        success: false,
        error: "ALREADY_REGISTERED",
        message: "You have already registered for this campaign",
        registration: serializeRegistration(error.details),
      });
    }
    if (error.details) {
      return sendError(res, error, "ECHOHUNT_REGISTER_FAILED", { details: error.details });
    }
    return sendError(res, error, "ECHOHUNT_REGISTER_FAILED");
  }
});

module.exports = router;
