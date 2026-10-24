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
  normalizeDecayFloor,
  computeTimeDecayWeight,
  ordinaryRetweetScoreDetail,
  scoreSingleInteraction,
};
