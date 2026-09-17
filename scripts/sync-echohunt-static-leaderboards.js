#!/usr/bin/env node
/**
 * 将已结束的 EchoHunt 自定义榜单固化到 src/xhunt/static/echohunt-leaderboard，
 * 并同步其中参赛者的 X 头像链接。
 *
 * 用法：
 *   NODE_ENV=production yarn echohunt:leaderboard:sync
 *   NODE_ENV=production yarn echohunt:leaderboard:sync --dry-run
 *   NODE_ENV=production yarn echohunt:leaderboard:sync --snapshots-only
 *   NODE_ENV=production yarn echohunt:leaderboard:sync --avatars-only
 *   NODE_ENV=production yarn echohunt:leaderboard:sync --campaign <campaignKey>
 *
 * 默认会：
 * 1. 从线上 EchoHunt 活动接口读取数据库中的已结束 custom 活动；
 * 2. 为 manifest 中尚不存在的活动写入最终榜单快照；
 * 3. 通过 data.cryptohunt.ai 批量刷新所有静态榜单和获奖者的头像。
 *
 * 不会覆盖已有榜单的名次或分数；需要重新出榜时请先人工核对后删除对应静态文件和 manifest 条目。
 */

const fs = require("fs/promises");
const path = require("path");
const axios = require("axios");

require("dotenv").config({
  path: `${process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro"}`,
});

const { getCustomLeaderboardData } = require("../src/xhunt/services/campaignLeaderboardService");
const { buildCustomLeaderboardBundle } = require("../src/xhunt/services/echohuntLeaderboardService");

const STATIC_ROOT = path.resolve(__dirname, "../src/xhunt/static/echohunt-leaderboard");
const STATIC_CAMPAIGNS_DIR = path.join(STATIC_ROOT, "campaigns");
const MANIFEST_PATH = path.join(STATIC_ROOT, "manifest.json");
const TWITTER_USERS_API_URL = "https://data.cryptohunt.ai/fetch/twitter/users";
const TWITTER_USERS_CHUNK_SIZE = 50;
const TWITTER_USERS_TIMEOUT_MS = 10000;
// 线上接口直接读取数据库中的 XHuntWebsiteCampaigns 活动。
const ECHOHUNT_CAMPAIGNS_URL = "https://kb.xhunt.ai/api/xhunt/echohunt/campaigns?lang=en";

function parseArgs(argv) {
  const args = new Set();
  let campaign = "";

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--campaign") {
      campaign = argv[index + 1] || "";
      index += 1;
      continue;
    }
    args.add(value);
  }

  return {
    dryRun: args.has("--dry-run"),
    snapshotsOnly: args.has("--snapshots-only"),
    avatarsOnly: args.has("--avatars-only"),
    includeTesting: args.has("--include-testing"),
    campaign: safeCampaignKey(campaign),
    help: args.has("--help") || args.has("-h"),
  };
}

function printHelp() {
  console.log(`
用法：NODE_ENV=production yarn echohunt:leaderboard:sync [options]

选项：
  --dry-run          只输出会变更的活动和头像数量，不写文件
  --snapshots-only   只补齐缺失的已结束活动快照
  --avatars-only     只刷新已有静态活动中的头像
  --campaign <key>   只处理指定活动（头像刷新也只处理该活动）
  --include-testing  允许固化 testingPhase 活动（默认跳过）
  -h, --help         显示帮助
`);
}

function safeCampaignKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,128}$/.test(key) ? key : "";
}

function normalizeHandle(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const xUrlMatch = raw.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)/i);
  const handle = (xUrlMatch ? xUrlMatch[1] : raw).replace(/^@+/, "").trim();
  return /^[a-z0-9_]{1,32}$/i.test(handle) ? handle.toLowerCase() : "";
}

function cleanUrl(value) {
  const url = String(value || "").trim();
  return url && url !== "https://" && url !== "http://" ? url : null;
}

