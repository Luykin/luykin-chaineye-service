const express = require("express");
const { body } = require("express-validator");
const axios = require("axios");
const { validateRequest } = require("../middleware/validate-request");
const { authenticateToken } = require("../middleware/auth");
const { checkProStatusRequired } = require("../middleware/pro-status");

const router = express.Router();

// 配额配置
const QUOTA_CONFIG = {
  normal: 2000,
  vip: 5000,
  periodDays: 30,
};

// Redis Key 前缀
const REDIS_KEY_PREFIX = "xhunt:ghost";

/**
 * 获取额度 Redis Key
 */
function getQuotaKey(userId) {
  return `${REDIS_KEY_PREFIX}:${userId}:quota`;
}

/**
 * 获取历史记录 Redis Key
 */
function getHistoryKey(userId) {
  return `${REDIS_KEY_PREFIX}:${userId}:history`;
}

/**
 * 获取用户额度信息
 */
async function getUserQuota(redisClient, userId) {
  const quotaKey = getQuotaKey(userId);
  const historyKey = getHistoryKey(userId);

  const [quotaData, lastAppliedAt] = await Promise.all([
    redisClient.hGetAll(quotaKey),
    redisClient.hGet(historyKey, "lastAppliedAt"),
  ]);

  if (!quotaData || Object.keys(quotaData).length === 0) {
    return {
      exists: false,
      lastAppliedAt: lastAppliedAt ? parseInt(lastAppliedAt) : null,
    };
  }

  return {
    exists: true,
    total: parseInt(quotaData.total) || 0,
    remaining: parseInt(quotaData.remaining) || 0,
    appliedAt: parseInt(quotaData.appliedAt) || 0,
    lastAppliedAt: lastAppliedAt ? parseInt(lastAppliedAt) : null,
  };
}

/**
 * 创建新额度
 */
async function createQuota(redisClient, userId, isVip) {
  const quotaKey = getQuotaKey(userId);
  const historyKey = getHistoryKey(userId);

  const total = isVip ? QUOTA_CONFIG.vip : QUOTA_CONFIG.normal;
  const now = Date.now();
  const ttlSeconds = QUOTA_CONFIG.periodDays * 24 * 60 * 60;

  const quotaData = {
    total: total.toString(),
    remaining: total.toString(),
    appliedAt: now.toString(),
  };

  // 使用 Pipeline 执行多个命令
  const pipeline = redisClient.multi();
  pipeline.hSet(quotaKey, quotaData);
  pipeline.expire(quotaKey, ttlSeconds);
  pipeline.hSet(historyKey, "lastAppliedAt", now.toString());

  await pipeline.exec();

  return {
    total,
    remaining: total,
    appliedAt: now,
  };
}

/**
 * 扣除额度
 */
async function deductQuota(redisClient, userId) {
  const quotaKey = getQuotaKey(userId);
  const newRemaining = await redisClient.hIncrBy(quotaKey, "remaining", -1);
  return newRemaining;
}

/**
 * 检查是否可以申请新额度
 */
function canApplyNewQuota(lastAppliedAt) {
  if (!lastAppliedAt) return true;

  const now = Date.now();
  const periodMs = QUOTA_CONFIG.periodDays * 24 * 60 * 60 * 1000;

  return now - lastAppliedAt >= periodMs;
}

/**
 * 计算等待时间
 */
function calculateWaitTime(lastAppliedAt) {
  if (!lastAppliedAt) return { waitDays: 0, waitHours: 0, nextApplyAt: Date.now() };

  const periodMs = QUOTA_CONFIG.periodDays * 24 * 60 * 60 * 1000;
  const nextApplyAt = lastAppliedAt + periodMs;
  const waitMs = nextApplyAt - Date.now();

  return {
    waitDays: Math.ceil(waitMs / (24 * 60 * 60 * 1000)),
    waitHours: Math.ceil(waitMs / (60 * 60 * 1000)),
    nextApplyAt,
  };
}

/**
 * POST /api/xhunt/ghost-following/analyze
 * 消费额度接口（自动申请 + 分析）
 */
