const WEBSITE_CAMPAIGN_PUBLIC_CACHE_VERSION_KEY = "xhunt:website-campaigns:public:version";
const WEBSITE_CAMPAIGN_PUBLIC_CACHE_TTL = 6 * 60 * 60; // 6 小时；后台更新时主动切版本
const WEBSITE_CAMPAIGN_PUBLIC_MISS_CACHE_TTL = 60; // 详情不存在短缓存，避免异常 slug 打数据库

function normalizePublicLang(lang) {
  return String(lang || "zh-CN").trim().toLowerCase() === "en" ? "en" : "zh-CN";
}

function normalizePublicSlug(slug) {
  return String(slug || "").trim();
}

async function getCacheVersion(redisClient) {
  if (!redisClient?.get) return "no-redis";
  try {
    return (await redisClient.get(WEBSITE_CAMPAIGN_PUBLIC_CACHE_VERSION_KEY)) || "1";
  } catch (_) {
    return "no-redis";
  }
}

async function setJson(redisClient, key, value, ttl = WEBSITE_CAMPAIGN_PUBLIC_CACHE_TTL) {
  if (!redisClient?.setEx) return;
  try {
    await redisClient.setEx(key, ttl, JSON.stringify(value));
  } catch (_) {}
}

async function getJson(redisClient, key) {
  if (!redisClient?.get) return undefined;
  try {
    const cached = await redisClient.get(key);
    if (!cached) return undefined;
    return JSON.parse(cached);
  } catch (_) {
    try {
      if (redisClient?.del) await redisClient.del(key);
    } catch (_) {}
    return undefined;
  }
}

function buildListCacheKey(version, lang) {
  return `xhunt:website-campaigns:public:v${version}:list:${normalizePublicLang(lang)}`;
}

function buildDetailCacheKey(version, slug, lang) {
  return `xhunt:website-campaigns:public:v${version}:detail:${normalizePublicLang(lang)}:${encodeURIComponent(normalizePublicSlug(slug))}`;
}

async function getCachedPublicCampaigns(redisClient, lang, loader) {
  if (!redisClient?.get || !redisClient?.setEx) return loader();
  const normalizedLang = normalizePublicLang(lang);
  const version = await getCacheVersion(redisClient);
  const key = buildListCacheKey(version, normalizedLang);
  const cached = await getJson(redisClient, key);
  if (Array.isArray(cached)) return cached;

  const data = await loader();
  if (Array.isArray(data)) {
    await setJson(redisClient, key, data);
  }
  return data;
}

async function getCachedPublicCampaignDetail(redisClient, slug, lang, loader) {
  if (!redisClient?.get || !redisClient?.setEx) return loader();
  const normalizedSlug = normalizePublicSlug(slug);
  if (!normalizedSlug) return loader();

  const normalizedLang = normalizePublicLang(lang);
  const version = await getCacheVersion(redisClient);
  const key = buildDetailCacheKey(version, normalizedSlug, normalizedLang);
  const cached = await getJson(redisClient, key);
  if (cached !== undefined) {
    return cached && cached.__notFound === true ? null : cached;
  }

  const data = await loader();
  if (data) {
    await setJson(redisClient, key, data);
  } else {
    await setJson(redisClient, key, { __notFound: true }, WEBSITE_CAMPAIGN_PUBLIC_MISS_CACHE_TTL);
  }
  return data;
}

async function invalidateWebsiteCampaignPublicCache(redisClient) {
  if (!redisClient?.set) return;
  const nextVersion = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await redisClient.set(WEBSITE_CAMPAIGN_PUBLIC_CACHE_VERSION_KEY, nextVersion);
  } catch (_) {}
}

module.exports = {
  WEBSITE_CAMPAIGN_PUBLIC_CACHE_VERSION_KEY,
  WEBSITE_CAMPAIGN_PUBLIC_CACHE_TTL,
  WEBSITE_CAMPAIGN_PUBLIC_MISS_CACHE_TTL,
  normalizePublicLang,
  normalizePublicSlug,
  getCachedPublicCampaigns,
  getCachedPublicCampaignDetail,
  invalidateWebsiteCampaignPublicCache,
};
