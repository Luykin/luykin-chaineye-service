const axios = require("axios");

const CUSTOM_LEADERBOARD_TIMEOUT_MS = 10000;
const SELF_CUSTOM_LEADERBOARD_PATH = "/api/xhunt/campaigns/custom-leaderboard";
const SELF_CUSTOM_USER_ACTIVITY_PATH = "/api/xhunt/campaigns/custom-user-activity";
const YZILABS_PROJECT = "yzilabs";
const YZILABS_LEADERBOARD_URL = "https://data.cryptohunt.ai/info/board/top";
const YZILABS_FETCH_TYPE = "mind_share";
const YZILABS_CACHE_TTL_MS = 5 * 60 * 1000;
// YZi Labs 榜单已开放给所有用户；如需恢复预览白名单，可重新启用下面的限制。
// const YZILABS_PREVIEW_TWITTER_IDS = new Set(["1455055533140893696", "1691722976121520128", "1225173132"]);

let yziLabsLeaderboardCache = null;

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

function shouldUseMockLeaderboardData(config = {}) {
  return config.mockCustomLeaderboardDataEnabled === true;
}

function getCustomLeaderboardId(item, index) {
  return String(item?.id || item?.distributionType || `custom-${index}`).trim() || `custom-${index}`;
}

function getCustomLeaderboards(config = {}) {
  return Array.isArray(config.customLeaderboards) ? config.customLeaderboards : [];
}

