const express = require("express");
const { body } = require("express-validator");
const axios = require("axios");
const { validateRequest } = require("../middleware/validate-request");
const { authenticateToken } = require("../middleware/auth");
const { checkProStatusRequired } = require("../middleware/pro-status");
const {  isXHuntVipHandle } = require("../constants/xhuntVip");

const router = express.Router();

// 配额配置
const QUOTA_CONFIG = {
  normal: 2000,
  vip: 5000,
  periodDays: 30,
};

// Following 接口配额配置（独立）
const FOLLOWING_QUOTA_CONFIG = {
  monthlyLimit: 150,
  periodDays: 30,
};

// Redis Key 前缀
const REDIS_KEY_PREFIX = "xhunt:ghost:new";
// Following 额度独立的 Key 前缀
const FOLLOWING_REDIS_KEY_PREFIX = "xhunt:ghost:following:new";

// ======== CryptoHunt Pro API 配置 ========
const PRO_API_CONFIG = {
  baseUrl: process.env.PRO_API_BASE_URL || "http://172.31.0.2:3001",
  apiKey: process.env.PRO_API_KEY || "bd1cbd94-20e5-42a2-96cd-e4313ea2154d",
};

// ======== 熔断器配置 ========
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 20,        // 连续失败 5 次触发熔断
  timeout: 30000,             // 熔断 30 秒后尝试恢复
  successThreshold: 2,        // 半开状态下成功 2 次恢复
};

// 熔断器状态存储（内存级，服务重启后重置）
const circuitBreakers = new Map();

/**
 * 熔断器类
 */
class CircuitBreaker {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.state = 'CLOSED';      // CLOSED:正常, OPEN:熔断, HALF_OPEN:半开
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  /**
   * 检查是否允许请求通过
   */
  canExecute() {
    if (this.state === 'CLOSED') {
      return { allowed: true };
    }

    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now >= this.nextAttemptTime) {
        // 熔断时间到，进入半开状态
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        console.log(`[CircuitBreaker:${this.name}] State changed: OPEN -> HALF_OPEN`);
        return { allowed: true };
      }
      const remainingMs = this.nextAttemptTime - now;
      return { 
        allowed: false, 
        reason: `Circuit breaker is OPEN. Retry after ${Math.ceil(remainingMs / 1000)}s` 
      };
    }

    // HALF_OPEN: 允许少量请求通过测试
    return { allowed: true, isTest: true };
  }

  /**
   * 记录成功
   */
  recordSuccess() {
    this.failureCount = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'CLOSED';
        this.successCount = 0;
        console.log(`[CircuitBreaker:${this.name}] State changed: HALF_OPEN -> CLOSED`);
      }
    }
  }

  /**
   * 记录失败
   */
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // 半开状态下失败，立即熔断
      this.trip();
    } else if (this.state === 'CLOSED' && this.failureCount >= this.config.failureThreshold) {
      // 达到失败阈值，触发熔断
      this.trip();
    }
  }

  /**
   * 触发熔断
   */
  trip() {
    this.state = 'OPEN';
    this.nextAttemptTime = Date.now() + this.config.timeout;
    console.error(`[CircuitBreaker:${this.name}] State changed: CLOSED -> OPEN. Will retry after ${this.config.timeout}ms`);
  }

  /**
   * 获取当前状态
   */
  getState() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
    };
  }
}

/**
 * 获取或创建熔断器
 */
function getCircuitBreaker(name) {
  if (!circuitBreakers.has(name)) {
    circuitBreakers.set(name, new CircuitBreaker(name, CIRCUIT_BREAKER_CONFIG));
  }
  return circuitBreakers.get(name);
}

// ======== 并发用户限制配置 ========
const CONCURRENT_LIMIT_CONFIG = {
  maxConcurrentUsers: 8,       // 最大并发用户数8人
  userActivityTTL: 60,          // 用户活跃状态保持时间（秒）
  redisKeyPrefix: "xhunt:ghost:concurrent",  // Redis key前缀
};

