const axios = require("axios");
const { DATA_SERVICE_BASE_URL } = require("../constants/dataService");
const { getPublishedLeaderboard } = require("./externalLeaderboardAdapterService");

const CUSTOM_LEADERBOARD_TIMEOUT_MS = 10000;
const SELF_CUSTOM_LEADERBOARD_PATH = "/api/xhunt/campaigns/custom-leaderboard";
const SELF_CUSTOM_USER_ACTIVITY_PATH = "/api/xhunt/campaigns/custom-user-activity";
const YZILABS_PROJECT = "yzilabs";
const YZILABS_LEADERBOARD_URL = `${DATA_SERVICE_BASE_URL}/info/board/top`;
const YZILABS_FETCH_TYPE = "mind_share";
const YZILABS_DETAIL_FETCH_TYPE = "mind_detail";
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
    summary: raw?.summary || raw?.data?.summary || raw?.data?.data?.summary || null,
    leaderboards: normalizeRawLeaderboards(raw),
    raw,
  };
}

function emptyLeaderboardPayload(campaignKey) {
  return {
    campaign: campaignKey || null,
    updatedAt: new Date().toISOString(),
    summary: null,
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

function getYziLabsDetailCreateTime(response) {
  const rows = Array.isArray(response?.data?.data?.data) ? response.data.data.data : [];
  const createTime = rows[0]?.create_time || rows[0]?.createTime;
  return createTime ? String(createTime) : null;
}

async function fetchYziLabsRawLeaderboard() {
  if (yziLabsLeaderboardCache?.expiresAt > Date.now()) {
    return yziLabsLeaderboardCache.data;
  }

  try {
    const [leaderboardResult, detailResult] = await Promise.allSettled([
      axios.get(YZILABS_LEADERBOARD_URL, {
        timeout: CUSTOM_LEADERBOARD_TIMEOUT_MS,
        params: {
          project: YZILABS_PROJECT,
          fetch_type: YZILABS_FETCH_TYPE,
        },
      }),
      axios.get(YZILABS_LEADERBOARD_URL, {
        timeout: CUSTOM_LEADERBOARD_TIMEOUT_MS,
        params: {
          project: YZILABS_PROJECT,
          fetch_type: YZILABS_DETAIL_FETCH_TYPE,
        },
      }),
    ]);

    if (leaderboardResult.status === "rejected") throw leaderboardResult.reason;

    const response = leaderboardResult.value;
    const rows = Array.isArray(response?.data?.data?.data) ? response.data.data.data : [];
    const leaderboardDataUpdatedAt = detailResult.status === "fulfilled"
      ? getYziLabsDetailCreateTime(detailResult.value)
      : null;
    if (detailResult.status === "rejected") {
      console.warn("[YZiLabsLeaderboard] detail update time fetch failed:", detailResult.reason?.message || detailResult.reason);
    }

    const payload = {
      updatedAt: leaderboardDataUpdatedAt || new Date().toISOString(),
      leaderboardDataUpdatedAt: leaderboardDataUpdatedAt || null,
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
  const boosterBisquare = metric
    ? value[`booster_bisquare_${metric}`] ?? item?.[`booster_bisquare_${metric}`] ?? null
    : value.booster_bisquare ?? item?.booster_bisquare ?? null;
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
    booster_bisquare: boosterBisquare,
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
    leaderboardDataUpdatedAt: rawPayload.leaderboardDataUpdatedAt || null,
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
      booster_bisquare: found.booster_bisquare ?? null,
    };
  });

  return {
    campaign: campaignKey || YZILABS_PROJECT,
    userid: user.userId || "",
    twitterId: user.twitterId || "",
    updatedAt: rawPayload.updatedAt,
    leaderboardDataUpdatedAt: rawPayload.leaderboardDataUpdatedAt || null,
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

function defaultMedalByRank(rank) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "";
}

function defaultPrizeByRank(rank) {
  if (rank === 1) return "1st Prize";
  if (rank === 2) return "2nd Prize";
  if (rank === 3) return "3rd Prize";
  return `#${rank}`;
}

function defaultAwardByRank(rank) {
  const medal = defaultMedalByRank(rank);
  const prize = defaultPrizeByRank(rank);
  return medal ? `${medal} ${prize}` : prize;
}

function formatManualWinnerReward(reward, unit) {
  const raw = String(reward ?? "").trim();
  if (!raw) return null;
  const cleanUnit = String(unit || "").trim();
  if (!cleanUnit) return raw;
  if (/^\d[\d,]*(\.\d+)?$/.test(raw)) {
    return `${raw} ${cleanUnit}`;
  }
  return raw;
}

function parseRewardNumericValue(reward) {
  if (reward === null || reward === undefined) return null;
  const cleaned = String(reward).replace(/,/g, "").trim();
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const val = Number(match[0]);
  return Number.isFinite(val) && val > 0 ? val : null;
}

function getDistinctRewardTiers(rewardNums = []) {
  return [...new Set(rewardNums.filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0))].sort(
    (a, b) => b - a
  );
}

function resolveManualWinnerAwardInfo(row = {}, index = 0, distinctRewards = [], currentRewardNum = null) {
  const rawAward = String(row?.award || row?.prize || "").trim();
  const explicitMedal = String(row?.medal || "").trim();
  const explicitRank = Number(row?.rank);
  const fallbackOrder = Number.isFinite(explicitRank) && explicitRank > 0 ? explicitRank : index + 1;

  if (rawAward) {
    if (/(?:🥇|🏅|🏆|\b1st\b|first|一等奖|第一名|冠军)/i.test(rawAward)) {
      const medal = explicitMedal || (rawAward.includes("🏅") ? "🏅" : rawAward.includes("🏆") ? "🏆" : "🥇");
      const prize = String(row?.prize || "").trim() || rawAward.replace(/^(?:🥇|🏅|🏆)\s*/, "").trim() || "1st Prize";
      const award = /^(?:🥇|🏅|🏆)/.test(rawAward) ? rawAward : `${medal} ${prize}`;
      return { rank: 1, order: index + 1, award, medal, prize };
    }
    if (/(?:🥈|\b2nd\b|second|二等奖|第二名|亚军)/i.test(rawAward)) {
      const medal = explicitMedal || "🥈";
      const prize = String(row?.prize || "").trim() || rawAward.replace(/^🥈\s*/, "").trim() || "2nd Prize";
      const award = /^🥈/.test(rawAward) ? rawAward : `${medal} ${prize}`;
      return { rank: 2, order: index + 1, award, medal, prize };
    }
    if (/(?:🥉|\b3rd\b|third|三等奖|第三名|季军)/i.test(rawAward)) {
      const medal = explicitMedal || "🥉";
      const prize = String(row?.prize || "").trim() || rawAward.replace(/^🥉\s*/, "").trim() || "3rd Prize";
      const award = /^🥉/.test(rawAward) ? rawAward : `${medal} ${prize}`;
      return { rank: 3, order: index + 1, award, medal, prize };
    }
    const numMatch = rawAward.match(/^#?(\d+)$/);
    const parsedRank = numMatch ? Number(numMatch[1]) : fallbackOrder;
    return {
      rank: parsedRank,
      order: index + 1,
      award: numMatch ? `#${parsedRank}` : rawAward,
      medal: explicitMedal || "",
      prize: String(row?.prize || rawAward).trim(),
    };
  }

  if (distinctRewards.length >= 2 && currentRewardNum !== null) {
    const tierIdx = distinctRewards.indexOf(currentRewardNum);
    if (tierIdx >= 0 && tierIdx <= 2) {
      const tierRank = tierIdx + 1;
      return {
        rank: tierRank,
        order: index + 1,
        award: defaultAwardByRank(tierRank),
        medal: defaultMedalByRank(tierRank),
        prize: defaultPrizeByRank(tierRank),
      };
    }
    return {
      rank: fallbackOrder,
      order: index + 1,
      award: `#${fallbackOrder}`,
      medal: "",
      prize: `#${fallbackOrder}`,
    };
  }

  return {
    rank: fallbackOrder,
    order: index + 1,
    award: defaultAwardByRank(fallbackOrder),
    medal: explicitMedal || defaultMedalByRank(fallbackOrder),
    prize: defaultPrizeByRank(fallbackOrder),
  };
}

function buildManualEssayLeaderboardRows(item = {}) {
  const winners = (Array.isArray(item?.winners) ? item.winners : []).filter(
    (row) => row && typeof row === "object"
  );
  const unit = item?.unit;
  const rewardNums = winners.map((row) => parseRewardNumericValue(row.reward));
  const distinctRewards = getDistinctRewardTiers(rewardNums);
  const sumRewards = rewardNums.reduce((sum, val) => sum + (val || 0), 0);
  const configuredAmount = Number(item?.amount);
  const totalPool =
    Number.isFinite(configuredAmount) && configuredAmount > 0
      ? configuredAmount
      : sumRewards > 0
        ? sumRewards
        : 0;

  return winners.map((row, index) => {
    const rewardNum = rewardNums[index];
    const { rank, order, award, medal, prize } = resolveManualWinnerAwardInfo(
      row,
      index,
      distinctRewards,
      rewardNum
    );
    const username = normalizeHandle(row.handler || row.username || row.handle || row.author);
    const handle = username ? `@${username}` : "";
    const rawName = String(row.name || "").trim();
    const author = rawName || handle || `Winner #${order}`;
    const displayName = rawName || username || author;
    const reward = formatManualWinnerReward(row.reward, unit);
    const post = String(row.post || row.title || "").trim();
    const url = row.url && String(row.url).trim() ? String(row.url).trim() : null;
    const share =
      rewardNum !== null && totalPool > 0
        ? Number((rewardNum / totalPool).toFixed(6))
        : winners.length > 0
          ? Number((1 / winners.length).toFixed(6))
          : 0;
    return {
      rank,
      order,
      award,
      medal,
      prize,
      author,
      username,
      handler: username,
      handle,
      twitterId: row.twitterId || null,
      name: displayName,
      displayName,
      avatar: row.avatar && String(row.avatar).trim() ? String(row.avatar).trim() : null,
      post,
      title: post,
      url,
      reward,
      score: null,
      share,
      shareText: `${(share * 100).toFixed(2)}%`,
    };
  });
}

function applyManualEssayLeaderboards(payload, config = {}) {
  const customLeaderboards = getCustomLeaderboards(config);
  const hasEssay = customLeaderboards.some((item) => item?.isEssayContest === true);
  if (!hasEssay) return payload;

  const nextLeaderboards = { ...(payload?.leaderboards || {}) };
  customLeaderboards.forEach((item, index) => {
    if (item?.isEssayContest !== true) return;
    const id = getCustomLeaderboardId(item, index);
    const nameKey = getCustomLeaderboardKey(item);
    const rows = buildManualEssayLeaderboardRows(item);
    nextLeaderboards[id] = rows;
    [nameKey, `custom-${index}`, String(index)].forEach((fallbackKey) => {
      if (fallbackKey && !nextLeaderboards[fallbackKey]) {
        nextLeaderboards[fallbackKey] = rows;
      }
    });
  });

  return {
    ...payload,
    leaderboards: nextLeaderboards,
  };
}

function matchesManualEssayWinner(row, user = {}) {
  if (!row || !user) return false;
  const twitterId = String(user.twitterId || "").trim();
  if (twitterId && row.twitterId && String(row.twitterId).trim() === twitterId) {
    return true;
  }
  const candidates = [user.username, user.userId]
    .map(normalizeHandle)
    .filter(Boolean);
  if (!candidates.length) return false;
  const rowHandles = [row.username, row.handler, row.handle, row.author]
    .map(normalizeHandle)
    .filter(Boolean);
  return candidates.some((candidate) => rowHandles.includes(candidate));
}

function applyManualEssayUserActivity(payload, config = {}, user = {}) {
  const customLeaderboards = getCustomLeaderboards(config);
  const hasEssay = customLeaderboards.some((item) => item?.isEssayContest === true);
  if (!hasEssay) return payload;

  const nextLeaderboards = { ...(payload?.leaderboards || {}) };
  customLeaderboards.forEach((item, index) => {
    if (item?.isEssayContest !== true) return;
    const id = getCustomLeaderboardId(item, index);
    const nameKey = getCustomLeaderboardKey(item);
    const rows = buildManualEssayLeaderboardRows(item);
    const found = rows.find((row) => matchesManualEssayWinner(row, user));
    if (found) {
      nextLeaderboards[id] = found;
      [nameKey, `custom-${index}`, String(index)].forEach((fallbackKey) => {
        if (fallbackKey && !nextLeaderboards[fallbackKey]) {
          nextLeaderboards[fallbackKey] = found;
        }
      });
    }
  });

  return {
    ...payload,
    leaderboards: nextLeaderboards,
  };
}

function buildMockCustomLeaderboardPayload(config = {}, campaignKey) {
  const leaderboards = {};
  getCustomLeaderboards(config).forEach((item, index) => {
    const id = getCustomLeaderboardId(item, index);
    leaderboards[id] = item?.isEssayContest === true ? buildManualEssayLeaderboardRows(item) : buildMockRows(item);
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

  const customLeaderboards = getCustomLeaderboards(config);
  const hasEssay = customLeaderboards.some((item) => item?.isEssayContest === true);
  const adapterLeaderboards = customLeaderboards.filter((item) => item?.isEssayContest !== true);
  if (customLeaderboards.length > 0 && adapterLeaderboards.length === 0) {
    return applyManualEssayLeaderboards(emptyLeaderboardPayload(campaignKey), config);
  }

  const externalAdapterPayload = adapterLeaderboards.length
    ? await getPublishedLeaderboard(campaignKey, adapterLeaderboards)
    : null;
  if (externalAdapterPayload) {
    return applyManualEssayLeaderboards(externalAdapterPayload, config);
  }

  if (isYziLabsCampaign(campaignKey)) {
    const rawPayload = await fetchYziLabsRawLeaderboard();
    return applyManualEssayLeaderboards(buildYziLabsLeaderboardPayload(config, campaignKey, rawPayload), config);
  }

  const url = resolveConfiguredApiUrl(config.leaderboardApiUrl, campaignKey);
  if (!url || isSelfCustomApiUrl(url, SELF_CUSTOM_LEADERBOARD_PATH)) {
    const fallbackPayload = shouldUseMockLeaderboardData(config)
      ? buildMockCustomLeaderboardPayload(config, campaignKey)
      : emptyLeaderboardPayload(campaignKey);
    return applyManualEssayLeaderboards(fallbackPayload, config);
  }

  try {
    const response = await axios.get(url, { timeout: CUSTOM_LEADERBOARD_TIMEOUT_MS });
    return applyManualEssayLeaderboards(normalizeLeaderboardPayload(response?.data || {}, campaignKey), config);
  } catch (err) {
    if (hasEssay) {
      console.warn("[CustomLeaderboard] upstream fetch failed, returning manual essay leaderboards:", err.message || err);
      return applyManualEssayLeaderboards(emptyLeaderboardPayload(campaignKey), config);
    }
    throw err;
  }
}

async function getCustomUserActivityData(campaign = {}, userId, options = {}) {
  const config = getLeaderboardConfig(campaign);
  const campaignKey = getCampaignKey(campaign, options.campaign);
  const normalizedUserId = String(userId || "").trim();
  if (config.leaderboardMode !== "custom") {
    return { ...emptyLeaderboardPayload(campaignKey), userid: normalizedUserId };
  }

  const userContext = {
    userId: normalizedUserId,
    twitterId: options.twitterId,
    username: options.username,
  };
  const customLeaderboards = getCustomLeaderboards(config);
  const hasEssay = customLeaderboards.some((item) => item?.isEssayContest === true);
  const adapterLeaderboards = customLeaderboards.filter((item) => item?.isEssayContest !== true);
  if (customLeaderboards.length > 0 && adapterLeaderboards.length === 0) {
    return applyManualEssayUserActivity(
      { ...emptyLeaderboardPayload(campaignKey), userid: normalizedUserId },
      config,
      userContext
    );
  }

  const externalAdapterPayload = adapterLeaderboards.length
    ? await getPublishedLeaderboard(campaignKey, adapterLeaderboards)
    : null;
  if (externalAdapterPayload) {
    const twitterId = String(options.twitterId || "").trim();
    const leaderboards = {};
    Object.entries(externalAdapterPayload.leaderboards || {}).forEach(([key, rows]) => {
      const found = (Array.isArray(rows) ? rows : []).find((row) => twitterId && String(row.twitterId || "") === twitterId);
      if (found) leaderboards[key] = found;
    });
    return applyManualEssayUserActivity(
      { ...externalAdapterPayload, userid: normalizedUserId, twitterId, leaderboards },
      config,
      userContext
    );
  }

  if (isYziLabsCampaign(campaignKey)) {
    const rawPayload = await fetchYziLabsRawLeaderboard();
    return applyManualEssayUserActivity(
      buildYziLabsUserActivityPayload(config, campaignKey, rawPayload, userContext),
      config,
      userContext
    );
  }

  const url = resolveConfiguredApiUrl(config.userActivityApiUrl, campaignKey, {
    userid: normalizedUserId,
  });
  if (!url || isSelfCustomApiUrl(url, SELF_CUSTOM_USER_ACTIVITY_PATH)) {
    const fallbackPayload = shouldUseMockLeaderboardData(config)
      ? { ...buildMockCustomLeaderboardPayload(config, campaignKey), userid: normalizedUserId }
      : { ...emptyLeaderboardPayload(campaignKey), userid: normalizedUserId };
    return applyManualEssayUserActivity(fallbackPayload, config, userContext);
  }

  try {
    const response = await axios.get(url, { timeout: CUSTOM_LEADERBOARD_TIMEOUT_MS });
    const raw = response?.data || {};
    return applyManualEssayUserActivity(
      {
        ...normalizeLeaderboardPayload(raw, campaignKey),
        userid: raw?.userid || raw?.userId || raw?.data?.userid || raw?.data?.userId || normalizedUserId,
      },
      config,
      userContext
    );
  } catch (err) {
    if (hasEssay) {
      console.warn("[CustomUserActivity] upstream fetch failed, returning manual essay user activity:", err.message || err);
      return applyManualEssayUserActivity(
        { ...emptyLeaderboardPayload(campaignKey), userid: normalizedUserId },
        config,
        userContext
      );
    }
    throw err;
  }
}

module.exports = {
  getCustomLeaderboardData,
  getCustomUserActivityData,
  isYziLabsCampaign,
  normalizeLeaderboardPayload,
  emptyLeaderboardPayload,
  buildMockCustomLeaderboardPayload,
};
