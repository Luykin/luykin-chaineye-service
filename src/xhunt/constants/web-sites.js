/**
 * XHunt Web 站点白名单配置
 */

// 默认允许的站点来源标识
const DEFAULT_ALLOWED_SITES = [
  "airdrop", // 空投活动站点
  "activity", // 通用活动站点
  "data", // 数据展示站点
  "referral", // 邀请返利站点
];

/**
 * 获取允许的站点列表
 * 优先从环境变量读取，否则使用默认值
 */
function getAllowedSites() {
  const envSites = process.env.XHUNT_WEB_ALLOWED_SITES;
  if (envSites) {
    return envSites.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_SITES;
}

/**
 * 验证站点来源是否有效
 * @param {string} siteSource - 站点来源标识
 * @returns {boolean}
 */
function isValidSiteSource(siteSource) {
  if (!siteSource || typeof siteSource !== "string") {
    return false;
  }
  const allowedSites = getAllowedSites();
  return allowedSites.includes(siteSource.trim());
}

/**
 * 获取站点中文名称（用于日志展示）
 * @param {string} siteSource - 站点来源标识
 * @returns {string}
 */
function getSiteDisplayName(siteSource) {
  const siteNames = {
    airdrop: "空投站点",
    activity: "活动站点",
    data: "数据站点",
    referral: "邀请站点",
  };
  return siteNames[siteSource] || siteSource;
}

module.exports = {
  DEFAULT_ALLOWED_SITES,
  getAllowedSites,
  isValidSiteSource,
  getSiteDisplayName,
};
