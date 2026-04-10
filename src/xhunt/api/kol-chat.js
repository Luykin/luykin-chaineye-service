/**
 * ============================================================================
 * XHunt KOL Chat 代理接口
 * ============================================================================
 *
 * 【功能说明】
 * 代理 KOL Chat Backend 服务，提供 KOL AI 分身聊天功能。
 *
 * 【接口列表】
 * ----------------------------------------------------------------------------
 * 1. GET  /api/xhunt/kol-chat/list   - 获取 KOL 列表
 * 2. POST /api/xhunt/kol-chat/chat   - 与 KOL AI 分身聊天
 * ----------------------------------------------------------------------------
 *
 * 【频率限制】
 * - 免费用户：10 次/天
 * - VIP 用户：30 次/天
 * - 重置时间：北京时间每天 00:00
 *
 * 【认证要求】
 * - 需要登录态 (authenticateToken)
 * - 需要安全中间件验证 (fingerprintLimiter + browserOnlyMiddleware + securityMiddleware)
 *
 * 【后端服务地址】
 * - 内网地址：http://172.31.0.12:3022
 *
 * ============================================================================
 */

const express = require("express");
const axios = require("axios");
const { body } = require("express-validator");
const { validateRequest } = require("../middleware/validate-request");
const { authenticateToken } = require("../middleware/auth");
const { isRequestXHuntVip } = require("../constants/xhuntVip");

const router = express.Router();

// KOL Chat Backend 服务地址
const KOL_CHAT_BASE_URL = process.env.KOL_CHAT_BASE_URL || "http://172.31.0.12:3022";

// 频率限制配置
const RATE_LIMIT_CONFIG = {
  FREE_USER_DAILY_LIMIT: 10,
  VIP_USER_DAILY_LIMIT: 30,
  REDIS_KEY_PREFIX: "kol_chat_limit",
};

// 获取到明天00:00的秒数
function getSecondsUntilMidnight(beijingTime) {
  const tomorrow = new Date(beijingTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return Math.ceil((tomorrow - beijingTime) / 1000);
}

// 获取明天00:00的时间戳
function getNextDayResetTime(beijingTime) {
  const tomorrow = new Date(beijingTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.getTime();
}

/**
 * 检查频率限制
 * @param {Object} req - Express 请求对象
 * @param {boolean} isVip - 是否是 VIP 用户
 * @returns {Object} 检查结果 { allowed: boolean, remaining: number, total: number, resetTime: number, error?: Object }
 */
async function checkRateLimit(req, isVip) {
  // 获取用户标识
  let userKey;
  if (req.user && req.user.id) {
    userKey = `${RATE_LIMIT_CONFIG.REDIS_KEY_PREFIX}:user:${req.user.id}`;
  } else if (req.securityContext && req.securityContext.fingerprint) {
    userKey = `${RATE_LIMIT_CONFIG.REDIS_KEY_PREFIX}:fingerprint:${req.securityContext.fingerprint}`;
  } else {
    return {
      allowed: false,
      error: {
        code: 401,
        message: "无法识别用户身份，请刷新页面后重试",
        message_en: "Unable to identify user identity, please refresh the page and try again",
      },
    };
  }

  // 获取今天的日期（北京时间）
  const now = new Date();
  const beijingTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
  );
  const today = beijingTime.toISOString().split("T")[0];
  const dailyKey = `${userKey}:${today}`;

  // 每日限额
  const maxCalls = isVip
    ? RATE_LIMIT_CONFIG.VIP_USER_DAILY_LIMIT
    : RATE_LIMIT_CONFIG.FREE_USER_DAILY_LIMIT;

  // 检查今日调用次数
  const currentCount = parseInt((await req.redisClient.get(dailyKey)) || 0);

  if (currentCount >= maxCalls) {
    return {
      allowed: false,
      error: {
        code: 429,
        message: `今日已使用 ${currentCount}/${maxCalls} 次，请明天再试`,
        message_en: `You have used ${currentCount}/${maxCalls} times today, please try again tomorrow`,
        resetTime: getNextDayResetTime(beijingTime),
      },
    };
  }

  // 增加调用次数
  const newCount = await req.redisClient.incr(dailyKey);

  // 设置过期时间到明天00:00（北京时间）
  if (newCount === 1) {
    const secondsUntilMidnight = getSecondsUntilMidnight(beijingTime);
    await req.redisClient.expire(dailyKey, secondsUntilMidnight);
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxCalls - newCount),
    total: maxCalls,
    used: newCount,
    resetTime: getNextDayResetTime(beijingTime),
  };
}

/**
 * GET /kol-chat/list - 获取 KOL 列表
 *
 * 响应示例:
 * {
 *   "code": 200,
 *   "message": "success",
 *   "data": [
 *     { "id": "cz", "name": "CZ", "twitter_handle": "cz_binance", "description": "Binance创始人" }
 *   ]
 * }
 */
router.get("/list", [authenticateToken], async (req, res) => {
  try {
    const response = await axios.get(`${KOL_CHAT_BASE_URL}/kol/list`, {
      timeout: 10000, // 10秒超时
    });

    // 透传后端响应
    res.json(response.data);
  } catch (error) {
    console.error("[KOL Chat] 获取 KOL 列表失败:", error.message);

    // 根据错误类型返回不同的错误码
    if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
      return res.status(503).json({
        code: 503,
        message: "KOL Chat 服务暂时不可用",
        message_en: "KOL Chat service is temporarily unavailable",
      });
    }

    res.status(500).json({
      code: 500,
      message: "获取 KOL 列表失败，请稍后重试",
      message_en: "Failed to get KOL list, please try again later",
    });
  }
});