/**
 * 并发用户限制中间件
 * 基于Redis实现，60秒内有请求视为"在用"，每次请求重置倒计时
 */
async function concurrentUserLimit(req, res, next) {
  const redisClient = req.redisClient || global.__xhuntRedis;
  
  if (!redisClient) {
    console.error("[concurrent-limit] Redis client not available");
    // Redis不可用时放行，不阻塞业务
    return next();
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      // 未登录用户不限制（理论上不会走到这里，因为有authenticateToken前置）
      return next();
    }

    const { maxConcurrentUsers, userActivityTTL, redisKeyPrefix } = CONCURRENT_LIMIT_CONFIG;
    const userKey = `${redisKeyPrefix}:user:${userId}`;

    // 1. 检查该用户是否已经在活跃列表中
    const userExists = await redisClient.exists(userKey);

    if (userExists) {
      // 用户已在活跃列表中，刷新TTL（重置60秒倒计时）
      await redisClient.expire(userKey, userActivityTTL);
      console.log(`[concurrent-limit] User ${userId} refreshed activity, TTL reset to ${userActivityTTL}s`);
      return next();
    }

    // 2. 用户不在活跃列表中，需要检查当前活跃用户数
    const pattern = `${redisKeyPrefix}:user:*`;
    let activeCount = 0;
    let cursor = 0;
    
    do {
      const result = await redisClient.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = result.cursor;
      // 过滤掉即将过期的key（TTL <= 0 表示已过期）
      for (const key of result.keys) {
        const ttl = await redisClient.ttl(key);
        if (ttl > 0) {
          activeCount++;
        }
      }
    } while (cursor !== 0);

    if (activeCount >= maxConcurrentUsers) {
      // 已达上限，返回特殊错误码
      console.log(`[concurrent-limit] User ${userId} rejected, max concurrent users (${maxConcurrentUsers}) reached`);
      const now = Date.now();
      const nextApplyAt = now + userActivityTTL * 1000; // retryAfter 秒后重试
      return res.status(429).json({
        success: false,
        error: {
          code: "CONCURRENT_LIMIT_EXCEEDED",
          message: "当前使用人数过多，请稍后再试",
          data: {
            total: maxConcurrentUsers,
            used: activeCount,
            nextApplyAt: nextApplyAt,
            waitDays: 0,
            waitHours: 0,
            maxConcurrentUsers,
            currentActiveUsers: activeCount,
            retryAfter: userActivityTTL, // 建议客户端60秒后重试
          },
        },
      });
    }

    // 3. 未满员，加入活跃列表
    await redisClient.set(userKey, Date.now().toString(), { EX: userActivityTTL });
    
    console.log(`[concurrent-limit] User ${userId} added to active list, count: ${activeCount + 1}/${maxConcurrentUsers}`);

    next();
  } catch (error) {
    console.error("[concurrent-limit] Error:", error);
    // 中间件出错时不阻塞请求，记录日志后放行
    next();
  }
}

