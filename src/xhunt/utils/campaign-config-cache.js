const CAMPAIGN_PLUGIN_CONFIG_CACHE_KEY = "xhunt:campaign-config:plugin-campaigns:v2";
const CAMPAIGN_PLUGIN_CONFIG_CACHE_TTL = 3600; // 1 小时，配置变更时会主动删除

async function getCachedPluginCampaigns(redisClient, loader) {
  if (!redisClient?.get || !redisClient?.setEx) {
    return loader();
  }

  try {
    const cached = await redisClient.get(CAMPAIGN_PLUGIN_CONFIG_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      // 不复用空数组缓存：同步/发布窗口中如果误写入 []，会导致插件端 1 小时内看不到实际活动。
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      if (Array.isArray(parsed) && parsed.length === 0 && redisClient?.del) {
        await redisClient.del(CAMPAIGN_PLUGIN_CONFIG_CACHE_KEY);
      }
    }
  } catch (error) {
    try {
      if (redisClient?.del) await redisClient.del(CAMPAIGN_PLUGIN_CONFIG_CACHE_KEY);
    } catch (_) {}
  }

  const campaigns = await loader();
  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    return campaigns;
  }

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
