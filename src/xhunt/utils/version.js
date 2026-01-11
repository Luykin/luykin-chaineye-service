/**
 * 版本号比较工具
 * 版本号格式："0.4.05", "0.1.19", "0.1.23", "0.2.12"
 * 比较方式：去掉点，每个部分补零到2位，然后转换为数字比较
 * 例如："0.4.05" -> "000210" -> 210, "0.4.05" -> "000205" -> 205, 210 > 205
 */

/**
 * 将版本号转换为数字（用于比较）
 * @param {string} version - 版本号字符串，如 "0.4.05"
 * @returns {number} 版本号对应的数字，如 "0.4.05" -> 205
 */
function versionToNumber(version) {
  if (!version || typeof version !== "string") {
    return 0;
  }

  const parts = version.split(".");

  // 确保至少有3个部分，不足的补0
  while (parts.length < 3) {
    parts.push("0");
  }

  // 每个部分补零到2位，然后拼接
  // "0.4.05" -> ["00", "02", "05"] -> "000205" -> 205
  const paddedParts = parts.slice(0, 3).map((part) => {
    const num = parseInt(part, 10);
    const padded = isNaN(num) ? "00" : String(num).padStart(2, "0");
    return padded;
  });

  const versionString = paddedParts.join("");
  return parseInt(versionString, 10);
}

/**
 * 比较两个版本号
 * @param {string} version1 - 第一个版本号
 * @param {string} version2 - 第二个版本号
 * @returns {number} 如果 version1 > version2 返回 1，version1 < version2 返回 -1，相等返回 0
 */
function compareVersion(version1, version2) {
  const v1 = versionToNumber(version1);
  const v2 = versionToNumber(version2);

  if (v1 > v2) return 1;
  if (v1 < v2) return -1;
  return 0;
}

/**
 * 检查版本号是否大于等于指定版本
 * @param {string} currentVersion - 当前版本号
 * @param {string} minVersion - 最小版本号
 * @returns {boolean} 如果 currentVersion >= minVersion 返回 true
 */
function isVersionGreaterOrEqual(currentVersion, minVersion) {
  const current = versionToNumber(currentVersion);
  const min = versionToNumber(minVersion);
  return current >= min;
}

/**
 * 从请求头获取版本号
 * @param {express.Request} req - Express 请求对象
 * @returns {string|null} 版本号字符串，如果不存在返回 null
 */
function getVersionFromRequest(req) {
  return req.headers["x-extension-version"] || null;
}

module.exports = {
  versionToNumber,
  compareVersion,
  isVersionGreaterOrEqual,
  getVersionFromRequest,
};
