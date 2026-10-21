const { E2eList, E2eRecord, E2eLog, E2eTweet } = require("../../../models/postgres-start");

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

function computeRankWeight(fanRank) {
  const rank = Number(fanRank);
  if (!Number.isFinite(rank) || rank <= 0) return 1.0;
  if (rank <= 1000) return 2.5;
  if (rank <= 5000) return 2.0;
  if (rank <= 20000) return 1.6;
  if (rank <= 50000) return 1.35;
  if (rank <= 100000) return 1.15;
  return 1.0;
}

function scoreSingleInteraction(item, type) {
  const text = String(item?.text || "").trim();
  const charLen = Array.from(text).length;
  const baseWeight = type === "quote" ? 15 : 10;
  const lengthBonus = Math.min(25, Math.floor(charLen / 12));
  const engagementBonus = Math.min(
    30,
    Number(item?.likes || 0) * 1.5 +
      Number(item?.replies || 0) * 2 +
      Number(item?.retweets || 0) * 2 +
      Math.min(10, Number(item?.views || 0) / 200)
  );
  return baseWeight + lengthBonus + engagementBonus;
}

async function reviewExpiredCampaign(campaign) {
  const endTimeMs = campaign.end_time ? new Date(campaign.end_time).getTime() : 0;
  if (campaign.status === "active" && endTimeMs > 0 && Date.now() >= endTimeMs) {
    await settleCampaignRewardsPreview(campaign);
    await campaign.update({ status: "review" });
  }
}

/**
 * 对单个活动执行算分与状态流转
 */
async function calculateCampaignScores(campaign) {
  if (!campaign || !campaign.address || !campaign.tweet_id) return null;

  const tweetId = String(campaign.tweet_id);
  const address = String(campaign.address);
  const signups = await E2eRecord.findAll({
    where: { address },
  });
  if (!signups.length) {
    await reviewExpiredCampaign(campaign);
    return { address, tweetId, updatedUsers: 0 };
  }

  const tweetRecord = await E2eTweet.findByPk(tweetId);
  const engageData =
    tweetRecord?.engage_data && typeof tweetRecord.engage_data === "object"
      ? tweetRecord.engage_data
      : {};
  const replies = Object.values(engageData.replies || {});
  const quotes = Object.values(engageData.quotes || {});
  const retweeters = new Set(
    Array.isArray(engageData.engage_ids?.retweeted_user_ids)
      ? engageData.engage_ids.retweeted_user_ids.map(String)
      : []
  );

  const allowRetro = campaign.retro !== false;
  const langRequirement = campaign.lang || "all";
  const now = new Date();
  let updatedUsers = 0;

  for (const signup of signups) {
    const userId = String(signup.user_id);
    const signupTime = signup.create_time ? new Date(signup.create_time).getTime() : 0;

    const userReplies = replies.filter((item) => {
      if (String(item.user_id) !== userId) return false;
      if (!matchesLanguage(item.text, langRequirement)) return false;
      if (!allowRetro && signupTime > 0) {
        const itemTime = new Date(item.create_time || 0).getTime();
        if (itemTime > 0 && itemTime < signupTime) return false;
      }
      return true;
    });

    const userQuotes = quotes.filter((item) => {
      if (String(item.user_id) !== userId) return false;
      if (!matchesLanguage(item.text, langRequirement)) return false;
      if (!allowRetro && signupTime > 0) {
        const itemTime = new Date(item.create_time || 0).getTime();
        if (itemTime > 0 && itemTime < signupTime) return false;
      }
      return true;
    });

    const hasRetweet = retweeters.has(userId);
    if (!userReplies.length && !userQuotes.length && !hasRetweet) {
      continue;
    }

    let rawScore = 0;
    for (const reply of userReplies.slice(0, 3)) {
      rawScore += scoreSingleInteraction(reply, "reply");
    }
    for (const quote of userQuotes.slice(0, 3)) {
      rawScore += scoreSingleInteraction(quote, "quote");
    }
    if (hasRetweet) {
      rawScore += 5;
    }

    const rankMultiplier = computeRankWeight(signup.fan_rank);
    const computedPoint = Number((rawScore * rankMultiplier).toFixed(2));
    const prevPoint = Number(signup.point || 0);
    const finalPoint = Math.max(prevPoint, computedPoint);

    const explanationParts = [];
    if (userQuotes.length) explanationParts.push(`Quotes: ${userQuotes.length}`);
    if (userReplies.length) explanationParts.push(`Replies: ${userReplies.length}`);
    if (hasRetweet) explanationParts.push("Retweeted: yes");
    explanationParts.push(`Rank weight: x${rankMultiplier}`);
    const explanation = explanationParts.join(", ");

    if (finalPoint !== prevPoint || !signup.explaination) {
      await signup.update({
        point: finalPoint,
        explaination: explanation,
        update_time: now,
      });
      await E2eLog.create({
        tweet_id: tweetId,
        user_id: userId,
        calc_time: now,
        username: signup.username || null,
        point: finalPoint,
        explanation,
      }).catch(() => {});
      updatedUsers += 1;
    }
  }

  // 若活动已过结束时间，流转至 review 并计算预估奖励分配
  await reviewExpiredCampaign(campaign);

  return { address, tweetId, updatedUsers };
}

/**
 * 根据活动分配模式（equal 或 mindshare）与 winners 数量计算每个获奖者的 rewards
 */
async function settleCampaignRewardsPreview(campaign) {
  const signups = await E2eRecord.findAll({
    where: { address: String(campaign.address) },
  });
  const sorted = [...signups].sort((a, b) => Number(b.point || 0) - Number(a.point || 0));
  const positiveScorers = sorted.filter((item) => Number(item.point || 0) > 0);
  const maxWinners = Math.max(1, Number(campaign.winners || 20));
  const winnersList = positiveScorers.slice(0, maxWinners);
  if (!winnersList.length) return;

  const totalRewards = Number(campaign.rewards || 0);
  const mode = String(campaign.type || "mindshare").toLowerCase();

  if (mode === "equal") {
    const perWinner = Number((totalRewards / winnersList.length).toFixed(4));
    for (const winner of winnersList) {
      await winner.update({ rewards: perWinner });
    }
    return;
  }

  const totalPoints = winnersList.reduce((acc, item) => acc + Number(item.point || 0), 0);
  if (totalPoints <= 0) return;
  for (const winner of winnersList) {
    const share = Number(winner.point || 0) / totalPoints;
    const rewardAmount = Number((totalRewards * share).toFixed(4));
    await winner.update({ rewards: rewardAmount });
  }
}

/**
 * 扫描所有 active 任务执行算分与到期流转
 */
async function runE2eScoringCycle() {
  const activeCampaigns = await E2eList.findAll({
    where: { status: "active" },
  });
  const results = [];
  for (const campaign of activeCampaigns) {
    const res = await calculateCampaignScores(campaign);
    if (res) results.push(res);
  }
  return {
    campaignCount: activeCampaigns.length,
    results,
  };
}

module.exports = {
  calculateCampaignScores,
  settleCampaignRewardsPreview,
  runE2eScoringCycle,
};
