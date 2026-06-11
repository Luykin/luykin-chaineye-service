const CAMPAIGN_PLUGIN_CONFIG_CACHE_KEY = "xhunt:campaign-config:plugin-campaigns:v1";
const CAMPAIGN_PLUGIN_CONFIG_CACHE_TTL = 3600; // 1 小时，配置变更时会主动删除

async function getCachedPluginCampaigns(redisClient, loader) {
  if (!redisClient?.get || !redisClient?.setEx) {
    return loader();
  }

  try {
    const cached = await redisClient.get(CAMPAIGN_PLUGIN_CONFIG_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (error) {
    try {
      if (redisClient?.del) await redisClient.del(CAMPAIGN_PLUGIN_CONFIG_CACHE_KEY);
    } catch (_) {}
  }

  const campaigns = await loader();
  try {
    await redisClient.setEx(
      CAMPAIGN_PLUGIN_CONFIG_CACHE_KEY,
      CAMPAIGN_PLUGIN_CONFIG_CACHE_TTL,
      JSON.stringify(campaigns),
    );
  } catch (_) {}
  return campaigns;
}

async function invalidateCampaignConfigCache(redisClient) {
  if (!redisClient?.del) return;
  await redisClient.del(CAMPAIGN_PLUGIN_CONFIG_CACHE_KEY);
}

module.exports = {
  CAMPAIGN_PLUGIN_CONFIG_CACHE_KEY,
  CAMPAIGN_PLUGIN_CONFIG_CACHE_TTL,
  getCachedPluginCampaigns,
  invalidateCampaignConfigCache,
};
