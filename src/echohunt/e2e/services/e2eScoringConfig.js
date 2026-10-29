const DEFAULT_E2E_SCORING_CONFIG = Object.freeze({
  timeDecayFloor: 0.7,
  replyBase: 5,
  quoteBase: 15,
  lengthCharsPerPoint: 12,
  lengthBonusCap: 25,
  likeMultiplier: 1.5,
  replyMultiplier: 2,
  retweetReceivedMultiplier: 2,
  viewSqrtDivisor: 10,
  viewBonusCap: 10,
  engagementBonusCap: 30,
  maxReplies: 1,
  maxQuotes: 1,
  rankThreshold1: 1000,
  rankThreshold2: 5000,
  rankThreshold3: 20000,
  rankThreshold4: 50000,
  rankThreshold5: 100000,
  rankThreshold6: 200000,
  rankWeightTop1000: 2.5,
  rankWeightTop5000: 2,
  rankWeightTop20000: 1.6,
  rankWeightTop50000: 1.35,
  rankWeightTop100000: 1.15,
  rankWeightTop200000: 1,
  rankWeightDefault: 0.5,
});

const RULES = {
  timeDecayFloor: { min: 0, max: 1 },
  replyBase: { min: 0, max: 100 },
  quoteBase: { min: 0, max: 100 },
  lengthCharsPerPoint: { min: 1, max: 1000, integer: true },
  lengthBonusCap: { min: 0, max: 200 },
  likeMultiplier: { min: 0, max: 20 },
  replyMultiplier: { min: 0, max: 20 },
  retweetReceivedMultiplier: { min: 0, max: 20 },
  viewSqrtDivisor: { min: 0.01, max: 100000 },
  viewBonusCap: { min: 0, max: 200 },
  engagementBonusCap: { min: 0, max: 500 },
  maxReplies: { min: 0, max: 20, integer: true },
  maxQuotes: { min: 0, max: 20, integer: true },
  rankThreshold1: { min: 1, max: 1000000000, integer: true },
  rankThreshold2: { min: 1, max: 1000000000, integer: true },
  rankThreshold3: { min: 1, max: 1000000000, integer: true },
  rankThreshold4: { min: 1, max: 1000000000, integer: true },
  rankThreshold5: { min: 1, max: 1000000000, integer: true },
  rankThreshold6: { min: 1, max: 1000000000, integer: true },
  rankWeightTop1000: { min: 0, max: 10 },
  rankWeightTop5000: { min: 0, max: 10 },
  rankWeightTop20000: { min: 0, max: 10 },
  rankWeightTop50000: { min: 0, max: 10 },
  rankWeightTop100000: { min: 0, max: 10 },
  rankWeightTop200000: { min: 0, max: 10 },
  rankWeightDefault: { min: 0, max: 10 },
};

function normalizeScoringConfig(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalized = { ...DEFAULT_E2E_SCORING_CONFIG };
  Object.entries(RULES).forEach(([key, rule]) => {
    const parsed = Number(source[key]);
    if (!Number.isFinite(parsed) || parsed < rule.min || parsed > rule.max || (rule.integer && !Number.isInteger(parsed))) return;
    normalized[key] = parsed;
  });
  return normalized;
}

function validateScoringConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("评分配置必须是对象");
    error.code = "E2E_INVALID_SCORING_CONFIG";
    error.status = 400;
    throw error;
  }
  const unknownKeys = Object.keys(value).filter((key) => !Object.prototype.hasOwnProperty.call(RULES, key));
  if (unknownKeys.length) {
    const error = new Error(`未知评分参数：${unknownKeys.join(", ")}`);
    error.code = "E2E_INVALID_SCORING_CONFIG";
    error.status = 400;
    throw error;
  }
  for (const [key, rule] of Object.entries(RULES)) {
    const parsed = Number(value[key]);
    if (!Number.isFinite(parsed) || parsed < rule.min || parsed > rule.max || (rule.integer && !Number.isInteger(parsed))) {
      const suffix = rule.integer ? "整数" : "数值";
      const error = new Error(`${key} 必须是 ${rule.min}-${rule.max} 的${suffix}`);
      error.code = "E2E_INVALID_SCORING_CONFIG";
      error.status = 400;
      throw error;
    }
  }
  const normalized = normalizeScoringConfig(value);
  const thresholds = [1, 2, 3, 4, 5, 6].map((index) => normalized[`rankThreshold${index}`]);
  if (thresholds.some((threshold, index) => index > 0 && threshold <= thresholds[index - 1])) {
    const error = new Error("XHunt 排名档位上限必须按第 1 档到第 6 档严格递增");
    error.code = "E2E_INVALID_SCORING_CONFIG";
    error.status = 400;
    throw error;
  }
  return normalized;
}

function computeRankWeight(fanRank, scoringConfig = {}) {
  const config = normalizeScoringConfig(scoringConfig);
  const rank = Number(fanRank);
  if (!Number.isFinite(rank) || rank <= 0) return config.rankWeightDefault;
  if (rank <= config.rankThreshold1) return config.rankWeightTop1000;
  if (rank <= config.rankThreshold2) return config.rankWeightTop5000;
  if (rank <= config.rankThreshold3) return config.rankWeightTop20000;
  if (rank <= config.rankThreshold4) return config.rankWeightTop50000;
  if (rank <= config.rankThreshold5) return config.rankWeightTop100000;
  if (rank <= config.rankThreshold6) return config.rankWeightTop200000;
  return config.rankWeightDefault;
}

module.exports = {
  DEFAULT_E2E_SCORING_CONFIG,
  computeRankWeight,
  normalizeScoringConfig,
  validateScoringConfig,
};
