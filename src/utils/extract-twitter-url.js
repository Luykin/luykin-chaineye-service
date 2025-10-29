/**
 * 从 socialLinks 中提取 Twitter URL 的辅助函数
 */

/**
 * 提取 Twitter URL
 * @param {Object} socialLinks - socialLinks 对象
 * @returns {string|null} - Twitter URL 或 null
 */
function extractTwitterUrl(socialLinks) {
  if (!socialLinks) return null;

  // 支持多种可能的 key
  const possibleKeys = ["x", "X", "twitter", "Twitter"];

  for (const key of possibleKeys) {
    if (socialLinks[key]) {
      return socialLinks[key];
    }
  }

  return null;
}

/**
 * 在保存项目前自动提取 Twitter URL
 * 这个函数可以在 Sequelize hook 中使用
 * @param {Object} instance - Sequelize 实例
 */
function autoExtractTwitterUrl(instance) {
  if (instance.socialLinks) {
    const twitterUrl = extractTwitterUrl(instance.socialLinks);
    if (twitterUrl) {
      instance.twitterUrl = twitterUrl;
    }
  }
}

module.exports = {
  extractTwitterUrl,
  autoExtractTwitterUrl,
};
