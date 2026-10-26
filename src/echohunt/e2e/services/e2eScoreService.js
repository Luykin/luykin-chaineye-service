const { E2eList, E2eRecord, E2eLog } = require("../../../models/postgres-start");
const { normalizeDecayFloor, scoreSingleInteraction } = require("./e2eScoringPolicy");
const { normalizeScoringConfig } = require("./e2eScoringConfig");
const {
  listCampaignInteractionSubmissions,
  refreshCampaignInteractionSubmissions,
  toScoringInteraction,
} = require("./e2eInteractionSubmissionService");

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ""));
}

function matchesLanguage(text, lang) {
  const normalizedLang = String(lang || "all").toLowerCase();
  if (!normalizedLang || normalizedLang === "all") return true;
  const isCn = hasChinese(text);
  if (normalizedLang === "cn" || normalizedLang === "zh") return isCn;
  if (normalizedLang === "en") return !isCn && /[a-zA-Z]/.test(String(text || ""));
  return true;
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
  return config.rankWeightDefault;
}

function interactionOrder(a, b) {
  const aTime = new Date(a?.create_time || 0).getTime() || 0;
  const bTime = new Date(b?.create_time || 0).getTime() || 0;
  if (aTime !== bTime) return aTime - bTime;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function selectUserInteractions(items, userId, campaign, signup) {
  const allowRetro = campaign.retro !== false;
  const langRequirement = campaign.lang || "all";
  const signupTime = signup.create_time ? new Date(signup.create_time).getTime() : 0;
  const campaignEndTime = campaign.end_time ? new Date(campaign.end_time).getTime() : 0;
  return items.filter((item) => {
    if (String(item.user_id) !== userId) return false;
    if (!matchesLanguage(item.text, langRequirement)) return false;
    const itemTime = new Date(item.create_time || 0).getTime();
    if (campaignEndTime > 0 && itemTime > campaignEndTime) return false;
    if (!allowRetro && signupTime > 0) {
      if (itemTime > 0 && itemTime < signupTime) return false;
    }
    return true;
  }).sort(interactionOrder);
}

function buildUserScoreBreakdown({ signup, campaign, replies, quotes }) {
  const userId = String(signup.user_id);
  const scoringConfig = normalizeScoringConfig(campaign.score_config);
  const decayFloor = normalizeDecayFloor(scoringConfig.timeDecayFloor);
  const userReplies = selectUserInteractions(replies, userId, campaign, signup);
  const userQuotes = selectUserInteractions(quotes, userId, campaign, signup);
  const scoreGroup = (items, type) => items.map((item, index) => {
    const detail = scoreSingleInteraction(item, type, campaign.start_time, campaign.end_time, scoringConfig);
    const maximum = type === "quote" ? scoringConfig.maxQuotes : scoringConfig.maxReplies;
    if (index >= maximum) {
      detail.counted = false;
      detail.reason = `每位用户最多计入 ${maximum} 条${type === "quote" ? "引用" : "评论"}`;
      detail.score = 0;
    }
    return detail;
  });
  const replyDetails = scoreGroup(userReplies, "reply");
  const quoteDetails = scoreGroup(userQuotes, "quote");
  const rawScore = [...replyDetails, ...quoteDetails]
    .filter((item) => item.counted)
    .reduce((sum, item) => sum + item.score, 0);
  const rankMultiplier = computeRankWeight(signup.fan_rank, scoringConfig);
  const point = Number((rawScore * rankMultiplier).toFixed(2));
  return {
    version: 4,
    policy: {
      ordinaryRetweetPoints: 0,
      ...scoringConfig,
      timeDecay: "linear",
      timeDecayFloor: decayFloor,
    },
    rawScore: Number(rawScore.toFixed(2)),
    rankMultiplier,
    point,
    interactions: [...replyDetails, ...quoteDetails],
    captured: {
      replies: userReplies.length,
      quotes: userQuotes.length,
      ordinaryRetweet: false,
    },
  };
}

async function reviewExpiredCampaign(campaign) {
  const endTimeMs = campaign.end_time ? new Date(campaign.end_time).getTime() : 0;
  if (campaign.status !== "active" || endTimeMs <= 0 || Date.now() < endTimeMs) return;
  const { generateSettlementDraft } = require("./e2eSettlementService");
  await generateSettlementDraft(campaign);
  await campaign.update({ status: "review" });
}

async function calculateCampaignScores(campaign, { skipStatusTransition = false } = {}) {
  if (!campaign || !campaign.address || !campaign.tweet_id) return null;
  const address = String(campaign.address);
  const refresh = await refreshCampaignInteractionSubmissions(campaign);
  const [signups, submissionRecords] = await Promise.all([
    E2eRecord.findAll({ where: { address } }),
    listCampaignInteractionSubmissions(address),
  ]);
  const verifiedInteractions = submissionRecords
    .filter((item) => item.status === "verified")
    .map((item) => ({ type: item.interaction_type, detail: toScoringInteraction(item) }));
  const replies = verifiedInteractions.filter((item) => item.type === "reply").map((item) => item.detail);
  const quotes = verifiedInteractions.filter((item) => item.type === "quote").map((item) => item.detail);
  const tweetId = String(campaign.tweet_id);
  const now = new Date();
  let updatedUsers = 0;

  for (const signup of signups) {
    const breakdown = buildUserScoreBreakdown({
      signup,
      campaign,
      replies,
      quotes,
    });
    const explanation = [
      `Quotes: ${breakdown.captured.quotes}`,
      `Replies: ${breakdown.captured.replies}`,
      "Retweet points: 0",
      `Time decay floor: ${breakdown.policy.timeDecayFloor}`,
      `Rank weight: x${breakdown.rankMultiplier}`,
    ].join(", ");
    const changed = Number(signup.point || 0) !== breakdown.point ||
      signup.explaination !== explanation ||
      JSON.stringify(signup.score_breakdown || null) !== JSON.stringify(breakdown);
    if (!changed) continue;
    await signup.update({
      point: breakdown.point,
      rewards: null,
      explaination: explanation,
      score_breakdown: breakdown,
      update_time: now,
    });
    await E2eLog.create({
      tweet_id: tweetId,
      user_id: String(signup.user_id),
      address,
      calc_time: new Date(),
      username: signup.username || null,
      point: breakdown.point,
      explanation,
      score_breakdown: breakdown,
    }).catch(() => {});
    updatedUsers += 1;
  }
  if (!skipStatusTransition) await reviewExpiredCampaign(campaign);
  return { address, tweetId, updatedUsers, refresh };
}

async function runE2eScoringCycle() {
  const activeCampaigns = await E2eList.findAll({ where: { status: "active" } });
  const results = [];
  for (const campaign of activeCampaigns) {
    const result = await calculateCampaignScores(campaign);
    if (result) results.push(result);
  }
  return { campaignCount: activeCampaigns.length, results };
}

module.exports = {
  buildUserScoreBreakdown,
  calculateCampaignScores,
  computeRankWeight,
  matchesLanguage,
  runE2eScoringCycle,
};