// ======== 额度原子扣除 Lua 脚本 ========
// KEYS[1]: quotaKey
// ARGV[1]: 当前时间戳
// ARGV[2]: VIP额度
// ARGV[3]: 普通额度
// ARGV[4]: 额度有效期(秒)
const ATOMIC_DEDUCT_QUOTA_LUA = `
local quotaKey = KEYS[1]
local historyKey = KEYS[2]
local now = tonumber(ARGV[1])
local vipQuota = tonumber(ARGV[2])
local normalQuota = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

-- 获取当前额度
local quota = redis.call('hGetAll', quotaKey)
local remaining = nil
local total = nil
local appliedAt = nil

-- 解析额度数据
for i = 1, #quota, 2 do
  if quota[i] == 'remaining' then
    remaining = tonumber(quota[i + 1])
  elseif quota[i] == 'total' then
    total = tonumber(quota[i + 1])
  elseif quota[i] == 'appliedAt' then
    appliedAt = tonumber(quota[i + 1])
  end
end

-- 获取上次申请时间
local lastApplied = redis.call('hGet', historyKey, 'lastAppliedAt')
local lastAppliedAt = lastApplied and tonumber(lastApplied) or nil

local periodMs = ttl * 1000  -- 转毫秒

-- 检查是否过期（超过30天）
local isExpired = false
if appliedAt then
  if now - appliedAt >= periodMs then
    isExpired = true
  end
end

-- 如果没有额度 或 剩余<=0 或 已过期，都触发申请新额度逻辑
if remaining == nil or remaining <= 0 or isExpired then
  -- 检查是否可以申请新额度（需要满足30天冷却期）
  local canApply = true
  if lastAppliedAt then
    if now - lastAppliedAt < periodMs then
      canApply = false
    end
  end
  
  if canApply then
    -- 自动申请新额度
    total = vipQuota
    remaining = vipQuota - 1  -- 扣除1次
    appliedAt = now
    
    -- 写入新额度
    redis.call('hSet', quotaKey, 'total', tostring(total))
    redis.call('hSet', quotaKey, 'remaining', tostring(remaining))
    redis.call('hSet', quotaKey, 'appliedAt', tostring(appliedAt))
    redis.call('expire', quotaKey, ttl)
    redis.call('hSet', historyKey, 'lastAppliedAt', tostring(now))
    
    return {remaining, total, appliedAt, 1}  -- 最后1表示是新额度
  else
    -- 不能申请新额度，返回错误
    return {-1, total or 0, lastAppliedAt or 0, 0}  -- -1表示额度不足
  end
else
  -- 有额度且未过期，直接扣除
  remaining = redis.call('hIncrBy', quotaKey, 'remaining', -1)
  return {remaining, total, appliedAt, 0}  -- 最后0表示不是新额度
end
`;

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
 * 扣除额度（原子化操作）
 * 使用 Lua 脚本保证「检查 + 扣除 + 自动申请」的原子性
 * @returns {Object} { success, remaining, total, appliedAt, isNewQuota, error }
 */
