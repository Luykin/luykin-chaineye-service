"use strict";

/**
 * 默认投票权重阶梯配置 (基于 XHunt kolRank20W 影响力排名)
 * 排名越前，权重越高：
 * - Top 1 ~ 1,000: 10
 * - Top 1,001 ~ 5,000: 8
 * - Top 5,001 ~ 50,000: 6
 * - Top 50,001 ~ 200,000: 4
 * - 未入榜 / > 200,000 / 查无排名: 1
 */
const DEFAULT_WEIGHT_RULES = [
  { maxRank: 1000, weight: 10 },
  { maxRank: 5000, weight: 8 },
  { maxRank: 50000, weight: 6 },
  { maxRank: 200000, weight: 4 },
];

const DEFAULT_BASE_WEIGHT = 1;
const CONFIG_CACHE_TTL_MS = 60 * 1000; // 内存缓存 60 秒，避免高频打爆 Redis

let memoryConfigCache = {
  data: null,
  cachedAt: 0,
};

function getXHuntUserModel() {
  try {
    const { XHuntUser } = require("../../models/postgres-start");
    return XHuntUser || null;
  } catch (_) {
    return null;
  }
}

/**
 * 获取当前生效的投票权重配置（支持 Redis 热更新，本地 60s 内存降级）
 * Redis 键: hotvote:config:weights
 * 格式示例: { "rules": [{ "maxRank": 1000, "weight": 10 }, ...], "defaultWeight": 1 }
 */
async function getVoteWeightConfig(redisClient = null) {
  const now = Date.now();
  if (memoryConfigCache.data && now - memoryConfigCache.cachedAt < CONFIG_CACHE_TTL_MS) {
    return memoryConfigCache.data;
  }

  if (redisClient?.get) {
    try {
      const raw = await redisClient.get("hotvote:config:weights");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.rules)) {
          const sortedRules = [...parsed.rules].sort(
            (a, b) => Number(a.maxRank || 0) - Number(b.maxRank || 0)
          );
          const config = {
            ...parsed,
            rules: sortedRules,
          };
          memoryConfigCache = {
            data: config,
            cachedAt: now,
          };
          return config;
        }
      }
    } catch (err) {
      console.warn("[HotVoteWeight] 读取 Redis 权重动态配置异常，回退默认规则:", err.message);
    }
  }

  const fallback = {
    rules: DEFAULT_WEIGHT_RULES,
    defaultWeight: DEFAULT_BASE_WEIGHT,
  };
  memoryConfigCache = {
    data: fallback,
    cachedAt: now,
  };
  return fallback;
}

/**
 * 根据排名与配置计算瞬时权重
 * @param {number|string|null} rank
 * @param {object} [config]
 * @returns {number}
 */
function calculateVoteWeight(rank, config = null) {
  const rawRules = config?.rules || DEFAULT_WEIGHT_RULES;
  const defaultWeight =
    typeof config?.defaultWeight === "number" ? config.defaultWeight : DEFAULT_BASE_WEIGHT;

  const numericRank = Number(rank);
  if (!numericRank || isNaN(numericRank) || numericRank <= 0) {
    return defaultWeight;
  }

  const rules = Array.isArray(rawRules)
    ? [...rawRules].sort((a, b) => Number(a.maxRank || 0) - Number(b.maxRank || 0))
    : DEFAULT_WEIGHT_RULES;

  for (const rule of rules) {
    if (numericRank <= Number(rule.maxRank)) {
      return Number(rule.weight) || defaultWeight;
    }
  }

  return defaultWeight;
}

/**
 * 解析选民当前的瞬时 XHunt 排名与投票权重
 * @param {object} params
 * @param {string} params.twitterId
 * @param {string|null} [params.effectiveUserId]
 * @param {object|null} [params.redisClient]
 * @returns {Promise<{ rank: number|null, weight: number }>}
 */
async function resolveVoterRankAndWeight({ twitterId, effectiveUserId = null, redisClient = null }) {
  const config = await getVoteWeightConfig(redisClient);
  let rank = null;

  const XHuntUser = getXHuntUserModel();
  if (XHuntUser) {
    try {
      let user = null;
      if (effectiveUserId) {
        user = await XHuntUser.findByPk(effectiveUserId, {
          attributes: ["id", "kolRank20W"],
        });
      }
      if (!user && twitterId) {
        user = await XHuntUser.findOne({
          where: { twitterId: String(twitterId).trim() },
          attributes: ["id", "kolRank20W"],
        });
      }

      if (user && user.kolRank20W != null) {
        const num = Number(user.kolRank20W);
        if (!isNaN(num) && num > 0) {
          rank = num;
        }
      }
    } catch (err) {
      console.warn("[HotVoteWeight] 查询用户排名失败，使用默认权重兜底:", err.message);
    }
  }

  const weight = calculateVoteWeight(rank, config);
  return { rank, weight };
}

module.exports = {
  DEFAULT_WEIGHT_RULES,
  DEFAULT_BASE_WEIGHT,
  getVoteWeightConfig,
  calculateVoteWeight,
  resolveVoterRankAndWeight,
};
