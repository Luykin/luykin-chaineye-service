// 自定义榜单适配器 key 推导的唯一实现，后端各服务与 admin-web 前端保持一致：
// admin-web/src/pages/NacosCampaignsPage.tsx getCustomLeaderboardAdapterKey
function getCustomLeaderboardAdapterKey(item, index) {
  return String(item?.id || item?.distributionType || `custom-${index}`).trim();
}

module.exports = { getCustomLeaderboardAdapterKey };