async function atomicDeductQuota(redisClient, userId, isVip) {
  const quotaKey = getQuotaKey(userId);
  const historyKey = getHistoryKey(userId);
  
  const totalQuota = isVip ? QUOTA_CONFIG.vip : QUOTA_CONFIG.normal;
  const now = Date.now();
  const ttlSeconds = QUOTA_CONFIG.periodDays * 24 * 60 * 60;
  
  try {
    // 使用 Lua 脚本原子化执行
    const result = await redisClient.eval(ATOMIC_DEDUCT_QUOTA_LUA, {
      keys: [quotaKey, historyKey],
      arguments: [
        now.toString(),
        totalQuota.toString(),
        QUOTA_CONFIG.normal.toString(),
        ttlSeconds.toString(),
      ],
    });
    
    const [remaining, total, appliedAt, isNewQuotaFlag] = result;
    
    if (remaining === -1) {
      // 额度不足且无法申请
      return {
        success: false,
        error: 'QUOTA_COOLDOWN',
        lastAppliedAt: appliedAt,
      };
    }
    
    return {
      success: true,
      remaining,
      total,
      appliedAt,
      isNewQuota: isNewQuotaFlag === 1,
    };
  } catch (error) {
    console.error('[ghost-following] Atomic deduct quota error:', error);
    throw error;
  }
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
    concurrentUserLimit,
    body("user_id")
      .trim()
      .notEmpty()
      .withMessage("user_id is required")
      .isNumeric()
      .withMessage("user_id must be a numeric string"),
    body("handle")
      .trim()
      .notEmpty()
      .withMessage("handle is required"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const isVip = isXHuntVipHandle(req.user?.username);
      const { user_id, handle } = req.body;
      const redisClient = req.redisClient || global.__xhuntRedis;

      if (!redisClient) {
        console.error(`analyze return ${user_id} Redis client not available`);
        return res.status(500).json({
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Service temporarily unavailable" },
        });
      }

      // 2. 原子化扣除额度（检查 + 扣除 + 自动申请）
      const quotaResult = await atomicDeductQuota(redisClient, userId, isVip);
      
      if (!quotaResult.success) {
        // 额度不足且无法申请新额度
        const { waitDays, waitHours, nextApplyAt } = calculateWaitTime(
          quotaResult.lastAppliedAt
        );
        const total = isVip ? QUOTA_CONFIG.vip : QUOTA_CONFIG.normal;
        
        console.log(`analyze return ${user_id} QUOTA_COOLDOWN`);
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
      
      const { remaining: newRemaining, total, appliedAt, isNewQuota } = quotaResult;
      const currentQuota = { total, remaining: quotaResult.remaining, appliedAt };

      // 4. 调用外部 API 获取推文数据（带熔断器保护）
      let analysisResult;
      const circuitBreaker = getCircuitBreaker('ghost-following-api');
      
      // 检查熔断器状态
      const cbCheck = circuitBreaker.canExecute();
      if (!cbCheck.allowed) {
        console.warn(`analyze return ${user_id} Circuit breaker rejected: ${cbCheck.reason}`);
        return res.status(503).json({
          success: false,
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "服务暂时不可用，请稍后重试",
            retryAfter: Math.ceil(CIRCUIT_BREAKER_CONFIG.timeout / 1000),
          },
        });
      }
      
      try {
        // 调用 /tweet/kol_tweets 获取推文（使用前端传入的 handle）
        const response = await axios.post(
          `${PRO_API_CONFIG.baseUrl}/tweet/kol_tweets`,
          {
            handle: handle,
            offset: 0,
            verbose: false,
          },
          {
            timeout: 10000,
            headers: {
              "X-API-KEY": PRO_API_CONFIG.apiKey,
              "Content-Type": "application/json",
            },
          }
        );

        // API 调用成功，记录成功
        circuitBreaker.recordSuccess();

        // 新接口返回格式: 直接是数组 [...]
        if (Array.isArray(response.data)) {
          const tweets = response.data;
          
          if (tweets.length > 0) {
            // 取最新的一条推文
            const tweet = tweets[0];
            const tweetTime = new Date(tweet.create_time).getTime();
            const now = Date.now();
            const days28Ms = 28 * 24 * 60 * 60 * 1000;
            
            // 如果推文是 28 天前的旧数据，调用第二个接口确认
            if (now - tweetTime > days28Ms) {
              console.log(`analyze return ${user_id} Tweet ${tweet.id} is older than 28 days, verifying with second API`);
              analysisResult = await verifyEmptyUserWithSecondApi(user_id);
            } else {
              // 数据正常，直接使用
              analysisResult = {
                id: tweet.id,
                create_time: tweet.create_time || null,
                html: String(tweet.info?.html).slice(0, 20) || 'tweet html',
                twitter_user_id: tweet.twitter_user_id || user_id,
              };
            }
          } else {
            // KOL tweets 返回空，调用第二个接口进行二次确认
            // 可能是因为用户不是被追踪的 KOL
            console.log(`analyze return ${user_id} KOL tweets empty, using second API`);
            analysisResult = await verifyEmptyUserWithSecondApi(user_id);
          }
        } else {
          console.log(`analyze return ${user_id} KOL tweets invalid response`);
          analysisResult = await verifyEmptyUserWithSecondApi(user_id);
        }
      } catch (apiError) {
        console.error(`analyze return ${user_id} First API request failed:`, apiError.message);
        circuitBreaker.recordFailure();
        
        // 第一个接口失败，尝试第二个接口
        // 如果第二个接口也失败，会抛出带状态码的错误，透传给外层处理
        analysisResult = await verifyEmptyUserWithSecondApi(user_id);
      }

      // 计算过期时间
      const expiresAt = currentQuota.appliedAt + QUOTA_CONFIG.periodDays * 24 * 60 * 60 * 1000;
      const expiresInDays = Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));

      console.log(`analyze return ${user_id} SUCCESS`);
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
      console.error(`analyze return ${user_id} ERROR:`, error);
      // 如果有状态码（来自外部API），透传；否则返回500
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: { 
          code: statusCode === 500 ? "INTERNAL_ERROR" : "EXTERNAL_API_ERROR", 
          message: error.message || "Analysis failed" 
        },
      });
    }
  }
);

