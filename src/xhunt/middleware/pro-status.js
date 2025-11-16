// middleware/pro-status.js

const { XHuntUserProSubscription } = require("../../models/postgres-start");
const { Op } = require("sequelize");
const {
  getVersionFromRequest,
  isVersionGreaterOrEqual,
} = require("../utils/version");
const { getXUserId, checkLegacyPro } = require("../utils/legacy-pro");

// 最小版本号：只有 >= 0.2.05 的版本才启用 Pro 检查
const MIN_VERSION_FOR_PRO = "0.2.05";

/**
 * 获取版本号（智能选择来源）
 * 对于 SSE 请求，优先从查询参数获取（因为 EventSource 不支持自定义 headers）
 * 对于其他请求，从 headers 获取
 * @param {express.Request} req - Express 请求对象
 * @returns {string|null} 版本号字符串，如果不存在返回 null
 */
function getVersion(req) {
  // 检查是否是 SSE 请求（完整路径包含 /sse）
  const fullPath = (req.baseUrl || "") + (req.path || "");
  const isSSERequest = fullPath.includes("/sse");
  
  if (isSSERequest) {
    // SSE 请求：优先从查询参数获取（因为 EventSource 不支持自定义 headers）
    return req.query["x-extension-version"] || req.query["x_extension_version"] || getVersionFromRequest(req) || null;
  }
  
  // 其他请求：从 headers 获取
  return getVersionFromRequest(req);
}

/**
 * 检查用户 Pro 状态的中间件（可选模式）
 * 如果 req.user 存在，查询 Pro 状态并挂载到 req.isPro
 * 如果 req.user 不存在，设置 req.isPro = false 并继续
 * 适用于使用 authenticateTokenOptional 的路由
 *
 * 注意：只有版本号 >= 0.2.05 才会进行 Pro 检查，否则直接跳过
 */
async function checkProStatus(req, res, next) {
  try {
    // 检查版本号，如果版本号 < 0.2.05，直接跳过 Pro 检查
    const version = getVersion(req);
    if (!version || !isVersionGreaterOrEqual(version, MIN_VERSION_FOR_PRO)) {
      req.isPro = false;
      return next();
    }

    // 如果没有用户信息，默认不是 Pro
    if (!req.user || !req.user.id) {
      req.isPro = false;
      return next();
    }

    // 查询用户当前有效的 Pro 订阅
    // 使用复合索引 idx_pro_subscription_user_end_time 优化查询
    // 查询条件：userId = ? AND endTime > NOW()，按 endTime DESC 排序取最新的一条
    const activeProSubscription = await XHuntUserProSubscription.findOne({
      where: {
        userId: req.user.id,
        endTime: {
          [Op.gt]: new Date(), // endTime > 当前时间，表示未过期
        },
      },
      order: [["endTime", "DESC"]], // 按过期时间降序，取最新的
      attributes: ["endTime", "planType"], // 只返回需要的字段
    });

    // 如果有有效的 Pro 订阅，直接使用
    if (activeProSubscription) {
      req.isPro = true;
      req.proExpiryTime = activeProSubscription.endTime;
      return next();
    }

    // 如果没有有效的 Pro 订阅，检查是否是老用户 Pro
    // 老用户 Pro：在活跃用户名单中且在 2025-12-29 之前
    // 优先使用 req.user.username（已验证的用户名），如果没有则使用 x-user-id
    const username = req.user?.username || getXUserId(req);
    const legacyProCheck = checkLegacyPro(username);

    if (legacyProCheck.isLegacyPro) {
      req.isPro = true;
      req.proExpiryTime = legacyProCheck.proExpiryTime;
      console.log(
        `[pro-status] ✅ 用户 ${req.user.username || req.user.id} 是老用户 Pro，过期时间: ${legacyProCheck.proExpiryTime.toISOString()}`
      );
    } else {
      req.isPro = false;
      req.proExpiryTime = null;
    }

    next();
  } catch (error) {
    console.error("Pro status check error:", error);
    // 出错时默认不是 Pro，不阻塞请求
    req.isPro = false;
    next();
  }
}

/**
 * 检查用户 Pro 状态的中间件（强制模式）
 * 必须有 req.user，否则返回错误
 * 适用于使用 authenticateToken 的路由
 *
 * 注意：只有版本号 >= 0.2.05 才会进行 Pro 检查，否则直接跳过
 */
async function checkProStatusRequired(req, res, next) {
  try {
    // 检查版本号，如果版本号 < 0.2.05，直接跳过 Pro 检查
    const version = getVersion(req);
    if (!version || !isVersionGreaterOrEqual(version, MIN_VERSION_FOR_PRO)) {
      req.isPro = false;
      return next();
    }

    // 必须有用户信息
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "TOKEN_REQUIRED" });
    }

    // 查询用户当前有效的 Pro 订阅
    const activeProSubscription = await XHuntUserProSubscription.findOne({
      where: {
        userId: req.user.id,
        endTime: {
          [Op.gt]: new Date(),
        },
      },
      order: [["endTime", "DESC"]],
      attributes: ["endTime", "planType"],
    });

    // 如果有有效的 Pro 订阅，直接使用
    if (activeProSubscription) {
      req.isPro = true;
      req.proExpiryTime = activeProSubscription.endTime;
      return next();
    }

    // 如果没有有效的 Pro 订阅，检查是否是老用户 Pro
    // 老用户 Pro：在活跃用户名单中且在 2025-12-29 之前
    // 优先使用 req.user.username（已验证的用户名），如果没有则使用 x-user-id
    const username = req.user?.username || getXUserId(req);
    const legacyProCheck = checkLegacyPro(username);

    if (legacyProCheck.isLegacyPro) {
      req.isPro = true;
      req.proExpiryTime = legacyProCheck.proExpiryTime;
      console.log(
        `[pro-status] ✅ 用户 ${req.user.username || req.user.id} 是老用户 Pro，过期时间: ${legacyProCheck.proExpiryTime.toISOString()}`
      );
    } else {
      req.isPro = false;
      req.proExpiryTime = null;
    }

    next();
  } catch (error) {
    console.error("Pro status check error:", error);
    res.status(500).json({ error: "Pro 状态检查失败" });
  }
}

module.exports = {
  checkProStatus,
  checkProStatusRequired,
};

