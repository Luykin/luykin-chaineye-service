/**
 * 老用户 Pro 状态检查工具
 * 用于检查活跃用户名单中的用户是否享有临时 Pro 权限
 */

// 加载活跃用户名单（延迟加载，避免启动时加载）
let allActiveUserNameSet = null;
let allActiveUserNameList = null;

// 老用户 Pro 过期时间：2025年12月29日
const LEGACY_PRO_EXPIRY_DATE = new Date("2025-12-29T23:59:59.999Z");

/**
 * 加载活跃用户名单（延迟加载，只在第一次使用时加载）
 */
function loadActiveUserNameList() {
  if (allActiveUserNameSet !== null) {
    return allActiveUserNameSet;
  }

  try {
    // 动态加载最新的活跃用户名单文件
    // 文件名格式：allActiveUserName_YYYY-MM-DD.js
    const fs = require("fs");
    const path = require("path");
    const constantsDir = path.join(__dirname, "../constants");

    // 查找最新的 allActiveUserName 文件
    const files = fs.readdirSync(constantsDir);
    const activeUserNameFiles = files
      .filter((file) => file.startsWith("allActiveUserName_") && file.endsWith(".js"))
      .sort()
      .reverse(); // 最新的文件在前

    if (activeUserNameFiles.length === 0) {
      console.warn("[legacy-pro] ⚠️ 未找到活跃用户名单文件");
      allActiveUserNameSet = new Set();
      allActiveUserNameList = [];
      return allActiveUserNameSet;
    }

    // 加载最新的文件
    const latestFile = activeUserNameFiles[0];
    const filePath = path.join(constantsDir, latestFile);
    
    // 动态 require 文件（清除 require 缓存以确保加载最新文件）
    const absolutePath = path.resolve(filePath);
    if (require.cache[absolutePath]) {
      delete require.cache[absolutePath];
    }
    const activeUserModule = require(absolutePath);

    if (activeUserModule && activeUserModule.allActiveUserName) {
      allActiveUserNameList = activeUserModule.allActiveUserName;
      allActiveUserNameSet = new Set(allActiveUserNameList);
      console.log(
        `[legacy-pro] ✅ 加载活跃用户名单: ${allActiveUserNameList.length} 个用户 (来源: ${latestFile})`
      );
    } else {
      console.warn("[legacy-pro] ⚠️ 活跃用户名单格式不正确");
      allActiveUserNameSet = new Set();
      allActiveUserNameList = [];
    }
  } catch (error) {
    console.error("[legacy-pro] ❌ 加载活跃用户名单失败:", error);
    allActiveUserNameSet = new Set();
    allActiveUserNameList = [];
  }

  return allActiveUserNameSet;
}

/**
 * 获取 x-user-id（智能选择来源）
 * 对于 SSE 请求，优先从查询参数获取（因为 EventSource 不支持自定义 headers）
 * 对于其他请求，从 headers 获取
 * @param {express.Request} req - Express 请求对象
 * @returns {string|null} x-user-id 字符串，如果不存在返回 null
 */
function getXUserId(req) {
  // 检查是否是 SSE 请求（完整路径包含 /sse）
  const fullPath = (req.baseUrl || "") + (req.path || "");
  const isSSERequest = fullPath.includes("/sse");

  if (isSSERequest) {
    // SSE 请求：优先从查询参数获取（因为 EventSource 不支持自定义 headers）
    return (
      req.query["x-user-id"] ||
      req.query["x_user_id"] ||
      req.headers["x-user-id"] ||
      null
    );
  }

  // 其他请求：从 headers 获取
  return req.headers["x-user-id"] || null;
}

/**
 * 检查是否是老用户 Pro（在活跃用户名单中且在 2025-12-29 之前）
 * @param {string} xUserId - x-user-id 值（通常是 username）
 * @returns {{isLegacyPro: boolean, proExpiryTime: Date|null}} 检查结果
 */
function checkLegacyPro(xUserId) {
  // 如果没有 x-user-id，不是老用户 Pro
  if (!xUserId || typeof xUserId !== "string" || xUserId.trim() === "") {
    return { isLegacyPro: false, proExpiryTime: null };
  }

  // 加载活跃用户名单
  const activeUserNameSet = loadActiveUserNameList();

  // 检查当前时间是否在 2025-12-29 之前
  const now = new Date();
  const isBeforeExpiry = now < LEGACY_PRO_EXPIRY_DATE;

  // 检查是否在活跃用户名单中
  const isInActiveList = activeUserNameSet.has(xUserId.trim());

  if (isInActiveList && isBeforeExpiry) {
    return {
      isLegacyPro: true,
      proExpiryTime: LEGACY_PRO_EXPIRY_DATE,
    };
  }

  return { isLegacyPro: false, proExpiryTime: null };
}

/**
 * 清除活跃用户名单缓存（用于重新加载）
 */
function clearActiveUserNameCache() {
  allActiveUserNameSet = null;
  allActiveUserNameList = null;
}

module.exports = {
  getXUserId,
  checkLegacyPro,
  loadActiveUserNameList,
  clearActiveUserNameCache,
  LEGACY_PRO_EXPIRY_DATE,
};

