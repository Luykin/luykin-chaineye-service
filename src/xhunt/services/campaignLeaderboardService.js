const axios = require("axios");

const CUSTOM_LEADERBOARD_TIMEOUT_MS = 10000;
const SELF_CUSTOM_LEADERBOARD_PATH = "/api/xhunt/campaigns/custom-leaderboard";
const SELF_CUSTOM_USER_ACTIVITY_PATH = "/api/xhunt/campaigns/custom-user-activity";

function getCampaignKey(campaign, fallback) {
  return String(
    fallback ||
      campaign?.campaignKey ||
      campaign?.key ||
      campaign?.slug ||
      campaign?.id ||
      ""
  ).trim();
}

function getLeaderboardConfig(campaign = {}) {
  return campaign.leaderboardConfig || campaign || {};
}

function resolveConfiguredApiUrl(apiUrl, campaignKey, extraParams = {}) {
  const raw = String(apiUrl || "").trim();
  if (!raw) return "";

  const replaced = campaignKey ? raw.replace(/\{campaign\}/g, encodeURIComponent(campaignKey)) : raw;
  const base = /^https?:\/\//i.test(replaced)
    ? replaced
    : `${process.env.ECHOHUNT_CUSTOM_API_BASE_URL || process.env.XHUNT_PUBLIC_API_BASE_URL || "https://kb.cryptohunt.ai"}${replaced.startsWith("/") ? "" : "/"}${replaced}`;

  const url = new URL(base);
  if (campaignKey && !url.searchParams.has("campaign") && !raw.includes("{campaign}")) {
    url.searchParams.set("campaign", campaignKey);
  }
  Object.entries(extraParams || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "" && !url.searchParams.has(key)) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function isSelfCustomApiUrl(url, selfPath) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.pathname === selfPath || parsed.pathname.endsWith(selfPath);
  } catch (_) {
    return false;
  }
}

function normalizeRawLeaderboards(raw) {
  const source = raw?.leaderboards || raw?.data?.leaderboards || raw?.data?.data?.leaderboards || {};
  const leaderboards = {};

  if (Array.isArray(source)) {
    source.forEach((item) => {
      if (!item?.id) return;
      leaderboards[String(item.id)] = Array.isArray(item.items)
        ? item.items
        : Array.isArray(item.rows)
          ? item.rows
          : [];
    });
    return leaderboards;
  }

  if (source && typeof source === "object") {
    Object.entries(source).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        leaderboards[key] = value;
      } else if (value && typeof value === "object" && Array.isArray(value.items)) {
        leaderboards[key] = value.items;
      } else if (value && typeof value === "object" && Array.isArray(value.rows)) {
        leaderboards[key] = value.rows;
      } else {
        leaderboards[key] = [];
      }
    });
  }

  return leaderboards;
}

function normalizeLeaderboardPayload(raw = {}, campaignKey) {
  return {
    campaign: raw?.campaign || raw?.data?.campaign || campaignKey || null,
    updatedAt: raw?.updatedAt || raw?.data?.updatedAt || raw?.data?.data?.updatedAt || new Date().toISOString(),
    leaderboards: normalizeRawLeaderboards(raw),
    raw,
  };
}

function emptyLeaderboardPayload(campaignKey) {
  return {
    campaign: campaignKey || null,
    updatedAt: new Date().toISOString(),
    leaderboards: {},
  };
}

async function getCustomLeaderboardData(campaign = {}, options = {}) {
  const config = getLeaderboardConfig(campaign);
  const campaignKey = getCampaignKey(campaign, options.campaign);
  if (config.leaderboardMode !== "custom") return emptyLeaderboardPayload(campaignKey);

  const url = resolveConfiguredApiUrl(config.leaderboardApiUrl, campaignKey);
  // 默认配置指向当前插件占位接口，为避免后端自调用递归，真实数据接入前统一返回空榜单。
  // 后续有真实数据时，优先改这里，把数据源查询和字段映射集中在一个 service 内。
  if (!url || isSelfCustomApiUrl(url, SELF_CUSTOM_LEADERBOARD_PATH)) {
    return emptyLeaderboardPayload(campaignKey);
  }

  const response = await axios.get(url, { timeout: CUSTOM_LEADERBOARD_TIMEOUT_MS });
  return normalizeLeaderboardPayload(response?.data || {}, campaignKey);
}

async function getCustomUserActivityData(campaign = {}, userId, options = {}) {
  const config = getLeaderboardConfig(campaign);
  const campaignKey = getCampaignKey(campaign, options.campaign);
  const normalizedUserId = String(userId || "").trim();
  if (config.leaderboardMode !== "custom") {
    return { ...emptyLeaderboardPayload(campaignKey), userid: normalizedUserId };
  }

  const url = resolveConfiguredApiUrl(config.userActivityApiUrl, campaignKey, {
    userid: normalizedUserId,
  });
  // 默认配置指向当前插件占位接口，为避免后端自调用递归，真实数据接入前统一返回空个人榜单。
  if (!url || isSelfCustomApiUrl(url, SELF_CUSTOM_USER_ACTIVITY_PATH)) {
    return { ...emptyLeaderboardPayload(campaignKey), userid: normalizedUserId };
  }

  const response = await axios.get(url, { timeout: CUSTOM_LEADERBOARD_TIMEOUT_MS });
  const raw = response?.data || {};
  return {
    ...normalizeLeaderboardPayload(raw, campaignKey),
    userid: raw?.userid || raw?.userId || raw?.data?.userid || raw?.data?.userId || normalizedUserId,
  };
}

module.exports = {
  getCustomLeaderboardData,
  getCustomUserActivityData,
  normalizeLeaderboardPayload,
  emptyLeaderboardPayload,
};