function pickCampaignLogo(campaign) {
  const directLogo = cleanUrl(campaign?.rightLogo) || cleanUrl(campaign?.logo);
  return {
    image: directLogo,
    alt: String(campaign?.rightLogoAlt || campaign?.logoAlt || "Campaign Logo").trim() || "Campaign Logo",
  };
}

function formatCampaignReward(campaign) {
  const explicitReward = String(campaign?.rewardText || campaign?.prize || "").trim();
  if (explicitReward) return explicitReward;
  const custom = Array.isArray(campaign?.customLeaderboards) ? campaign.customLeaderboards : [];
  const rewards = custom
    .map((item) => {
      if (item?.amount === null || item?.amount === undefined || item?.amount === "") return "";
      return `${item.amount}${item.unit ? ` ${item.unit}` : ""}`;
    })
    .filter(Boolean);
  return rewards.length ? `Reward: ${rewards.join(" · ")}` : "Reward TBD";
}

function filterCustomLeaderboardsForEchohunt(list) {
  return (Array.isArray(list) ? list : []).filter((item) => {
    const channels = Array.isArray(item?.displayChannels) ? item.displayChannels : [];
    return !channels.length || channels.map((channel) => String(channel).toLowerCase()).includes("echohunt");
  });
}

function makeStaticCampaignInput(campaignRecord) {
  const campaignKey = safeCampaignKey(campaignRecord?.campaignKey || campaignRecord?.slug || campaignRecord?.id);
  const links = campaignRecord?.links || {};
  const logo = pickCampaignLogo(campaignRecord);
  const leaderboardConfig = campaignRecord?.leaderboardConfig || {};
  const customLeaderboards = filterCustomLeaderboardsForEchohunt(leaderboardConfig.customLeaderboards);
  const title = String(campaignRecord?.title || campaignKey || "Campaign").trim();
  const project = String(campaignRecord?.project || title).trim() || title;
  const guideUrl =
    cleanUrl(campaignRecord?.guideUrl) ||
    cleanUrl(links.guideUrl) ||
    cleanUrl(links.activeUrl) ||
    cleanUrl(campaignRecord?.activeUrl);

  return {
    campaignKey,
    key: campaignKey,
    slug: campaignKey,
    lang: "en",
    title,
    project,
    prize: formatCampaignReward({ ...campaignRecord, customLeaderboards }),
    announcement: String(campaignRecord?.announcement || "").trim() || null,
    note: String(campaignRecord?.note || "").trim() || null,
    startAt: campaignRecord?.startAt || null,
    endAt: campaignRecord?.endAt || null,
    logo: logo.image,
    logoAlt: logo.alt,
    guideUrl,
    links: {
      guideUrl: guideUrl || "",
      activeUrl: cleanUrl(campaignRecord?.activeUrl) || cleanUrl(links.activeUrl) || "",
    },
    leaderboardConfig: {
      leaderboardMode: leaderboardConfig.leaderboardMode === "custom" ? "custom" : "traditional",
      leaderboardApiUrl: typeof leaderboardConfig.leaderboardApiUrl === "string" ? leaderboardConfig.leaderboardApiUrl : "",
      userActivityApiUrl: typeof leaderboardConfig.userActivityApiUrl === "string" ? leaderboardConfig.userActivityApiUrl : "",
      mockCustomLeaderboardDataEnabled: leaderboardConfig.mockCustomLeaderboardDataEnabled === true,
      customLeaderboards,
    },
  };
}

function isCampaignEnded(campaign, now = Date.now()) {
  const endedAt = new Date(campaign?.endAt || "").getTime();
  return Number.isFinite(endedAt) && endedAt <= now;
}

function rowCount(bundle) {
  const leaderboardRows = Object.values(bundle?.leaderboards?.all || {}).reduce(
    (total, rows) => total + (Array.isArray(rows) ? rows.length : 0),
    0
  );
  const winnerRows = Object.values(bundle?.winners || {}).reduce(
    (total, rows) => total + (Array.isArray(rows) ? rows.length : 0),
    0
  );
  return leaderboardRows + winnerRows;
}

function parseMetricNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(typeof value === "string" ? value.replace(/,/g, "") : value);
  return Number.isFinite(number) ? number : null;
}

function firstMetric(sources, keys) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      if (parseMetricNumber(source[key]) !== null) return source[key];
    }
  }
  return null;
}

function summarizeStaticBundle(bundle, rawResponse) {
  const raw = rawResponse?.raw && typeof rawResponse.raw === "object" ? rawResponse.raw : rawResponse;
  const sources = [
    rawResponse,
    rawResponse?.summary,
    rawResponse?.stats,
    rawResponse?.data,
    rawResponse?.data?.summary,
    rawResponse?.data?.stats,
    raw,
    raw?.summary,
    raw?.stats,
    raw?.data,
    raw?.data?.summary,
    raw?.data?.stats,
  ];
  const rows = Object.values(bundle?.leaderboards?.all || {}).flatMap((value) => Array.isArray(value) ? value : []);
  const userKeys = new Set(
    rows
      .map((row) => row?.twitterId || row?.twitter_id || row?.user_id || row?.username || row?.handle)
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase())
  );
  const sumRows = (keys) => {
    const values = rows
      .map((row) => keys.map((key) => parseMetricNumber(row?.[key])).find((value) => value !== null))
      .filter((value) => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  const fallbackParticipants = userKeys.size || rows.length || 0;
  const base = bundle?.summary || {};

  return {
    participants: firstMetric(sources, ["participants", "hunters", "totalHunters", "total_hunters", "participantCount", "participant_count", "userCount", "user_count", "totalUsers", "total_users"]) ?? base.participants ?? fallbackParticipants,
    tweets: firstMetric(sources, ["tweets", "totalTweets", "total_tweets", "tweetCount", "tweet_count", "posts", "totalPosts", "total_posts"]) ?? base.tweets ?? sumRows(["tweets", "tweet_count"]),
    views: firstMetric(sources, ["views", "totalViews", "total_views", "viewCount", "view_count", "impressions", "totalImpressions", "total_impressions"]) ?? base.views ?? sumRows(["views", "view_count"]),
    engagement: firstMetric(sources, ["engagement", "totalEngagement", "total_engagement", "interactions", "totalInteractions", "total_interactions", "likes", "totalLikes", "like_count"]) ?? base.engagement ?? sumRows(["engagement", "likes", "like_count"]),
    bridges: firstMetric(sources, ["bridges", "totalBridges", "total_bridges", "bridgeCount", "bridge_count"]) ?? base.bridges ?? null,
    updatedAt:
      rawResponse?.leaderboardDataUpdatedAt ||
      rawResponse?.updatedAt ||
      rawResponse?.data?.leaderboardDataUpdatedAt ||
      rawResponse?.data?.updatedAt ||
      raw?.leaderboardDataUpdatedAt ||
      raw?.updatedAt ||
      raw?.data?.leaderboardDataUpdatedAt ||
      raw?.data?.updatedAt ||
      base.updatedAt ||
      bundle?.leaderboardDataUpdatedAt ||
      bundle?.updatedAt ||
      bundle?.generatedAt ||
      null,
  };
}

function buildManifestCampaign(campaign, bundle) {
  const sourceCampaignId = String(campaign?.sourceCampaignId || campaign?.id || campaign?.campaignKey || "").trim() || null;
  return {
    key: bundle.campaign.key,
    title: bundle.campaign.title,
    project: bundle.campaign.project,
    status: "ended",
    prize: bundle.campaign.prize,
    announcement: bundle.campaign.announcement || null,
    note: bundle.campaign.note || null,
    startAt: bundle.campaign.startAt || null,
    endAt: bundle.campaign.endAt || null,
    logo: bundle.campaign.logo || null,
    logoAlt: bundle.campaign.logoAlt || null,
    guideUrl: bundle.campaign.guideUrl || null,
    sourcePage: `/campaigns/${encodeURIComponent(bundle.campaign.key)}`,
    sourceCampaignId,
    dataUrl: `/leaderboard-static/campaigns/${bundle.campaign.key}.json`,
    summary: bundle.summary || null,
    tracks: (bundle.tracks || []).map((track) => ({
      id: track.id,
      type: track.type,
      title: track.title,
      shortTitle: track.shortTitle,
      sourceKey: track.sourceKey || null,
      winnerKey: track.winnerKey || null,
      reward: track.reward || null,
      counts: track.counts || {},
    })),
  };
}

function manifestEntryKeys(entry) {
  return [entry?.key, entry?.sourceCampaignId]
    .map((value) => safeCampaignKey(value))
    .filter(Boolean);
}

function buildManifestIndex(manifest) {
  const index = new Map();
  (Array.isArray(manifest?.campaigns) ? manifest.campaigns : []).forEach((entry) => {
    manifestEntryKeys(entry).forEach((key) => index.set(key, entry));
  });
  return index;
}

function getObjectUsername(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return normalizeHandle(value.username) || normalizeHandle(value.handle) || normalizeHandle(value.author);
}

function visitJsonObjects(value, visitor) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => visitJsonObjects(item, visitor));
    return;
  }
  visitor(value);
  Object.values(value).forEach((item) => visitJsonObjects(item, visitor));
}

