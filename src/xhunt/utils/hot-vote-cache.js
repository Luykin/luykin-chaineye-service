const crypto = require("crypto");

const HOT_VOTE_TOPICS_VERSION_KEY = "hotvote:version:topics";
const HOT_VOTE_COMMENTS_VERSION_KEY_PREFIX = "hotvote:version:comments:";
const HOT_VOTE_VOTES_VERSION_KEY_PREFIX = "hotvote:version:votes:";

/**
 * 校验 ETag 是否匹配客户端 If-None-Match 头部
 */
function matchesEtag(ifNoneMatchHeader, quotedEtag) {
  if (!ifNoneMatchHeader) return false;
  const rawTarget = quotedEtag.replace(/^W\//, "").replace(/"/g, "");
  const tokens = String(ifNoneMatchHeader)
    .split(",")
    .map((item) => item.trim().replace(/^W\//, "").replace(/"/g, ""));
  return tokens.includes(rawTarget) || tokens.includes("*");
}

/**
 * 设置响应缓存头并处理协商缓存（ETag / 304）
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {object|string} payload 响应体数据
 * @param {object} [options]
 * @param {number} [options.maxAge=0] 强缓存时间（秒），0 表示必须向服务器进行 ETag 校验（no-cache）
 * @param {number} [options.staleWhileRevalidate=300] 容灾/背景异步刷新窗口（秒，默认 5 分钟）
 * @param {boolean} [options.isPrivate=true] 是否私有缓存（含个性化用户状态时必须为 true）
 * @param {string} [options.customEtag] 自定义 ETag（若不传则基于 payload 生成 MD5）
 * @returns {boolean} true 表示已命中 304 并结束响应；false 表示未命中需继续下发 200 JSON
 */
function handleNegotiatedCache(req, res, payload, options = {}) {
  const {
    maxAge = 0,
    staleWhileRevalidate = 300,
    isPrivate = true,
    customEtag = null,
  } = options;

  const bodyString = typeof payload === "string" ? payload : JSON.stringify(payload);
  const etag = customEtag || crypto.createHash("md5").update(bodyString).digest("hex");
  const quotedEtag = `"${etag}"`;

  res.set("ETag", quotedEtag);

  let cacheControl;
  if (maxAge > 0) {
    cacheControl = `${isPrivate ? "private" : "public"}, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
  } else {
    cacheControl = `${isPrivate ? "private" : "public"}, no-cache, must-revalidate, stale-while-revalidate=${staleWhileRevalidate}`;
  }
  res.set("Cache-Control", cacheControl);
  res.set("Vary", "Accept-Encoding, x-tw-id, x-user-id, Authorization, x-language, Accept-Language");

  // 如果客户端显式请求强制刷新（Cache-Control: no-cache 或 Pragma: no-cache），则跳过 304 协商
  const reqCacheControl = String(req.headers["cache-control"] || "").toLowerCase();
  const reqPragma = String(req.headers["pragma"] || "").toLowerCase();
  const clientBypass = reqCacheControl.includes("no-cache") || reqPragma.includes("no-cache");

  if (!clientBypass && matchesEtag(req.headers["if-none-match"], quotedEtag)) {
    res.status(304).end();
    return true;
  }

  return false;
}

/**
 * 获取留言列表版本号（用于让 Redis 缓存及 ETag 随新留言发布或删除立即失效）
 */
async function getTopicCommentsVersion(redisClient, topicId) {
  if (!redisClient?.get || !topicId) return "0";
  try {
    return (await redisClient.get(`${HOT_VOTE_COMMENTS_VERSION_KEY_PREFIX}${topicId}`)) || "0";
  } catch (_) {
    return "1";
  }
}

/**
 * 使议题留言缓存失效并递增版本号
 */
async function invalidateTopicCommentsCache(redisClient, topicId) {
  if (!redisClient?.incr || !topicId) return;
  try {
    const key = `${HOT_VOTE_COMMENTS_VERSION_KEY_PREFIX}${topicId}`;
    await redisClient.incr(key);
    if (redisClient.expire) {
      await redisClient.expire(key, 30 * 86400); // 30 天兜底 TTL
    }
  } catch (err) {
    console.warn("[HotVoteCache] invalidateTopicCommentsCache error:", err.message);
  }
}

/**
 * 使议题选票缓存失效并递增选票版本号
 */
async function invalidateTopicVotesCache(redisClient, topicId) {
  if (!topicId) return;
  try {
    if (redisClient?.del) {
      await redisClient.del(`hotvote:counts:${topicId}`);
    }
    if (redisClient?.incr) {
      const key = `${HOT_VOTE_VOTES_VERSION_KEY_PREFIX}${topicId}`;
      await redisClient.incr(key);
      if (redisClient.expire) {
        await redisClient.expire(key, 30 * 86400);
      }
    }
  } catch (err) {
    console.warn("[HotVoteCache] invalidateTopicVotesCache error:", err.message);
  }
}

/**
 * 使议题主配置缓存失效并递增议题版本号
 */
async function invalidateTopicsCache(redisClient, topicId) {
  try {
    if (redisClient?.incr) {
      await redisClient.incr(HOT_VOTE_TOPICS_VERSION_KEY);
      if (redisClient.expire) {
        await redisClient.expire(HOT_VOTE_TOPICS_VERSION_KEY, 30 * 86400);
      }
    }
    if (topicId) {
      await invalidateTopicVotesCache(redisClient, topicId);
      await invalidateTopicCommentsCache(redisClient, topicId);
    }
  } catch (err) {
    console.warn("[HotVoteCache] invalidateTopicsCache error:", err.message);
  }
}

/**
 * 读取或写入议题留言的分页 Redis 缓存（缓存 10 分钟，一旦发布新留言版本递增瞬间失效）
 */
async function getCachedTopicCommentsPage(redisClient, topicId, page, pageSize, loader) {
  if (!redisClient?.get || !redisClient?.set) return loader();
  const version = await getTopicCommentsVersion(redisClient, topicId);
  const cacheKey = `hotvote:cache:comments:${topicId}:v${version}:${page}:${pageSize}`;
  try {
    const raw = await redisClient.get(cacheKey);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (_) {}

  const result = await loader();
  if (result) {
    try {
      // 10 分钟（600 秒）Redis 强缓存；写操作时通过 version 递增自动失效
      await redisClient.set(cacheKey, JSON.stringify(result), { EX: 600 });
    } catch (_) {}
  }
  return result;
}


/**
 * 将用户推特公开档案缓存到 Redis（30天），供只读动态流与留言极速命中，彻底避免读时调用外部网络接口
 */
async function setTwitterProfileCache(redisClient, twitterId, profile) {
  if (!redisClient?.set || !twitterId || !profile) return;
  const cleanTwId = String(twitterId).trim();
  const cacheKey = `hotvote:twitter:profile:${cleanTwId}`;
  try {
    const payload = {
      twitterId: cleanTwId,
      handler: profile.handler || profile.userName || profile.username || "",
      displayName: profile.displayName || profile.name || "",
      avatar: profile.avatar || profile.userAvatar || "",
      source: "write-cache",
    };
    await redisClient.set(cacheKey, JSON.stringify(payload), { EX: 30 * 86400 });
  } catch (_) {}
}

/**
 * 仅从 Redis 读取已缓存的推特用户公开档案（零外部网络 I/O）
 */
async function getCachedTwitterProfile(redisClient, twitterId) {
  if (!redisClient?.get || !twitterId) return null;
  const cleanTwId = String(twitterId).trim();
  const cacheKey = `hotvote:twitter:profile:${cleanTwId}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached && cached !== "__NOT_FOUND__") {
      return JSON.parse(cached);
    }
  } catch (_) {}
  return null;
}

module.exports = {
  handleNegotiatedCache,
  matchesEtag,
  getTopicCommentsVersion,
  invalidateTopicCommentsCache,
  invalidateTopicVotesCache,
  invalidateTopicsCache,
  getCachedTopicCommentsPage,
  setTwitterProfileCache,
  getCachedTwitterProfile,
};