router.post(
  "/analyze",
  [
    authenticateToken,
    checkProStatusRequired,
    body("user_id")
      .trim()
      .notEmpty()
      .withMessage("user_id is required")
      .isNumeric()
      .withMessage("user_id must be a numeric string"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const isVip = req.isPro;
      const { user_id } = req.body;
      const redisClient = req.redisClient || global.__xhuntRedis;

      if (!redisClient) {
        console.error("[ghost-following] Redis client not available");
        return res.status(500).json({
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Service temporarily unavailable" },
        });
      }

      // 1. 获取当前额度信息
      const quotaInfo = await getUserQuota(redisClient, userId);

      let currentQuota;
      let isNewQuota = false;

      // 2. 判断是否需要自动申请额度
      if (!quotaInfo.exists || quotaInfo.remaining <= 0) {
        // 检查是否可以申请新额度
        if (!canApplyNewQuota(quotaInfo.lastAppliedAt)) {
          // 30天内已申请过且额度用完，进入冷却期
          const { waitDays, waitHours, nextApplyAt } = calculateWaitTime(
            quotaInfo.lastAppliedAt
          );
          const total = isVip ? QUOTA_CONFIG.vip : QUOTA_CONFIG.normal;

          return res.status(403).json({
            success: false,
            error: {
              code: "QUOTA_COOLDOWN",
              message: "本月额度已用完",
              data: {
                total,
                used: total,
                nextApplyAt,
                waitDays,
                waitHours,
              },
            },
          });
        }

        // 自动申请新额度
        currentQuota = await createQuota(redisClient, userId, isVip);
        isNewQuota = true;
      } else {
        currentQuota = {
          total: quotaInfo.total,
          remaining: quotaInfo.remaining,
          appliedAt: quotaInfo.appliedAt,
        };
      }

      // 3. 扣除额度
      const newRemaining = await deductQuota(redisClient, userId);

      // 4. 调用外部 API 获取推文数据
      let analysisResult;
      try {
        const apiUrl = `https://data.cryptohunt.ai/fetch/twitter/tweets?user_id=${user_id}&limit=1&offset=0`;
        const response = await axios.get(apiUrl, {
          timeout: 10000, // 10秒超时
          headers: {
            Accept: "application/json",
          },
        });

        if (response.data && response.data.code === 200 && response.data.data) {
          const tweets = response.data.data.data || [];
          
          if (tweets.length > 0) {
            const tweet = tweets[0];
            analysisResult = {
              id: tweet.id,
              create_time: tweet.create_time,
              html: tweet.info?.html || null,
              twitter_user_id: tweet.twitter_user_id,
            };
          } else {
            // 用户没有推文
            analysisResult = {
              id: null,
              create_time: null,
              html: null,
              twitter_user_id: user_id,
              message: "No tweets found for this user",
            };
          }
        } else {
          analysisResult = {
            id: null,
            create_time: null,
            html: null,
            twitter_user_id: user_id,
            message: "Failed to fetch tweets",
          };
        }
      } catch (apiError) {
        console.error("[ghost-following] API request failed:", apiError.message);
        analysisResult = {
          id: null,
          create_time: null,
          html: null,
          twitter_user_id: user_id,
          message: "Failed to fetch tweets: " + (apiError.message || "Unknown error"),
        };
      }

      // 计算过期时间
      const expiresAt = currentQuota.appliedAt + QUOTA_CONFIG.periodDays * 24 * 60 * 60 * 1000;
      const expiresInDays = Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));

      return res.json({
        success: true,
        data: {
          quota: {
            total: currentQuota.total,
            remaining: newRemaining,
            appliedAt: currentQuota.appliedAt,
            expiresAt,
            expiresInDays: Math.max(0, expiresInDays),
            isNewQuota,
          },
          result: analysisResult,
        },
      });
    } catch (error) {
      console.error("[ghost-following] Analyze error:", error);
      return res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Analysis failed" },
      });
    }
  }
);

/**
 * GET /api/xhunt/ghost-following/quota
 * 查询额度接口
 */
router.get(
  "/quota",
  [authenticateToken, checkProStatusRequired],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const isVip = req.isPro;
      const redisClient = req.redisClient || global.__xhuntRedis;

      if (!redisClient) {
        console.error("[ghost-following] Redis client not available");
        return res.status(500).json({
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Service temporarily unavailable" },
        });
      }

      const quotaInfo = await getUserQuota(redisClient, userId);
      const totalQuota = isVip ? QUOTA_CONFIG.vip : QUOTA_CONFIG.normal;

      // 无额度记录
      if (!quotaInfo.exists) {
        const canApply = canApplyNewQuota(quotaInfo.lastAppliedAt);
        const waitInfo = quotaInfo.lastAppliedAt
          ? calculateWaitTime(quotaInfo.lastAppliedAt)
          : { waitDays: 0, nextApplyAt: null };

        return res.json({
          success: true,
          data: {
            status: quotaInfo.lastAppliedAt ? "cooldown" : "none",
            quota: {
              total: 0,
              remaining: 0,
              used: 0,
            },
            appliedAt: null,
            expiresAt: null,
            nextApplyAt: canApply ? null : waitInfo.nextApplyAt,
            waitDays: canApply ? 0 : waitInfo.waitDays,
            canApplyNow: canApply,
            isVip,
          },
        });
      }

      // 有额度记录
      const used = quotaInfo.total - quotaInfo.remaining;
      const expiresAt =
        quotaInfo.appliedAt + QUOTA_CONFIG.periodDays * 24 * 60 * 60 * 1000;
      const hasRemaining = quotaInfo.remaining > 0;
      const isExpired = Date.now() > expiresAt;

      // 确定状态
      let status;
      if (isExpired) {
        status = "expired";
      } else if (hasRemaining) {
        status = "active";
      } else {
        status = "exhausted";
      }

      // 是否可以申请新额度
      const canApply = canApplyNewQuota(quotaInfo.appliedAt);
      const waitInfo = calculateWaitTime(quotaInfo.appliedAt);

      return res.json({
        success: true,
        data: {
          status,
          quota: {
            total: quotaInfo.total,
            remaining: quotaInfo.remaining,
            used,
          },
          appliedAt: quotaInfo.appliedAt,
          expiresAt,
          nextApplyAt: canApply ? null : waitInfo.nextApplyAt,
          waitDays: canApply ? 0 : waitInfo.waitDays,
          canApplyNow: canApply,
          isVip,
          expiresInDays: Math.max(
            0,
            Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000))
          ),
        },
      });
    } catch (error) {
      console.error("[ghost-following] Get quota error:", error);
      return res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Failed to get quota" },
      });
    }
  }
);

module.exports = router;