function collectBundleHandles(bundle) {
  const handles = new Set();
  visitJsonObjects(bundle, (value) => {
    const handle = getObjectUsername(value);
    if (handle) handles.add(handle);
  });
  return handles;
}

function applyAvatarMap(bundle, avatarMap) {
  let changed = 0;
  visitJsonObjects(bundle, (value) => {
    const handle = getObjectUsername(value);
    const avatar = handle ? avatarMap.get(handle) : null;
    if (!avatar) return;

    const avatarFields = ["avatar", "image", "profile_image_url", "profile_image_url_https", "avatarUrl", "avatar_url"];
    let wroteExistingAvatarField = false;
    avatarFields.forEach((field) => {
      if (!(field in value)) return;
      wroteExistingAvatarField = true;
      if (value[field] !== avatar) {
        value[field] = avatar;
        changed += 1;
      }
    });

    // 榜单行或获奖者有时上游漏传 avatar；为前端补上标准字段。
    if (!wroteExistingAvatarField && ("rank" in value || "author" in value || "username" in value)) {
      value.avatar = avatar;
      changed += 1;
    }
  });
  return changed;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function getTwitterProfileAvatar(user) {
  const profile = user?.profile && typeof user.profile === "object" ? user.profile : user || {};
  return profile.profile_image_url || profile.profile_image_url_https || profile.avatar || profile.image || null;
}

async function fetchAvatarMap(handles) {
  const avatarMap = new Map();
  for (const handleChunk of chunk([...handles], TWITTER_USERS_CHUNK_SIZE)) {
    const response = await axios.get(TWITTER_USERS_API_URL, {
      params: { usernames: handleChunk.join(",") },
      timeout: TWITTER_USERS_TIMEOUT_MS,
    });
    const users = response?.data?.data?.data;
    if (!Array.isArray(users)) continue;
    users.forEach((user) => {
      const handle = normalizeHandle(user?.profile?.username || user?.username || user?.username_raw);
      const avatar = getTwitterProfileAvatar(user);
      if (handle && typeof avatar === "string" && avatar.trim()) avatarMap.set(handle, avatar.trim());
    });
  }
  return avatarMap;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJsonAtomic(filePath, data) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function fetchEchohuntCampaigns() {
  const response = await axios.get(ECHOHUNT_CAMPAIGNS_URL, {
    timeout: 10000,
    headers: { Accept: "application/json" },
  });
  const data = response.data;
  if (!Array.isArray(data?.data)) throw new Error("EchoHunt campaigns response is incomplete");
  return data.data;
}

async function loadStaticBundles(manifest, selectedCampaign) {
  const bundles = [];
  const errors = [];
  for (const entry of manifest.campaigns || []) {
    const key = safeCampaignKey(entry?.key);
    if (!key || (selectedCampaign && key !== selectedCampaign)) continue;
    try {
      bundles.push({ key, filePath: path.join(STATIC_CAMPAIGNS_DIR, `${key}.json`), bundle: await readJson(path.join(STATIC_CAMPAIGNS_DIR, `${key}.json`)) });
    } catch (error) {
      errors.push({ key, error: error.message || String(error) });
    }
  }
  return { bundles, errors };
}

async function createMissingSnapshots(manifest, options, report) {
  const campaigns = await fetchEchohuntCampaigns();
  const manifestIndex = buildManifestIndex(manifest);
  const now = Date.now();
  let manifestChanged = false;

  for (const rawCampaign of campaigns) {
    const campaign = makeStaticCampaignInput(rawCampaign);
    const key = campaign.campaignKey;
    if (!key || (options.campaign && key !== options.campaign)) continue;
    if (!isCampaignEnded(rawCampaign, now)) continue;
    if (rawCampaign?.testingPhase && !options.includeTesting) {
      report.snapshots.skipped.push({ key, reason: "testing_phase" });
      continue;
    }
    if (campaign.leaderboardConfig.leaderboardMode !== "custom") {
      report.snapshots.skipped.push({ key, reason: "not_custom_leaderboard" });
      continue;
    }
    if (!campaign.leaderboardConfig.customLeaderboards.length) {
      report.snapshots.skipped.push({ key, reason: "no_echohunt_leaderboard_tracks" });
      continue;
    }

    const existingEntry = manifestIndex.get(key);
    const filePath = path.join(STATIC_CAMPAIGNS_DIR, `${key}.json`);
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    if (existingEntry && fileExists) {
      report.snapshots.alreadyStatic.push(key);
      continue;
    }

    if (fileExists && !existingEntry) {
      const existingBundle = await readJson(filePath);
      const manifestEntry = buildManifestCampaign({ ...campaign, sourceCampaignId: rawCampaign?.id }, existingBundle);
      if (!options.dryRun) {
        manifest.campaigns.push(manifestEntry);
        manifestIndex.set(key, manifestEntry);
      }
      manifestChanged = true;
      report.snapshots.manifestRepaired.push(key);
      continue;
    }

    try {
      const rawLeaderboard = await getCustomLeaderboardData(campaign, {
        campaign: key,
        channel: "echohunt",
      });
      const bundle = buildCustomLeaderboardBundle(campaign, rawLeaderboard);
      bundle.summary = summarizeStaticBundle(bundle, rawLeaderboard);
      bundle.campaign.status = "ended";
      bundle.campaign.sourceCampaignId = String(rawCampaign?.id || key);
      bundle.raw = rawLeaderboard?.raw || rawLeaderboard;

      if (!rowCount(bundle)) {
        report.snapshots.skipped.push({ key, reason: "empty_leaderboard" });
        continue;
      }

      if (!options.dryRun) await writeJsonAtomic(filePath, bundle);
      const manifestEntry = buildManifestCampaign({ ...campaign, sourceCampaignId: rawCampaign?.id }, bundle);
      if (!options.dryRun) {
        if (existingEntry) {
          const index = manifest.campaigns.indexOf(existingEntry);
          manifest.campaigns[index] = manifestEntry;
        } else {
          manifest.campaigns.push(manifestEntry);
        }
        manifestIndex.set(key, manifestEntry);
      }
      manifestChanged = true;
      report.snapshots.created.push({ key, rows: rowCount(bundle) });
    } catch (error) {
      report.snapshots.failed.push({ key, error: error.message || String(error) });
    }
  }

  return manifestChanged;
}

async function refreshStaticAvatars(manifest, options, report) {
  const { bundles, errors } = await loadStaticBundles(manifest, options.campaign);
  report.avatars.failed.push(...errors);
  const handles = new Set();
  bundles.forEach(({ bundle }) => collectBundleHandles(bundle).forEach((handle) => handles.add(handle)));
  report.avatars.handles = handles.size;
  if (!handles.size) return;

  let avatarMap;
  try {
    avatarMap = await fetchAvatarMap(handles);
  } catch (error) {
    report.avatars.failed.push({ key: "twitter-users-api", error: error.message || String(error) });
    return;
  }
  report.avatars.resolved = avatarMap.size;

  for (const { key, filePath, bundle } of bundles) {
    const changed = applyAvatarMap(bundle, avatarMap);
    if (changed && !options.dryRun) await writeJsonAtomic(filePath, bundle);
    if (changed) report.avatars.changed.push({ key, fields: changed });
  }
}

function printReport(report, options) {
  const skipped = report.snapshots.skipped.map((item) => `${item.key}(${item.reason})`).join(", ");
  const failures = [...report.snapshots.failed, ...report.avatars.failed];
  console.log("\n[EchoHunt static leaderboard sync]");
  console.log(`mode=${options.dryRun ? "dry-run" : "write"}`);
  console.log(`snapshots created=${report.snapshots.created.length}, alreadyStatic=${report.snapshots.alreadyStatic.length}, manifestRepaired=${report.snapshots.manifestRepaired.length}, skipped=${report.snapshots.skipped.length}, failed=${report.snapshots.failed.length}`);
  console.log(`avatars handles=${report.avatars.handles}, resolved=${report.avatars.resolved}, bundlesChanged=${report.avatars.changed.length}, fieldsChanged=${report.avatars.changed.reduce((total, item) => total + item.fields, 0)}, failed=${report.avatars.failed.length}`);
  if (report.snapshots.created.length) console.log(`created: ${report.snapshots.created.map((item) => `${item.key}(${item.rows})`).join(", ")}`);
  if (report.snapshots.manifestRepaired.length) console.log(`manifest repaired: ${report.snapshots.manifestRepaired.join(", ")}`);
  if (skipped) console.log(`skipped: ${skipped}`);
  if (report.avatars.changed.length) console.log(`avatar updated: ${report.avatars.changed.map((item) => `${item.key}(${item.fields})`).join(", ")}`);
  failures.forEach((item) => console.warn(`failed: ${item.key}: ${item.error}`));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.snapshotsOnly && options.avatarsOnly) {
    throw new Error("--snapshots-only and --avatars-only cannot be used together");
  }
  if (process.argv.includes("--campaign") && !options.campaign) {
    throw new Error("--campaign must contain only lowercase letters, numbers, _ or -");
  }

  const manifest = await readJson(MANIFEST_PATH);
  if (!Array.isArray(manifest.campaigns)) manifest.campaigns = [];
  const report = {
    snapshots: { created: [], alreadyStatic: [], manifestRepaired: [], skipped: [], failed: [] },
    avatars: { handles: 0, resolved: 0, changed: [], failed: [] },
  };

  let manifestChanged = false;
  if (!options.avatarsOnly) manifestChanged = await createMissingSnapshots(manifest, options, report);
  if (!options.snapshotsOnly) await refreshStaticAvatars(manifest, options, report);

  if (manifestChanged && !options.dryRun) {
    manifest.generatedAt = new Date().toISOString();
    await writeJsonAtomic(MANIFEST_PATH, manifest);
  }
  printReport(report, options);

  if (report.snapshots.failed.length || report.avatars.failed.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[EchoHunt static leaderboard sync] failed:", error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  applyAvatarMap,
  buildManifestCampaign,
  collectBundleHandles,
  isCampaignEnded,
  makeStaticCampaignInput,
  parseArgs,
  summarizeStaticBundle,
};