/**
 * GET /kol-chat/quota - 获取当前用户的聊天配额
 *
 * 响应示例:
 * {
 *   "code": 200,
 *   "data": {
 *     "isVip": false,
 *     "total": 10,
 *     "used": 3,
 *     "remaining": 7,
 *     "resetTime": 1751414400000
 *   }
 * }
 */
router.get("/quota", [authenticateToken], async (req, res) => {
  try {
    const isVip = isRequestXHuntVip(req);

    // 获取用户标识
    let userKey;
    if (req.user && req.user.id) {
      userKey = `${RATE_LIMIT_CONFIG.REDIS_KEY_PREFIX}:user:${req.user.id}`;
    } else if (req.securityContext && req.securityContext.fingerprint) {
      userKey = `${RATE_LIMIT_CONFIG.REDIS_KEY_PREFIX}:fingerprint:${req.securityContext.fingerprint}`;
    } else {
      return res.status(400).json({
        code: 400,
        message: "无法识别用户身份",
        message_en: "Unable to identify user identity",
      });
    }

    // 获取今天的日期（北京时间）
    const now = new Date();
    const beijingTime = new Date(
      now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
    );
    const today = beijingTime.toISOString().split("T")[0];
    const dailyKey = `${userKey}:${today}`;

    // 获取今日已使用次数
    const usedCount = parseInt((await req.redisClient.get(dailyKey)) || 0);
    const maxCalls = isVip
      ? RATE_LIMIT_CONFIG.VIP_USER_DAILY_LIMIT
      : RATE_LIMIT_CONFIG.FREE_USER_DAILY_LIMIT;

    res.json({
      code: 200,
      message: "success",
      data: {
        isVip,
        total: maxCalls,
        used: usedCount,
        remaining: Math.max(0, maxCalls - usedCount),
        resetTime: getNextDayResetTime(beijingTime),
      },
    });
  } catch (error) {
    console.error("[KOL Chat] 获取配额失败:", error);
    res.status(500).json({
      code: 500,
      message: "获取配额信息失败",
      message_en: "Failed to get quota information",
    });
  }
});

/**
 * POST /kol-chat/chat - 与 KOL AI 分身聊天
 *
 * 请求体示例:
 * {
 *   "kol_id": "cz",
 *   "messages": [
 *     { "role": "user", "content": "你好" }
 *   ]
 * }
 *
 * 响应示例:
 * {
 *   "code": 200,
 *   "message": "success",
 *   "data": {
 *     "kol_id": "cz",
 *     "reply": "这是 CZ 的回答..."
 *   }
 * }
 */
router.post(
  "/chat",
  [
    authenticateToken,
    body("kol_id")
      .notEmpty()
      .withMessage("KOL ID 不能为空")
      .isString()
      .withMessage("KOL ID 必须是字符串"),
    body("messages")
      .isArray({ min: 1 })
      .withMessage("messages 必须是至少包含一条消息的数组"),
    body("messages.*.role")
      .notEmpty()
      .withMessage("每条消息必须有 role 字段")
      .isIn(["user", "assistant"])
      .withMessage("role 必须是 user 或 assistant"),
    body("messages.*.content")
      .notEmpty()
      .withMessage("每条消息必须有 content 字段")
      .isString()
      .withMessage("content 必须是字符串"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const isVip = isRequestXHuntVip(req);

      // 检查频率限制
      const rateLimitCheck = await checkRateLimit(req, isVip);
      if (!rateLimitCheck.allowed) {
        res.setHeader("X-RateLimit-Limit", rateLimitCheck.total);
        res.setHeader("X-RateLimit-Remaining", 0);
        res.setHeader("X-RateLimit-Reset", rateLimitCheck.error.resetTime);
        return res.status(429).json(rateLimitCheck.error);
      }

      const { kol_id, messages } = req.body;

      // 转发请求到 KOL Chat Backend
      const response = await axios.post(
        `${KOL_CHAT_BASE_URL}/kol/chat`,
        {
          kol_id,
          messages,
        },
        {
          timeout: 125000, // 125秒超时（后端最长120秒）
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      // 添加配额信息到响应头
      res.setHeader("X-RateLimit-Limit", rateLimitCheck.total);
      res.setHeader("X-RateLimit-Remaining", rateLimitCheck.remaining);
      res.setHeader("X-RateLimit-Reset", rateLimitCheck.resetTime);

      // 透传后端响应
      res.json(response.data);
    } catch (error) {
      console.error("[KOL Chat] 聊天请求失败:", error.message);

      // 如果后端返回了错误响应，透传错误信息
      if (error.response && error.response.data) {
        const backendError = error.response.data;
        return res.status(error.response.status || 500).json({
          code: backendError.code || 500,
          message: backendError.message || "聊天请求失败",
          message_en: "Chat request failed",
        });
      }

      // 根据错误类型返回不同的错误码
      if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
        return res.status(503).json({
          code: 503,
          message: "KOL Chat 服务暂时不可用",
          message_en: "KOL Chat service is temporarily unavailable",
        });
      }

      res.status(500).json({
        code: 500,
        message: "聊天请求失败，请稍后重试",
        message_en: "Chat request failed, please try again later",
      });
    }
  }
);

module.exports = router;
