const axios = require("axios");
const { QueryTypes } = require("sequelize");
const { E2eList, E2eTweet } = require("../../../models/postgres-start");
const {
  getPostgresReadOnlyInstance,
  getPostgresReadOnlyStatus,
  isPostgresReadOnlyConfigured,
} = require("../../../infra/k8s/postgres-readonly");

const MAX_PAGES = 5;
const PAGE_COUNT = 50;
const BATCH_SIZE = 5;

function getCrawlerUrl() {
  const fullUrl = String(process.env.SOCIAL_LISTENING_CRAWLER_URL || process.env.TWITTER_CLIENT_URL || "").trim();
  if (fullUrl) return fullUrl;
  const baseUrl = String(
    process.env.SOCIAL_LISTENING_CRAWLER_BASE_URL ||
      process.env.CRYPTOHUNT_CRAWLER_BASE_URL ||
      process.env.CRAWLER_TWITTER_BASE_URL ||
      ""
  )
    .trim()
    .replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}/crawler` : "";
}

async function callCrawlerEndpoint(endpoint, tweetId, cursor = null) {
  const crawlerUrl = getCrawlerUrl();
  if (!crawlerUrl) return null;
  try {
    const payload = {
      endpoint,
      tweet_id: String(tweetId),
      count: PAGE_COUNT,
    };
    if (cursor) payload.cursor = cursor;
    const response = await axios.post(crawlerUrl, payload, {
      timeout: 20000,
      headers: { "Content-Type": "application/json" },
    });
    const body = response.data || {};
    return body.data || body;
  } catch (_) {
    return null;
  }
}

function normalizeCrawlerTweet(raw = {}) {
  const profile = raw.user_profile && typeof raw.user_profile === "object" ? raw.user_profile : {};
  return {
    id: String(raw.id || raw.tweet_id || ""),
    user_id: String(profile.id || raw.user_id || raw.twitter_user_id || ""),
    username: profile.username || raw.username || null,
    name: profile.name || raw.name || null,
    profile_image_url: profile.profile_image_url || raw.profile_image_url || null,
    text: raw.text || "",
    create_time: raw.time_parsed || raw.create_time || raw.created_at || new Date().toISOString(),
    likes: Number(raw.likes || raw.statistic?.likes || 0),
    views: Number(raw.views || raw.statistic?.views || 0),
    replies: Number(raw.reply_count || raw.statistic?.reply_count || 0),
    retweets: Number(raw.retweet_count || raw.statistic?.retweet_count || 0),
    quotes: Number(raw.quote_count || raw.statistic?.quote_count || 0),
  };
}

async function fetchReadonlyDevEngageData(tweetId) {
  try {
    const status = getPostgresReadOnlyStatus();
    if (!isPostgresReadOnlyConfigured() || !status.ready) return null;
    const db = getPostgresReadOnlyInstance();
    const [mainRow] = await db.query(
      `
        SELECT id::text, engage_ids
        FROM dev.tweet
        WHERE id::text = :tweetId
        LIMIT 1
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { tweetId: String(tweetId) },
      }
    );
    const engageIds = mainRow?.engage_ids && typeof mainRow.engage_ids === "object" ? mainRow.engage_ids : {};
    const interactionRows = await db.query(
      `
        SELECT
          t.id::text AS id,
          t.twitter_user_id::text AS user_id,
          t.text,
          t.create_time,
          t.reply_id::text AS reply_id,
          t.quote_id::text AS quote_id,
          t.statistic,
          u.username,
          u.name,
          u.profile
        FROM dev.tweet t
        LEFT JOIN dev.twitter_user u ON u.id::text = t.twitter_user_id::text
        WHERE t.reply_id::text = :tweetId OR t.quote_id::text = :tweetId
        ORDER BY t.create_time DESC
        LIMIT 500
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { tweetId: String(tweetId) },
      }
    );
    return {
      engageIds,
      interactionRows: interactionRows || [],
    };
  } catch (_) {
    return null;
  }
}

/**
 * 对应原 twitter_task_tweet_engage.rs 中的 update_tweet_engage_by_tweet_id
 * 拉取单条目标推文的评论(replies)、引用(quotes)、转推用户(retweeters)，并持久化至 luykindatabase 的 EchohuntE2eTweets.engage_data
 */
async function updateTweetEngageByTweetId(tweetId) {
  const cleanTweetId = String(tweetId || "").trim();
  if (!cleanTweetId) return null;

  const existingRecord = await E2eTweet.findByPk(cleanTweetId);
  const prevEngage =
    existingRecord?.engage_data && typeof existingRecord.engage_data === "object"
      ? existingRecord.engage_data
      : {};

  const repliesMap = { ...(prevEngage.replies || {}) };
  const quotesMap = { ...(prevEngage.quotes || {}) };
  const repliedIds = new Set(Array.isArray(prevEngage.engage_ids?.replied_ids) ? prevEngage.engage_ids.replied_ids : []);
  const quotedIds = new Set(Array.isArray(prevEngage.engage_ids?.quoted_ids) ? prevEngage.engage_ids.quoted_ids : []);
  const retweetedUserIds = new Set(
    Array.isArray(prevEngage.engage_ids?.retweeted_user_ids) ? prevEngage.engage_ids.retweeted_user_ids : []
  );

  // 1. 尝试通过爬虫分页抓取 tweet_replies / tweet_quotes / tweet_retweeters
  let replyCursor = null;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const res = await callCrawlerEndpoint("tweet_replies", cleanTweetId, replyCursor);
    const tweets = Array.isArray(res?.tweets) ? res.tweets : [];
    if (!tweets.length) break;
    for (const item of tweets) {
      const normalized = normalizeCrawlerTweet(item);
      if (normalized.id) {
        repliedIds.add(normalized.id);
        repliesMap[normalized.id] = normalized;
      }
    }
    if (!res?.next_cursor) break;
    replyCursor = res.next_cursor;
  }

  let quoteCursor = null;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const res = await callCrawlerEndpoint("tweet_quotes", cleanTweetId, quoteCursor);
    const tweets = Array.isArray(res?.tweets) ? res.tweets : [];
    if (!tweets.length) break;
    for (const item of tweets) {
      const normalized = normalizeCrawlerTweet(item);
      if (normalized.id) {
        quotedIds.add(normalized.id);
        quotesMap[normalized.id] = normalized;
      }
    }
    if (!res?.next_cursor) break;
    quoteCursor = res.next_cursor;
  }

  let retweeterCursor = null;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const res = await callCrawlerEndpoint("tweet_retweeters", cleanTweetId, retweeterCursor);
    const users = Array.isArray(res?.users) ? res.users : [];
    if (!users.length) break;
    for (const user of users) {
      const uid = String(user?.id || user?.user_id || "").trim();
      if (uid) retweetedUserIds.add(uid);
    }
    if (!res?.next_cursor) break;
    retweeterCursor = res.next_cursor;
  }

  // 2. 同时合并只读库 dev.tweet 中已有的互动数据（若已配置）
  const readonlyData = await fetchReadonlyDevEngageData(cleanTweetId);
  if (readonlyData) {
    for (const id of readonlyData.engageIds?.replied_ids || []) repliedIds.add(String(id));
    for (const id of readonlyData.engageIds?.quoted_ids || []) quotedIds.add(String(id));
    for (const uid of readonlyData.engageIds?.retweeted_user_ids || []) retweetedUserIds.add(String(uid));
    for (const row of readonlyData.interactionRows || []) {
      const normalized = normalizeCrawlerTweet({
        id: row.id,
        user_id: row.user_id,
        username: row.username,
        name: row.name,
        profile_image_url: row.profile?.profile_image_url,
        text: row.text,
        create_time: row.create_time,
        statistic: row.statistic,
      });
      if (String(row.reply_id) === cleanTweetId && normalized.id) {
        repliedIds.add(normalized.id);
        repliesMap[normalized.id] = normalized;
      }
      if (String(row.quote_id) === cleanTweetId && normalized.id) {
        quotedIds.add(normalized.id);
        quotesMap[normalized.id] = normalized;
      }
    }
  }

  const nextEngageData = {
    engage_ids: {
      replied_ids: Array.from(repliedIds),
      quoted_ids: Array.from(quotedIds),
      retweeted_user_ids: Array.from(retweetedUserIds),
    },
    replies: repliesMap,
    quotes: quotesMap,
    updated_at: new Date().toISOString(),
  };

  if (existingRecord) {
    await existingRecord.update({ engage_data: nextEngageData });
  } else {
    await E2eTweet.create({
      tweet_id: cleanTweetId,
      engage_data: nextEngageData,
      passed: true,
    });
  }

  return nextEngageData;
}

/**
 * 对应原 twitter_task_tweet_engage.rs 中的 update_e2e_tweet_engage_tasks
 * 扫描 luykindatabase 中所有 status = 'active' 的任务并并发更新互动数据
 */
async function updateActiveE2eTweetEngages() {
  const activeCampaigns = await E2eList.findAll({
    where: { status: "active" },
    attributes: ["tweet_id"],
  });
  const tweetIds = Array.from(
    new Set(activeCampaigns.map((item) => String(item.tweet_id || "").trim()).filter(Boolean))
  );
  if (!tweetIds.length) {
    return { updatedCount: 0, tweetIds: [] };
  }

  for (let i = 0; i < tweetIds.length; i += BATCH_SIZE) {
    const batch = tweetIds.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map((tid) => updateTweetEngageByTweetId(tid)));
  }

  return {
    updatedCount: tweetIds.length,
    tweetIds,
  };
}

module.exports = {
  updateTweetEngageByTweetId,
  updateActiveE2eTweetEngages,
};
