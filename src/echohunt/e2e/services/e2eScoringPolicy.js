const { DEFAULT_E2E_SCORING_CONFIG, normalizeScoringConfig } = require("./e2eScoringConfig");

const DEFAULT_TIME_DECAY_FLOOR = DEFAULT_E2E_SCORING_CONFIG.timeDecayFloor;

function normalizeDecayFloor(value = DEFAULT_TIME_DECAY_FLOOR) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_TIME_DECAY_FLOOR;
}

function computeTimeDecayWeight(interactionTime, campaignStart, campaignEnd, floor = normalizeDecayFloor()) {
  const interactionMs = new Date(interactionTime || 0).getTime();
  const startMs = new Date(campaignStart || 0).getTime();
  const endMs = new Date(campaignEnd || 0).getTime();
  if (!Number.isFinite(interactionMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 1;
  }
  if (interactionMs <= startMs) return 1;
  if (interactionMs >= endMs) return floor;
  const progress = (interactionMs - startMs) / (endMs - startMs);
  return Number((1 - progress * (1 - floor)).toFixed(6));
}

function scoreSingleInteraction(item, type, campaignStart, campaignEnd, scoringConfig = {}) {
  const config = normalizeScoringConfig(typeof scoringConfig === "number"
    ? { timeDecayFloor: scoringConfig }
    : scoringConfig);
  const text = String(item?.text || "").trim();
  const charLength = Array.from(text).length;
  const base = type === "quote" ? config.quoteBase : config.replyBase;
  const lengthBonus = Math.min(config.lengthBonusCap, Math.floor(charLength / config.lengthCharsPerPoint));
  const likeBonus = Number(item?.likes || 0) * config.likeMultiplier;
  const replyBonus = Number(item?.replies || 0) * config.replyMultiplier;
  const retweetBonus = Number(item?.retweets || 0) * config.retweetReceivedMultiplier;
  const viewBonus = Math.min(config.viewBonusCap, Number(item?.views || 0) / config.viewsPerPoint);
  const engagementBonus = Math.min(config.engagementBonusCap, likeBonus + replyBonus + retweetBonus + viewBonus);
  const scoreBeforeDecay = base + lengthBonus + engagementBonus;
  const timeWeight = computeTimeDecayWeight(item?.create_time, campaignStart, campaignEnd, config.timeDecayFloor);
  const score = Number((scoreBeforeDecay * timeWeight).toFixed(2));
  return {
    id: String(item?.id || ""),
    type,
    text,
    createTime: item?.create_time || null,
    metrics: {
      likes: Number(item?.likes || 0),
      replies: Number(item?.replies || 0),
      retweets: Number(item?.retweets || 0),
      views: Number(item?.views || 0),
    },
    base,
    charLength,
    lengthBonus,
    engagementBonus: Number(engagementBonus.toFixed(2)),
    timeWeight,
    scoreBeforeDecay: Number(scoreBeforeDecay.toFixed(2)),
    score,
    counted: true,
    reason: null,
  };
}

function formatScoreNumber(value, maximumFractionDigits = 6) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0";
  return String(Number(parsed.toFixed(maximumFractionDigits)));
}

function buildScoreExplanation(breakdown = {}) {
  const interactions = Array.isArray(breakdown.interactions) ? breakdown.interactions : [];
  const counted = interactions.filter((item) => item?.counted);
  const policy = breakdown.policy || {};
  const typeIndexes = { reply: 0, quote: 0 };
  const interactionParts = counted.map((item) => {
    const type = item.type === "quote" ? "引用" : "评论";
    const metrics = item.metrics || {};
    typeIndexes[item.type] = (typeIndexes[item.type] || 0) + 1;
    return `${type}${typeIndexes[item.type]}：` +
      `(基础 ${formatScoreNumber(item.base)} + 长度 ${formatScoreNumber(item.lengthBonus)} + ` +
      `互动 ${formatScoreNumber(item.engagementBonus)}) × 实际时间权重 ${formatScoreNumber(item.timeWeight)} ` +
      `= ${formatScoreNumber(item.score, 2)}` +
      `〔长度：${formatScoreNumber(item.charLength, 0)} 字，每 ${formatScoreNumber(policy.lengthCharsPerPoint, 0)} 字 +1，` +
      `上限 ${formatScoreNumber(policy.lengthBonusCap)}；互动：赞 ${formatScoreNumber(metrics.likes, 0)}×${formatScoreNumber(policy.likeMultiplier)}，` +
      `回复 ${formatScoreNumber(metrics.replies, 0)}×${formatScoreNumber(policy.replyMultiplier)}，` +
      `被转发 ${formatScoreNumber(metrics.retweets, 0)}×${formatScoreNumber(policy.retweetReceivedMultiplier)}，` +
      `浏览 min(${formatScoreNumber(metrics.views, 0)}÷${formatScoreNumber(policy.viewsPerPoint, 0)}, ${formatScoreNumber(policy.viewBonusCap)})，` +
      `互动总上限 ${formatScoreNumber(policy.engagementBonusCap)}〕`;
  });
  const excludedCount = interactions.length - counted.length;
  const rankMultiplier = formatScoreNumber(breakdown.rankMultiplier);
  const rawScore = formatScoreNumber(breakdown.rawScore, 2);
  const point = formatScoreNumber(breakdown.point, 2);
  const floor = formatScoreNumber(policy.timeDecayFloor);
  return [
    `最终积分 ${point} = 互动原始分 ${rawScore} × 排名权重 ${rankMultiplier}`,
    ...interactionParts,
    ...(excludedCount > 0 ? [`另有 ${excludedCount} 条互动未计分`] : []),
    `时间衰减最低权重 ${floor}`,
  ].join("；");
}

function ordinaryRetweetScoreDetail(userId) {
  return {
    id: `retweet:${userId}`,
    type: "retweet",
    text: "",
    createTime: null,
    metrics: { likes: 0, replies: 0, retweets: 0, views: 0 },
    base: 0,
    charLength: 0,
    lengthBonus: 0,
    engagementBonus: 0,
    timeWeight: 1,
    scoreBeforeDecay: 0,
    score: 0,
    counted: false,
    reason: "普通转推不计分",
  };
}

module.exports = {
  DEFAULT_TIME_DECAY_FLOOR,
  buildScoreExplanation,
  normalizeDecayFloor,
  computeTimeDecayWeight,
  ordinaryRetweetScoreDetail,
  scoreSingleInteraction,
};
