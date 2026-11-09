function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function assertUniqueManagedCampaignIdentities(campaigns) {
  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    throw validationError("活动配置不能为空");
  }
  const seenIds = new Set();
  const seenKeys = new Set();
  const seenSlugs = new Set();

  campaigns.forEach((campaign, index) => {
    const position = index + 1;
    const id = String(campaign?.nacosCampaignId || "").trim();
    const campaignKey = String(campaign?.campaignKey || "").trim();
    const slug = String(campaign?.slug || "").trim();

    if (!id || !campaignKey) {
      throw validationError(`活动 #${position}: id 和 campaignKey 不能为空`);
    }
    if (seenIds.has(id)) {
      throw validationError(`活动 ID 重复：${id}。复制活动时必须填写新的 campaignKey`);
    }
    if (seenKeys.has(campaignKey)) {
      throw validationError(`campaignKey 重复：${campaignKey}。复制活动时必须使用新的 campaignKey`);
    }
    if (slug && seenSlugs.has(slug)) {
      throw validationError(`活动 slug 重复：${slug}`);
    }

    seenIds.add(id);
    seenKeys.add(campaignKey);
    if (slug) seenSlugs.add(slug);
  });
}

module.exports = {
  assertUniqueManagedCampaignIdentities,
};
