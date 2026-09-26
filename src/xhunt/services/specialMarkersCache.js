const crypto = require("crypto");
const { XhuntSpecialUserMarker } = require("../../models/postgres-start");
const { getRedisClient } = require("../../lib/redisClient");

const SPECIAL_MARKERS_CACHE_KEY = "xhunt:special-markers:all:v1";
const SPECIAL_MARKERS_CACHE_TTL = 30 * 24 * 60 * 60; // 30天，管理后台修改时主动刷新

/**
 * 从数据库加载全部生效标记（包含可见性规则）
 */
async function loadRawPoolFromDb() {
  const rows = await XhuntSpecialUserMarker.findAll({
    where: { enabled: true },
    order: [["username", "ASC"]],
  });

  const rawPool = rows.map((r) => ({
    username: String(r.username || "").trim().toLowerCase(),
    twitterId: r.twitterId ? String(r.twitterId).trim() : null,
    markerText: r.markerText,
    colorPreset: r.colorPreset || "danger-red",
    variant: r.variant || "subtle",
    icon: r.icon || "none",
    effect: r.effect || "none",
    customTextColor: r.customTextColor || null,
    customBgColor: r.customBgColor || null,
    description: r.description || null,
    linkUrl: r.linkUrl || null,
    visibleScope: r.visibleScope || "all",
    visibleTwids: Array.isArray(r.visibleTwids) ? r.visibleTwids.map((id) => String(id).trim()).filter(Boolean) : [],
    updatedAt: r.updatedAt ? new Date(r.updatedAt).getTime() : 0,
  }));

  const maxUpdatedAt = rawPool.reduce((max, item) => Math.max(max, item.updatedAt), 0);
  return {
    poolVersion: maxUpdatedAt || Date.now(),
    rawPool,
  };
}

/**
 * 获取全量原始池（Redis 缓存优先）
 */
async function getRawPool() {
  const redis = await getRedisClient();
  if (redis) {
    try {
      const cached = await redis.get(SPECIAL_MARKERS_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {
      await redis.del(SPECIAL_MARKERS_CACHE_KEY).catch(() => {});
    }
  }

  const data = await loadRawPoolFromDb();
  if (redis) {
    await redis.set(SPECIAL_MARKERS_CACHE_KEY, JSON.stringify(data), {
      EX: SPECIAL_MARKERS_CACHE_TTL,
    }).catch(() => {});
  }
  return data;
}

/**
 * 主动刷新 Redis 全量缓存
 */
async function refreshSpecialMarkersCache() {
  const data = await loadRawPoolFromDb();
  const redis = await getRedisClient();
  if (redis) {
    await redis.set(SPECIAL_MARKERS_CACHE_KEY, JSON.stringify(data), {
      EX: SPECIAL_MARKERS_CACHE_TTL,
    }).catch(() => {});
  }
  return data;
}

/**
 * 依据当前请求者的 twid（从请求头提取），在内存中微秒级过滤出对该用户可见的 markers
 * @param {string} [reqTwid] 当前请求用户的 Twitter ID
 */
async function getFilteredPayloadForUser(reqTwid) {
  const { poolVersion, rawPool } = await getRawPool();
  const normalizedTwid = String(reqTwid || "").trim();

  const markers = {};
  let count = 0;

  for (const item of rawPool) {
    // 权限校验：
    // 1. 全部人可见 (visibleScope === 'all')
    // 2. 指定用户可见 (visibleScope === 'whitelist' 且当前用户的 twid 命中白名单)
    const isVisible =
      item.visibleScope === "all" ||
      (normalizedTwid && item.visibleTwids.includes(normalizedTwid));

    if (isVisible) {
      markers[item.username] = {
        text: item.markerText,
        color: item.colorPreset,
        variant: item.variant !== "subtle" ? item.variant : undefined,
        icon: item.icon !== "none" ? item.icon : undefined,
        effect: item.effect !== "none" ? item.effect : undefined,
        textColor: item.customTextColor || undefined,
        bgColor: item.customBgColor || undefined,
        desc: item.description || undefined,
        link: item.linkUrl || undefined,
        twid: item.twitterId || undefined,
      };
      count++;
    }
  }

  const payload = {
    version: poolVersion,
    count,
    markers,
  };

  const etag = crypto
    .createHash("sha1")
    .update(`${poolVersion}:${normalizedTwid}:${JSON.stringify(markers)}`)
    .digest("hex");

  return { payload, etag };
}

module.exports = {
  SPECIAL_MARKERS_CACHE_KEY,
  SPECIAL_MARKERS_CACHE_TTL,
  getRawPool,
  refreshSpecialMarkersCache,
  getFilteredPayloadForUser,
};