function normalizeHandle(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function isYziLabsCampaign(campaignKey) {
  return normalizeHandle(campaignKey).replace(/[^a-z0-9]/g, "") === YZILABS_PROJECT;
}

// function canPreviewYziLabsLeaderboard(options = {}) {
//   const twitterId = String(
//     options.viewerTwitterId ||
//       options.twitterId ||
//       options.twId ||
//       ""
//   ).trim();
//   return !!twitterId && YZILABS_PREVIEW_TWITTER_IDS.has(twitterId);
// }

function getCustomLeaderboardKey(item) {
  const rawName = typeof item?.name === "string" ? item.name : item?.name?.en || item?.name?.zh || "";
  return String(rawName || "").trim().toLowerCase();
}

function getYziLabsMetric(item) {
  const text = [
    item?.id,
    item?.distributionType,
    typeof item?.name === "string" ? item.name : item?.name?.en,
    typeof item?.name === "object" ? item.name?.zh : "",
    typeof item?.short_name === "string" ? item.short_name : item?.short_name?.en,
    typeof item?.short_name === "object" ? item.short_name?.zh : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (text.includes("hertzflow")) return "hertzflow";
  if (text.includes("renaiss")) return "renaiss";
  if (text.includes("velvet")) return "velvet";
  return "";
}

function normalizeNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getYziLabsCreateTime(rows = []) {
  if (!Array.isArray(rows)) return null;
  const createTime = rows.find((row) => row?.create_time)?.create_time;
  return createTime ? String(createTime) : null;
}

async function fetchYziLabsRawLeaderboard() {
  if (yziLabsLeaderboardCache?.expiresAt > Date.now()) {
    return yziLabsLeaderboardCache.data;
  }

  try {
    const response = await axios.get(YZILABS_LEADERBOARD_URL, {
      timeout: CUSTOM_LEADERBOARD_TIMEOUT_MS,
      params: {
        project: YZILABS_PROJECT,
        fetch_type: YZILABS_FETCH_TYPE,
      },
    });

    const rows = Array.isArray(response?.data?.data?.data) ? response.data.data.data : [];
    const createTime = getYziLabsCreateTime(rows);
    const payload = {
      updatedAt: createTime || new Date().toISOString(),
      rows,
    };
    yziLabsLeaderboardCache = {
      expiresAt: Date.now() + YZILABS_CACHE_TTL_MS,
      data: payload,
    };
    return payload;
  } catch (error) {
    if (yziLabsLeaderboardCache?.data) {
      console.warn("[YZiLabsLeaderboard] upstream fetch failed, using stale cache:", error.message || error);
      return yziLabsLeaderboardCache.data;
    }
    throw error;
  }
}

function normalizeYziLabsLeaderboardRow(item, index, sourceKey, metric = "") {
  const value = item?.value && typeof item.value === "object" ? item.value : {};
  const metricShare = metric ? value[`${metric}_share`] : undefined;
  const metricScore = metric ? value[`${metric}_score`] : undefined;
  const share = normalizeNumber(metricShare ?? item?.share, 0);
  const score = normalizeNumber(metricScore ?? item?.score_adj ?? item?.raw_score, null);
  const username = String(item?.username || "").trim();
  const twitterId = String(item?.t_twitter_id || item?.twitterId || item?.twitter_id || "").trim();

  return {
    rank: normalizeNumber(item?.rank, index + 1),
    username,
    handle: username ? `@${username}` : "",
    twitterId,
    name: item?.name || username || "Unknown",
    avatar: item?.profile_image_url || item?.avatar || item?.image || "",
    score,
    share,
    shareText: `${(share * 100).toFixed(2).replace(/\.?0+$/, "")}%`,
    tweets: normalizeNumber(item?.tweet_count, null),
    views: normalizeNumber(item?.view_count, null),
    likes: normalizeNumber(item?.like_count, null),
    create_time: item?.create_time || null,
    sourceKey,
  };
}

function hasPositiveYziLabsScore(row) {
  return Number(row?.score) > 0;
}

function rerankYziLabsRows(rows) {
  return rows.map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

function buildYziLabsRows(rawRows, sourceKey, metric = "") {
  const rows = rawRows
    .map((item, index) => normalizeYziLabsLeaderboardRow(item, index, sourceKey, metric))
    .filter((item) => (item.username || item.twitterId) && hasPositiveYziLabsScore(item));

  if (!metric) return rerankYziLabsRows(rows);

  return rerankYziLabsRows(
    rows.sort((a, b) => (b.share || 0) - (a.share || 0) || (b.score || 0) - (a.score || 0))
  );
}

function getYziLabsLeaderboardTargets(config = {}) {
  const customLeaderboards = getCustomLeaderboards(config);
  if (!customLeaderboards.length) {
    return [
      { key: YZILABS_PROJECT, metric: "" },
      { key: "mindshare", metric: "" },
      { key: "mind_share", metric: "" },
    ];
  }

  const targets = [];
  const seen = new Set();
  const addTarget = (key, metric) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return;
    const cacheKey = `${normalizedKey}::${metric || ""}`;
    if (seen.has(cacheKey)) return;
    seen.add(cacheKey);
    targets.push({ key: normalizedKey, metric: metric || "" });
  };

  customLeaderboards.forEach((item, index) => {
    const metric = getYziLabsMetric(item);
    [
      item?.id,
      getCustomLeaderboardKey(item),
      item?.distributionType,
      getCustomLeaderboardId(item, index),
      `custom-${index}`,
      String(index),
    ].forEach((key) => addTarget(key, metric));
  });

  return targets.length ? targets : [{ key: YZILABS_PROJECT, metric: "" }];
}

function buildYziLabsLeaderboardPayload(config = {}, campaignKey, rawPayload) {
  const leaderboards = {};
  const rowsByMetric = new Map();

  getYziLabsLeaderboardTargets(config).forEach(({ key, metric }) => {
    if (!rowsByMetric.has(metric)) {
      rowsByMetric.set(metric, buildYziLabsRows(rawPayload.rows, key, metric));
    }
    leaderboards[key] = rowsByMetric.get(metric).map((row) => ({
      ...row,
      sourceKey: key,
    }));
  });

  return {
    campaign: campaignKey || YZILABS_PROJECT,
    updatedAt: rawPayload.updatedAt,
    leaderboards,
    source: YZILABS_PROJECT,
  };
}

function matchesYziLabsUser(row, user = {}) {
  const twitterId = String(user.twitterId || "").trim();

  // YZi Labs 个人排名只用 Twitter ID：
  // XHuntUser.twitterId / x-tw-id 对比榜单里的 t_twitter_id（已映射为 row.twitterId）。
  // 匹配不到则视为未上榜，不再使用 username 兜底。
  return !!twitterId && String(row.twitterId || "").trim() === twitterId;
}

function buildYziLabsUserActivityPayload(config = {}, campaignKey, rawPayload, user = {}) {
  const leaderboardPayload = buildYziLabsLeaderboardPayload(config, campaignKey, rawPayload);
  const leaderboards = {};

  Object.entries(leaderboardPayload.leaderboards || {}).forEach(([key, rows]) => {
    if (!Array.isArray(rows)) return;
    const found = rows.find((row) => matchesYziLabsUser(row, user));
    if (!found) return;
    leaderboards[key] = {
      rank: found.rank,
      username: found.username,
      twitterId: found.twitterId,
      name: found.name,
      avatar: found.avatar,
      share: found.share,
      shareText: found.shareText,
      score: found.score,
      create_time: found.create_time || null,
    };
  });

  return {
    campaign: campaignKey || YZILABS_PROJECT,
    userid: user.userId || "",
    twitterId: user.twitterId || "",
    updatedAt: rawPayload.updatedAt,
    leaderboards,
    source: YZILABS_PROJECT,
  };
}

function buildMockRewardText(item) {
  const unit = String(item?.unit || "").trim();
  const amount = Number(item?.amount);
  const participantCount = Number(item?.participantCount);
  if (Number.isFinite(amount) && amount > 0 && Number.isFinite(participantCount) && participantCount > 0) {
    const value = amount / participantCount;
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
    return `${formatted}${unit ? ` ${unit}` : ""}`;
  }
  if (unit) return `Demo ${unit}`;
  return "Demo Reward";
}

function buildMockRows(item) {
  const reward = buildMockRewardText(item);
  const users = [
    { username: "echo_hunter", name: "Echo Hunter", score: 9820, share: 0.1684, tweets: 42, views: 386420, likes: 12480 },
    { username: "chain_scout", name: "Chain Scout", score: 9240, share: 0.1421, tweets: 37, views: 318900, likes: 10840 },
    { username: "mind_mapper", name: "Mind Mapper", score: 8760, share: 0.1198, tweets: 31, views: 276540, likes: 9320 },
    { username: "web3_ranger", name: "Web3 Ranger", score: 8210, share: 0.0975, tweets: 28, views: 241880, likes: 8140 },
    { username: "signal_maker", name: "Signal Maker", score: 7680, share: 0.0832, tweets: 24, views: 203360, likes: 6920 },
  ];

  return users.map((user, index) => ({
    rank: index + 1,
    username: user.username,
    handle: `@${user.username}`,
    twitterId: `90000000000000000${index + 1}`,
    name: user.name,
    avatar: "https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png",
    score: user.score,
    share: user.share,
    shareText: `${(user.share * 100).toFixed(2)}%`,
    tweets: user.tweets,
    views: user.views,
    likes: user.likes,
    reward,
    mocked: true,
  }));
}

function buildMockCustomLeaderboardPayload(config = {}, campaignKey) {
  const leaderboards = {};
  getCustomLeaderboards(config).forEach((item, index) => {
    leaderboards[getCustomLeaderboardId(item, index)] = buildMockRows(item);
  });
  return {
    campaign: campaignKey || null,
    updatedAt: new Date().toISOString(),
    leaderboards,
    mocked: true,
  };
}

async function getCustomLeaderboardData(campaign = {}, options = {}) {
  const config = getLeaderboardConfig(campaign);
  const campaignKey = getCampaignKey(campaign, options.campaign);
  if (config.leaderboardMode !== "custom") return emptyLeaderboardPayload(campaignKey);

  if (isYziLabsCampaign(campaignKey)) {
    // 已放开给所有用户；不再按 YZILABS_PREVIEW_TWITTER_IDS 过滤。
    // if (!canPreviewYziLabsLeaderboard(options)) {
    //   return emptyLeaderboardPayload(campaignKey);
    // }
    const rawPayload = await fetchYziLabsRawLeaderboard();
    return buildYziLabsLeaderboardPayload(config, campaignKey, rawPayload);
  }

  const url = resolveConfiguredApiUrl(config.leaderboardApiUrl, campaignKey);
  // 默认配置指向当前插件占位接口，为避免后端自调用递归，真实数据接入前统一返回空榜单。
  // 后续有真实数据时，优先改这里，把数据源查询和字段映射集中在一个 service 内。
  if (!url || isSelfCustomApiUrl(url, SELF_CUSTOM_LEADERBOARD_PATH)) {
    return shouldUseMockLeaderboardData(config)
      ? buildMockCustomLeaderboardPayload(config, campaignKey)
      : emptyLeaderboardPayload(campaignKey);
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

  if (isYziLabsCampaign(campaignKey)) {
    // 已放开给所有用户；不再按 YZILABS_PREVIEW_TWITTER_IDS 过滤。
    // if (!canPreviewYziLabsLeaderboard(options)) {
    //   return { ...emptyLeaderboardPayload(campaignKey), userid: normalizedUserId };
    // }
    const rawPayload = await fetchYziLabsRawLeaderboard();
    return buildYziLabsUserActivityPayload(config, campaignKey, rawPayload, {
      userId: normalizedUserId,
      twitterId: options.twitterId,
      username: options.username,
    });
  }

  const url = resolveConfiguredApiUrl(config.userActivityApiUrl, campaignKey, {
    userid: normalizedUserId,
  });
  // 默认配置指向当前插件占位接口，为避免后端自调用递归，真实数据接入前统一返回空个人榜单。
  if (!url || isSelfCustomApiUrl(url, SELF_CUSTOM_USER_ACTIVITY_PATH)) {
    return shouldUseMockLeaderboardData(config)
      ? { ...buildMockCustomLeaderboardPayload(config, campaignKey), userid: normalizedUserId }
      : { ...emptyLeaderboardPayload(campaignKey), userid: normalizedUserId };
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
  isYziLabsCampaign,
  normalizeLeaderboardPayload,
  emptyLeaderboardPayload,
  buildMockCustomLeaderboardPayload,
};
