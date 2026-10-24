const DEFAULT_E2E_SCORING_CONFIG = Object.freeze({
  timeDecayFloor: 0.7,
  replyBase: 10,
  quoteBase: 15,
  lengthCharsPerPoint: 12,
  lengthBonusCap: 25,
  likeMultiplier: 1.5,
  replyMultiplier: 2,
  retweetReceivedMultiplier: 2,
  viewsPerPoint: 200,
  viewBonusCap: 10,
  engagementBonusCap: 30,
  maxReplies: 3,
  maxQuotes: 3,
  rankThreshold1: 1000,
  rankThreshold2: 5000,
  rankThreshold3: 20000,
  rankThreshold4: 50000,
  rankThreshold5: 100000,
  rankWeightTop1000: 2.5,
  rankWeightTop5000: 2,
  rankWeightTop20000: 1.6,
  rankWeightTop50000: 1.35,
  rankWeightTop100000: 1.15,
  rankWeightDefault: 1,
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
  viewsPerPoint: { min: 1, max: 100000, integer: true },
  viewBonusCap: { min: 0, max: 200 },
  engagementBonusCap: { min: 0, max: 500 },
  maxReplies: { min: 0, max: 20, integer: true },
  maxQuotes: { min: 0, max: 20, integer: true },
  rankThreshold1: { min: 1, max: 1000000000, integer: true },
  rankThreshold2: { min: 1, max: 1000000000, integer: true },
  rankThreshold3: { min: 1, max: 1000000000, integer: true },
  rankThreshold4: { min: 1, max: 1000000000, integer: true },
  rankThreshold5: { min: 1, max: 1000000000, integer: true },
  rankWeightTop1000: { min: 0, max: 10 },
  rankWeightTop5000: { min: 0, max: 10 },
  rankWeightTop20000: { min: 0, max: 10 },
  rankWeightTop50000: { min: 0, max: 10 },
  rankWeightTop100000: { min: 0, max: 10 },
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
  const thresholds = [1, 2, 3, 4, 5].map((index) => normalized[`rankThreshold${index}`]);
  if (thresholds.some((threshold, index) => index > 0 && threshold <= thresholds[index - 1])) {
    const error = new Error("XHunt 排名档位上限必须按第 1 档到第 5 档严格递增");
    error.code = "E2E_INVALID_SCORING_CONFIG";
    error.status = 400;
    throw error;
  }
  return normalized;
}

module.exports = {
  DEFAULT_E2E_SCORING_CONFIG,
  normalizeScoringConfig,
  validateScoringConfig,
};