/**
 * GET /api/xhunt/ghost-following/quota
 * 查询额度接口（返回 analyze 和 following 两套额度）
 */
router.get(
  "/quota",
  [authenticateToken, checkProStatusRequired],
  async (req, res) => {
    try {
      const userId = req.user.id;// Pro 状态（用于权限检查）
      const isVip = isXHuntVipHandle(req.user?.username);  // VIP 状态（用于额度计算）
      const redisClient = req.redisClient || global.__xhuntRedis;

      if (!redisClient) {
        console.error("[ghost-following] Redis client not available");
        return res.status(500).json({
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Service temporarily unavailable" },
        });
      }

      // ====== Analyze 额度 ======
      let quotaInfo = await getUserQuota(redisClient, userId);
      const totalQuota = isVip ? QUOTA_CONFIG.vip : QUOTA_CONFIG.normal;

      let analyzeData;

      // 无额度记录
      if (!quotaInfo.exists) {
        const canApply = canApplyNewQuota(quotaInfo.lastAppliedAt);
        const waitInfo = quotaInfo.lastAppliedAt
          ? calculateWaitTime(quotaInfo.lastAppliedAt)
          : { waitDays: 0, nextApplyAt: null };

        analyzeData = {
          status: quotaInfo.lastAppliedAt ? "cooldown" : "none",
          quota: { total: 0, remaining: 0, used: 0 },
          appliedAt: null,
          expiresAt: null,
          nextApplyAt: canApply ? null : waitInfo.nextApplyAt,
          waitDays: canApply ? 0 : waitInfo.waitDays,
          canApplyNow: canApply,
          expiresInDays: 0,
        };
      } else {
        // 有额度记录，先检查是否过期（超过30天）
        const expiresAt = quotaInfo.appliedAt + QUOTA_CONFIG.periodDays * 24 * 60 * 60 * 1000;
        const isExpired = Date.now() > expiresAt;
        
        if (isExpired) {
          // 额度已过期，自动创建新额度
          const canApply = canApplyNewQuota(quotaInfo.appliedAt);
          
          if (canApply) {
            // 可以申请新额度，自动重置
            const now = Date.now();
            const ttlSeconds = QUOTA_CONFIG.periodDays * 24 * 60 * 60;
            const quotaKey = getQuotaKey(userId);
            const historyKey = getHistoryKey(userId);
            
            const newQuotaData = {
              total: totalQuota.toString(),
              remaining: totalQuota.toString(),
              appliedAt: now.toString(),
            };
            
            await redisClient.hSet(quotaKey, newQuotaData);
            await redisClient.expire(quotaKey, ttlSeconds);
            await redisClient.hSet(historyKey, "lastAppliedAt", now.toString());
            
            // 使用新额度数据
            quotaInfo = {
              exists: true,
              total: totalQuota,
              remaining: totalQuota,
              appliedAt: now,
              lastAppliedAt: now,
            };
            
            const newExpiresAt = now + ttlSeconds * 1000;
            
            analyzeData = {
              status: "active",
              quota: { total: totalQuota, remaining: totalQuota, used: 0 },
              appliedAt: now,
              expiresAt: newExpiresAt,
              nextApplyAt: null,
              waitDays: 0,
              canApplyNow: false,
              expiresInDays: QUOTA_CONFIG.periodDays,
            };
          } else {
            // 不能申请新额度（30天冷却期未到），返回等待状态
            const waitInfo = calculateWaitTime(quotaInfo.appliedAt);
            analyzeData = {
              status: "cooldown",
              quota: { total: 0, remaining: 0, used: 0 },
              appliedAt: null,
              expiresAt: null,
              nextApplyAt: waitInfo.nextApplyAt,
              waitDays: waitInfo.waitDays,
              canApplyNow: false,
              expiresInDays: 0,
            };
          }
        } else {
          // 未过期，正常返回
          const used = quotaInfo.total - quotaInfo.remaining;
          const hasRemaining = quotaInfo.remaining > 0;

          let status;
          if (hasRemaining) {
            status = "active";
          } else {
            status = "exhausted";
          }

          const canApply = canApplyNewQuota(quotaInfo.appliedAt);
          const waitInfo = calculateWaitTime(quotaInfo.appliedAt);

          analyzeData = {
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
            expiresInDays: Math.max(
              0,
              Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000))
            ),
          };
        }
      }

      // ====== Following 额度 ======
      let followingQuotaInfo = await getUserFollowingQuota(redisClient, userId);

      // 如果额度不存在或已过期，自动创建新额度
      let followingData;
      if (!followingQuotaInfo || Date.now() > followingQuotaInfo.resetAt) {
        // 自动创建新额度
        followingQuotaInfo = await createFollowingQuota(redisClient, userId);
        
        followingData = {
          status: "active",
          quota: { 
            total: FOLLOWING_QUOTA_CONFIG.monthlyLimit, 
            remaining: FOLLOWING_QUOTA_CONFIG.monthlyLimit, 
            used: 0 
          },
          resetAt: followingQuotaInfo.resetAt,
          expiresInDays: FOLLOWING_QUOTA_CONFIG.periodDays,
        };
      } else {
        const used = followingQuotaInfo.total - followingQuotaInfo.remaining;
        const hasRemaining = followingQuotaInfo.remaining > 0;

        let status;
        if (hasRemaining) {
          status = "active";
        } else {
          status = "exhausted";
        }

        followingData = {
          status,
          quota: {
            total: followingQuotaInfo.total,
            remaining: followingQuotaInfo.remaining,
            used,
          },
          resetAt: followingQuotaInfo.resetAt,
          expiresInDays: Math.max(
            0,
            Math.ceil((followingQuotaInfo.resetAt - Date.now()) / (24 * 60 * 60 * 1000))
          ),
        };
      }

      return res.json({
        success: true,
        data: {
          isVip,
          analyze: analyzeData,
          following: followingData,
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

/**
 * 获取 Following 额度 Redis Key
 */
function getFollowingQuotaKey(userId) {
  return `${FOLLOWING_REDIS_KEY_PREFIX}:${userId}:quota`;
}

/**
 * 获取用户 Following 额度信息
 */
async function getUserFollowingQuota(redisClient, userId) {
  const quotaKey = getFollowingQuotaKey(userId);
  const quotaData = await redisClient.hGetAll(quotaKey);

  if (!quotaData || Object.keys(quotaData).length === 0) {
    return null;
  }

  return {
    total: parseInt(quotaData.total) || 0,
    remaining: parseInt(quotaData.remaining) || 0,
    resetAt: parseInt(quotaData.resetAt) || 0,
  };
}

/**
 * 创建/重置 Following 额度
 */
async function createFollowingQuota(redisClient, userId) {
  const quotaKey = getFollowingQuotaKey(userId);
  const total = FOLLOWING_QUOTA_CONFIG.monthlyLimit;
  const now = Date.now();
  const ttlSeconds = FOLLOWING_QUOTA_CONFIG.periodDays * 24 * 60 * 60;
  const resetAt = now + ttlSeconds * 1000;

  const quotaData = {
    total: total.toString(),
    remaining: total.toString(),
    resetAt: resetAt.toString(),
  };

  await redisClient.hSet(quotaKey, quotaData);
  await redisClient.expire(quotaKey, ttlSeconds);

  return {
    total,
    remaining: total,
    resetAt,
  };
}

/**
 * POST /api/xhunt/ghost-following/following
 * 获取用户关注列表（调用 /social/following 接口）
 * 每月限额 150 次，与 analyze 额度独立
 */
router.post(
  "/following",
  [
    authenticateToken,
    checkProStatusRequired,
    body("user_id")
      .trim()
      .notEmpty()
      .withMessage("user_id is required")
      .isNumeric()
      .withMessage("user_id must be a numeric string"),
    body("cursor").optional().isString().withMessage("cursor must be a string"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { user_id, cursor = "" } = req.body;
      const redisClient = req.redisClient || global.__xhuntRedis;

      if (!redisClient) {
        console.error("[ghost-following] Redis client not available");
        return res.status(500).json({
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Service temporarily unavailable" },
        });
      }

      // 1. 检查 Following 额度
      let quotaInfo = await getUserFollowingQuota(redisClient, userId);

      // 如果额度不存在或已过期，创建新额度
      if (!quotaInfo || Date.now() > quotaInfo.resetAt) {
        quotaInfo = await createFollowingQuota(redisClient, userId);
      }

      // 检查剩余额度
      if (quotaInfo.remaining <= 0) {
        const waitMs = quotaInfo.resetAt - Date.now();
        const waitDays = Math.ceil(waitMs / (24 * 60 * 60 * 1000));

        return res.status(403).json({
          success: false,
          error: {
            code: "FOLLOWING_QUOTA_EXHAUSTED",
            message: "本月关注列表查询额度已用完",
            data: {
              total: FOLLOWING_QUOTA_CONFIG.monthlyLimit,
              used: FOLLOWING_QUOTA_CONFIG.monthlyLimit,
              remaining: 0,
              resetAt: quotaInfo.resetAt,
              waitDays: Math.max(0, waitDays),
            },
          },
        });
      }

      // 2. 扣除额度
      const quotaKey = getFollowingQuotaKey(userId);
      const newRemaining = await redisClient.hIncrBy(quotaKey, "remaining", -1);

      // 3. 调用外部 API (/social/following)
      const response = await axios.post(
        `${PRO_API_CONFIG.baseUrl}/social/following`,
        {
          user_id: user_id,
          cursor: cursor || "",
        },
        {
          timeout: 30000, // 30秒超时
          headers: {
            "X-API-KEY": PRO_API_CONFIG.apiKey,
            "Content-Type": "application/json",
          },
        }
      );

      // 4. 返回结果（包含额度信息）
      return res.json({
        success: true,
        data: {
          quota: {
            total: quotaInfo.total,
            remaining: Math.max(0, newRemaining),
            used: quotaInfo.total - Math.max(0, newRemaining),
            resetAt: quotaInfo.resetAt,
          },
          result: response.data,
        },
      });
    } catch (error) {
      console.error("[ghost-following] Following API error:", error.message);
      
      // 如果是外部 API 返回的错误，透传状态码和错误信息
      if (error.response) {
        const { status, data } = error.response;
        return res.status(status).json({
          success: false,
          error: {
            code: data?.code || "EXTERNAL_API_ERROR",
            message: data?.message || "External API request failed",
          },
        });
      }

      return res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Failed to fetch following list" },
      });
    }
  }
);

/**
 * 当第一个接口返回空时，调用第二个接口进行二次确认
 * @param {string} user_id - Twitter 用户 ID
 * @returns {Object} - 分析结果
 */
async function verifyEmptyUserWithSecondApi(user_id) {
  try {
    const response = await axios.post(
      `${PRO_API_CONFIG.baseUrl}/tweet/user_tweets`,
      {
        user_id: user_id,
        // cursor: "",
      },
      {
        timeout: 15000, // 15秒超时
        headers: {
          "X-API-KEY": PRO_API_CONFIG.apiKey,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data && Array.isArray(response.data.tweets)) {
      const tweets = response.data.tweets;
      
      if (tweets.length > 0) {
        // 按 created_at 时间排序（最新的排在最前面），然后取最新的一条
        // 注意：第一条可能是用户置顶的推文，不一定是时间最新的
        const sortedTweets = [...tweets].sort((a, b) => {
          const timeA = new Date(a.created_at).getTime();
          const timeB = new Date(b.created_at).getTime();
          return timeB - timeA; // 降序，最新的在前
        });
        
        const tweet = sortedTweets[0]; // 取时间最新的一条
        // 优先使用 created_at (Twitter 原始格式)
        const createTime = tweet.created_at || null;
        console.log(`analyze return ${user_id} Second API found tweets, ${String(tweet.html).slice(0, 20)} ${tweet.created_at}`);
        return {
          id: tweet.id,
          create_time: createTime,
          html: String(tweet.html).slice(0, 20) || 'tweet html',
          twitter_user_id: tweet.user_id || user_id,
          verified: true,
          source: "pro_api",
        };
      } else {
        // 第二个接口也确认没有推文，调用第三个接口检查是否锁推
        console.log(`analyze return ${user_id} Second API empty, checking protected status`);
        return await checkUserProtectedStatus(user_id);
      }
    } else {
      // 第二个接口返回异常格式
      console.log(`analyze return ${user_id} Second API invalid response`);
      const error = new Error("Second API invalid response format");
      error.statusCode = 500;
      throw error;
    }
  } catch (apiError) {
    console.error(`analyze return ${user_id} Second API verification failed:`, apiError.message);
    
    // 外部API返回什么状态码就抛出什么状态码
    if (apiError.response) {
      const error = new Error(apiError.response.data?.message || apiError.message);
      error.statusCode = apiError.response.status;
      throw error;
    }
    
    // 其他错误返回500
    const error = new Error(apiError.message);
    error.statusCode = 500;
    throw error;
  }
}

/**
 * 检查用户是否锁推（当第二个接口返回空时调用）
 * @param {string} user_id - Twitter 用户 ID
 * @param {string} apiKey - API Key
 * @returns {Object} - 用户状态信息
 */
async function checkUserProtectedStatus(user_id) {
  try {
    const response = await axios.post(
      `${PRO_API_CONFIG.baseUrl}/user/profile_by_userid`,
      {
        user_id: user_id,
      },
      {
        timeout: 10000, // 10秒超时
        headers: {
          "X-API-KEY": PRO_API_CONFIG.apiKey,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data) {
      const profile = response.data;
      const isProtected = profile.protected === true;
      
      console.log(`analyze return ${user_id} Third API profile check success, protected=${isProtected}`);
      return {
        id: null,
        create_time: null,
        html: null,
        twitter_user_id: user_id,
        protected: isProtected,
        message: isProtected 
          ? "User account is protected (private)" 
          : "No tweets found for this user (verified)",
        verified: true,
        source: "pro_api",
        profile: {
          id: profile.id,
          name: profile.name,
          username: profile.username,
          description: profile.description,
          protected: profile.protected,
          followers_count: profile.followers_count,
          following_count: profile.following_count,
          tweets_count: profile.tweets_count,
          is_blue_verified: profile.is_blue_verified,
          verified: profile.verified,
          created_at: profile.created_at,
          profile_image_url: profile.profile_image_url,
          profile_banner_url: profile.profile_banner_url,
        },
      };
    } else {
      // 第三个接口返回异常
      console.log(`analyze return ${user_id} Third API profile check invalid response`);
      const error = new Error("Third API profile check invalid response format");
      error.statusCode = 500;
      throw error;
    }
  } catch (error) {
    console.error(`analyze return ${user_id} Third API (profile check) failed:`, error.message);
    
    // 第三个接口失败，透传 API 错误
    if (error.response) {
      const err = new Error(error.response.data?.message || error.message);
      err.statusCode = error.response.status;
      throw err;
    }
    
    // 其他错误抛出 500
    const err = new Error(error.message);
    err.statusCode = 500;
    throw err;
  }
}

module.exports = router;
