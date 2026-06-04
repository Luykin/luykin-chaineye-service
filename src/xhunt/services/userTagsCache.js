const crypto = require("crypto");
const { XhuntUserTag } = require("../../models/postgres-start");
const { getRedisClient } = require("../../lib/redisClient");

const USER_TAGS_CACHE_KEY = "xhunt:user-tags:all:v3";
const USER_TAGS_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

function normalizeTags(value) {
  return Array.isArray(value)
    ? value.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];
}

function serialize(row) {
  return {
    username: row.username,
    twitterId: row.twitterId || null,
    tagsZh: normalizeTags(row.tagsZh),
    tagsEn: normalizeTags(row.tagsEn),
    updatedAt: row.updatedAt || null,
  };
}

function buildPayload(items) {
  const sortedItems = [...items].sort((a, b) => a.username.localeCompare(b.username));
  const byUsername = {}; // 保留字段兼容旧前端类型，后续统一按 twitterId 查询
  const byTwitterId = {};

  for (const item of sortedItems) {
    if (!item.twitterId) continue;
    byTwitterId[item.twitterId] = {
      tagsZh: item.tagsZh,
      tagsEn: item.tagsEn,
    };
  }

  const maxUpdatedAt = sortedItems.reduce((latest, item) => {
    const time = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
    return Math.max(latest, Number.isFinite(time) ? time : 0);
  }, 0);

  // 响应体只保留前端消费必需字段；ETag 仅通过响应头返回。
  const payload = {
    version: maxUpdatedAt || Date.now(),
    count: sortedItems.length,
    byUsername,
    byTwitterId,
  };
  const etag = crypto
    .createHash("sha1")
    .update(JSON.stringify(payload))
    .digest("hex");

  return { ...payload, etag };
}

async function readFromDb() {
  const rows = await XhuntUserTag.findAll({ order: [["username", "ASC"]] });
  return buildPayload(rows.map(serialize));
}

async function getCachedPayload() {
  const redis = await getRedisClient();
  if (redis) {
    const cached = await redis.get(USER_TAGS_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (_) {
        await redis.del(USER_TAGS_CACHE_KEY).catch(() => {});
      }
    }
  }

  const payload = await readFromDb();
  if (redis) {
    await redis.set(USER_TAGS_CACHE_KEY, JSON.stringify(payload), {
      EX: USER_TAGS_CACHE_TTL_SECONDS,
    });
  }
  return payload;
}

async function refreshUserTagsCache() {
  const payload = await readFromDb();
  const redis = await getRedisClient();
  if (redis) {
    await redis.set(USER_TAGS_CACHE_KEY, JSON.stringify(payload), {
      EX: USER_TAGS_CACHE_TTL_SECONDS,
    });
  }
  return payload;
}

module.exports = {
  USER_TAGS_CACHE_KEY,
  USER_TAGS_CACHE_TTL_SECONDS,
  getCachedPayload,
  refreshUserTagsCache,
};
