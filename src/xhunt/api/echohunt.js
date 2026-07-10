const express = require("express");
const axios = require("axios");
const { Op } = require("sequelize");
const {
  pgInstance,
  XHuntUser,
  CampaignRegistration,
  XHuntWebsiteCampaign,
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
} = require("../services/campaignLeaderboardService");
const {
  createBindingChallenge,
  getBindingStatus,
  verifyBindingPost,
  revokeBinding,
} = require("../services/binanceSquareBindingService");
const { isRequestInternalTestUser } = require("../constants/xhuntVip");

const router = express.Router();

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

function sendError(res, error, fallback = "ECHOHUNT_ERROR", extra = {}) {
  const status = error.status || 500;
  return res.status(status).json({
    success: false,
    error: error.message || fallback,
    message: error.publicMessage || undefined,
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
  if (raw === "en" || raw === "en-us") return "en";
  if (raw === "zh" || raw === "zh-cn" || raw === "cn") return "zh-CN";
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

function isViewerAllowedForTesting(pluginCampaign, viewer, req) {
  if (!pluginCampaign?.testingPhase) return true;
  // EchoHunt 测试活动需要同时满足：
  // 1. 当前登录用户是后端内测用户 internal_test；
  // 2. 当前登录用户也在该活动 testList 中。
  // 不能仅因为是内测用户就看到所有测试活动，也不能仅因为在 testList 但不是内测用户就看到。
  return isRequestInternalTestUser(req) && isCampaignTester(pluginCampaign, viewer);
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

function buildEchohuntCampaignListItem(record, lang, viewer, req) {
  const base = buildCampaignListItem(record, lang);
  const plugin = buildPluginCampaign(record, { channel: "echohunt" });
  return {
    ...base,
    testingPhase: !!plugin.testingPhase,
    viewerCanSeeTesting: !!plugin.testingPhase && isViewerAllowedForTesting(plugin, viewer, req),
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
  if (!item || !staticCampaign) return item;
  return {
    ...item,
    leaderboardSummary: staticCampaign.summary || null,
    leaderboardTracks: Array.isArray(staticCampaign.tracks) ? staticCampaign.tracks : [],
    leaderboardDataUrl: staticCampaign.dataUrl || null,
    hasStaticLeaderboardData: true,
  };
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

    const [profileResult, soulResult, historicalResult, joinedCountResult, rankSummaryResult] = await Promise.allSettled([
      fetchTwitterProfile(twitterIdentity.twitterId, lang),
      fetchSoulProfile(twitterIdentity.twitterId, lang),
      findUserHistoricalCampaigns(twitterIdentity),
      CampaignRegistration.count({ where: { twitterId: twitterIdentity.twitterId } }),
      fetchEchohuntRankSummary(twitterIdentity.twitterId),
    ]);

    const rawProfile = profileResult.status === "fulfilled" ? profileResult.value : null;
    const rawSoul = soulResult.status === "fulfilled" ? soulResult.value : null;
    const historicalCampaigns = historicalResult.status === "fulfilled" ? historicalResult.value : [];
    const joinedCampaigns = joinedCountResult.status === "fulfilled" ? joinedCountResult.value : 0;
    const profile = normalizeProfilePayload(rawProfile);
    const soul = normalizeSoulPayload(rawSoul);
    const rankSummary = rankSummaryResult.status === "fulfilled" ? rankSummaryResult.value : null;

    if (profile?.rank?.kolRank || profile?.classification) {
      xhuntUser.update({
        kolRank20W: profile.rank?.kolRank && Number(profile.rank.kolRank) > 0 ? parseInt(profile.rank.kolRank, 10) : xhuntUser.kolRank20W,
        classification: profile.classification || xhuntUser.classification,
      }).catch(() => {});
    }

    res.set("Cache-Control", "private, max-age=120");
    return res.json({
      success: true,
      user: buildEchohuntUserPayload(req.authCenter.user, xhuntUser, twitterIdentity),
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
      if (item?.key) staticCampaignMap.set(String(item.key), item);
    });

    // EchoHunt 活动列表永远不返回 draft/archived。
    // 预热/进行中/领奖/已结束可以返回；测试活动在 JS 层继续判断 internal_test + testList。
    // 注意：即使是测试活动，只要仍是 draft，也不应该对 EchoHunt 前端返回。
    const records = await XHuntWebsiteCampaign.findAll({
      where: {
        webStatus: { [Op.notIn]: ["draft", "archived"] },
      },
    });

    const data = records
      .map((record) => ({ record, plugin: buildPluginCampaign(record, { channel: "echohunt" }) }))
      .filter(({ plugin }) => {
        if (!plugin.testingPhase) return true;
        const allowed = !!viewer && isViewerAllowedForTesting(plugin, viewer, req);
        if (allowed) hasTesting = true;
        return allowed;
      })
      .map(({ record }) => {
        const item = buildEchohuntCampaignListItem(record, lang, viewer, req);
        const dataKey = item.campaignKey || item.slug || item.nacosCampaignId;
        const staticCampaign =
          staticCampaignMap.get(String(dataKey || "")) ||
          staticCampaignMap.get(String(item.slug || "")) ||
          staticCampaignMap.get(String(item.nacosCampaignId || ""));
        return mergeStaticLeaderboardSummary(item, staticCampaign);
      })
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

router.get("/campaigns/:campaignKey/leaderboard", async (req, res) => {
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
        });
        const customBundle = buildCustomLeaderboardBundle(fallbackCampaign, rawLeaderboard);
        res.set("Cache-Control", "public, max-age=120");
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

    const historicalCampaigns = await findUserHistoricalCampaigns(twitterIdentity).catch(() => []);
    const campaignHistory = historicalCampaigns.find((item) => item.campaignKey === normalizedCampaign || item.campaignKey === campaignKey) || null;

    if (!registration) {
      return res.json({
        success: true,
        registered: false,
        totalRegistrations,
        user: twitterIdentity,
        registration: null,
        rank: campaignHistory,
      });
    }

    res.set("Cache-Control", "private, max-age=80");
    return res.json({
      success: true,
      registered: true,
      totalRegistrations,
      user: twitterIdentity,
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
