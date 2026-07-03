const fs = require("fs/promises");
const path = require("path");

const STATIC_ROOT = path.join(__dirname, "../static/echohunt-leaderboard");
const STATIC_CAMPAIGNS_DIR = path.join(STATIC_ROOT, "campaigns");
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map();

function getCachedJson(cacheKey) {
  const item = cache.get(cacheKey);
  if (!item || item.expiresAt <= Date.now()) return null;
  return item.data;
}

function setCachedJson(cacheKey, data) {
  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function safeCampaignKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,128}$/.test(key)) return "";
  return key;
}

async function readJsonFile(filePath, cacheKey) {
  const cached = getCachedJson(cacheKey);
  if (cached) return cached;
  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw);
  setCachedJson(cacheKey, data);
  return data;
}

async function getStaticLeaderboardManifest() {
  return readJsonFile(path.join(STATIC_ROOT, "manifest.json"), "manifest");
}

async function getStaticLeaderboardBundle(campaignKey) {
  const key = safeCampaignKey(campaignKey);
  if (!key) return null;
  try {
    return await readJsonFile(path.join(STATIC_CAMPAIGNS_DIR, `${key}.json`), `campaign:${key}`);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function pickLocalizedText(value, fallback = "", lang = "en") {
  if (!value) return fallback;
  if (typeof value === "string") return value || fallback;
  if (typeof value === "object") return lang === "zh-CN" || lang === "zh" ? value.zh || value.en || fallback : value.en || value.zh || fallback;
  return fallback;
}

function formatCustomReward(item) {
  const amount = item?.amount;
  const unit = item?.unit;
  if (amount === null || amount === undefined || amount === "") return null;
  return `${amount}${unit ? ` ${unit}` : ""}`;
}

function buildCustomLeaderboardTracks(campaign) {
  const config = campaign?.leaderboardConfig || {};
  const lang = campaign?.lang || "en";
  if (config.leaderboardMode !== "custom") return null;
  const customLeaderboards = Array.isArray(config.customLeaderboards) ? config.customLeaderboards : [];
  if (!customLeaderboards.length) return null;

  const tracks = customLeaderboards.map((item, index) => {
    const id = String(item?.id || item?.distributionType || `custom-${index}`).trim() || `custom-${index}`;
    const title = pickLocalizedText(item?.name, id, lang);
    const shortTitle = pickLocalizedText(item?.short_name, title, lang);
    return {
      id,
      type: "leaderboard",
      title,
      shortTitle,
      sourceKey: id,
      ranges: ["all"],
      reward: formatCustomReward(item),
      counts: { all: 0 },
      customConfig: {
        distributionType: item?.distributionType || null,
        amount: item?.amount ?? null,
        participantCount: item?.participantCount ?? null,
        unit: item?.unit || null,
      },
      columns: [
        { key: "rank", label: "Rank", type: "rank" },
        { key: "hunter", label: "Hunter", type: "user" },
        { key: "score", label: "Score", type: "text" },
        { key: "share", label: "Share", type: "percent" },
      ],
    };
  });

  return {
    tracks,
    leaderboards: {
      all: Object.fromEntries(tracks.map((track) => [track.sourceKey, []])),
    },
  };
}

function emptyLeaderboardBundle(campaign = {}) {
  const key = String(campaign.campaignKey || campaign.key || campaign.slug || "unknown");
  const title = String(campaign.title || campaign.campaignName || key || "Campaign");
  const project = String(campaign.project || campaign.projectName || title || key);
  const prize = String(campaign.prize || campaign.rewardText || campaign.reward?.text || "Reward TBD");
  const custom = buildCustomLeaderboardTracks(campaign);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    campaign: {
      key,
      title,
      project,
      status: campaign.status || campaign.webStatus || "live",
      prize,
      announcement: campaign.announcement || campaign.summary || null,
      note: campaign.note || null,
      startAt: campaign.startAt || null,
      endAt: campaign.endAt || null,
      logo: campaign.logo || campaign.rightLogo || null,
      logoAlt: campaign.logoAlt || campaign.rightLogoAlt || null,
      guideUrl: campaign.guideUrl || null,
      sourcePage: null,
    },
    summary: {
      participants: 0,
      tweets: 0,
      views: 0,
      engagement: 0,
      bridges: null,
      updatedAt: null,
    },
    tracks: custom?.tracks || [
      {
        id: "poi",
        type: "leaderboard",
        title: "Proof of Influence",
        shortTitle: "POI",
        sourceKey: "mindshare",
        ranges: ["all"],
        reward: null,
        columns: [
          { key: "rank", label: "Rank", type: "rank" },
          { key: "hunter", label: "Hunter", type: "user" },
        ],
      },
    ],
    leaderboards: custom?.leaderboards || {
      all: {
        mindshare: [],
      },
    },
    winners: {},
  };
}

function normalizeHandle(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function rowMatchesUser(row, user) {
  if (!row || !user) return false;
  const twitterId = String(user.twitterId || "").trim();
  const username = normalizeHandle(user.username);
  if (twitterId && String(row.twitterId || "").trim() === twitterId) return true;
  if (username) {
    if (normalizeHandle(row.handle) === username) return true;
    if (normalizeHandle(row.username) === username) return true;
    if (normalizeHandle(row.author) === username) return true;
  }
  return false;
}

function buildTrackIndex(bundle) {
  const map = new Map();
  (bundle?.tracks || []).forEach((track) => {
    if (track?.sourceKey) map.set(String(track.sourceKey), track);
    if (track?.winnerKey) map.set(`winner:${track.winnerKey}`, track);
    if (track?.id) map.set(String(track.id), track);
  });
  return map;
}

function simplifyLeaderboardRow(row, track, range) {
  return {
    trackId: track?.id || row.sourceKey || "leaderboard",
    trackType: "leaderboard",
    trackTitle: track?.title || null,
    range,
    rank: row.rank ?? null,
    username: row.username || normalizeHandle(row.handle),
    handle: row.handle || (row.username ? `@${row.username}` : null),
    twitterId: row.twitterId || null,
    name: row.name || row.username || row.handle || null,
    avatar: row.avatar || null,
    share: row.share ?? null,
    shareText: row.shareText || null,
    tweets: row.tweets ?? null,
    views: row.views ?? null,
    likes: row.likes ?? null,
    kolEngages: row.kolEngages ?? row.kol_engages ?? null,
    invites: row.invites ?? null,
    score: row.score ?? null,
    result: row.result ?? null,
    trackReward: track?.reward || null,
    reward: row.reward || null,
    raw: row,
  };
}

function simplifyWinnerRow(row, track) {
  return {
    trackId: track?.id || track?.winnerKey || "winner",
    trackType: "winners",
    trackTitle: track?.title || null,
    award: row.award || row.prize || null,
    rank: row.rank ?? null,
    author: row.author || row.handle || null,
    handle: row.handle || row.author || null,
    avatar: row.avatar || null,
    post: row.post || row.title || null,
    url: row.url || null,
    reward: row.reward || row.prize || null,
    trackReward: track?.reward || null,
    raw: row,
  };
}

function summarizeRewards(tracks, winners) {
  const rewards = [];
  winners.forEach((winner) => {
    if (winner.reward) {
      rewards.push({
        source: "winner_row",
        trackId: winner.trackId,
        reward: winner.reward,
        award: winner.award,
      });
    }
  });
  tracks.forEach((track) => {
    if (!track.reward && !track.trackReward) return;
    rewards.push({
      source: "leaderboard_rank",
      trackId: track.trackId,
      rank: track.rank,
      reward: track.reward || null,
      trackReward: track.trackReward || null,
      note: track.reward ? null : "Exact per-user reward unavailable in static row",
    });
  });
  return rewards;
}

function findUserInBundle(bundle, user) {
  const trackIndex = buildTrackIndex(bundle);
  const tracks = [];
  const winners = [];

  const leaderboards = bundle?.leaderboards || {};
  for (const [range, bySource] of Object.entries(leaderboards)) {
    if (!bySource || typeof bySource !== "object") continue;
    for (const [sourceKey, rows] of Object.entries(bySource)) {
      if (!Array.isArray(rows)) continue;
      const track = trackIndex.get(String(sourceKey));
      rows.filter((row) => rowMatchesUser(row, user)).forEach((row) => {
        tracks.push(simplifyLeaderboardRow(row, track, range));
      });
    }
  }

  const rawWinners = bundle?.winners || {};
  for (const [winnerKey, rows] of Object.entries(rawWinners)) {
    if (!Array.isArray(rows)) continue;
    const track = trackIndex.get(`winner:${winnerKey}`) || trackIndex.get(String(winnerKey));
    rows.filter((row) => rowMatchesUser(row, user)).forEach((row) => {
      winners.push(simplifyWinnerRow(row, track));
    });
  }

  if (!tracks.length && !winners.length) return null;

  const ranks = tracks
    .map((item) => Number(item.rank))
    .filter((rank) => Number.isFinite(rank) && rank > 0);

  return {
    campaignKey: bundle?.campaign?.key || null,
    title: bundle?.campaign?.title || null,
    project: bundle?.campaign?.project || null,
    status: bundle?.campaign?.status || null,
    prize: bundle?.campaign?.prize || null,
    tracks,
    winners,
    bestRank: ranks.length ? Math.min(...ranks) : null,
    estimatedRewards: summarizeRewards(tracks, winners),
  };
}

async function findUserHistoricalCampaigns(user) {
  const manifest = await getStaticLeaderboardManifest();
  const campaigns = Array.isArray(manifest?.campaigns) ? manifest.campaigns : [];
  const result = [];

  for (const item of campaigns) {
    const key = safeCampaignKey(item.key);
    if (!key) continue;
    const bundle = await getStaticLeaderboardBundle(key);
    if (!bundle) continue;
    const found = findUserInBundle(bundle, user);
    if (found) result.push(found);
  }

  return result;
}

module.exports = {
  getStaticLeaderboardManifest,
  getStaticLeaderboardBundle,
  emptyLeaderboardBundle,
  findUserHistoricalCampaigns,
};
