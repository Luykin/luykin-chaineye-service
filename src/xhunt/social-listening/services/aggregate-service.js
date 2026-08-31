const { Op } = require("sequelize");
const {
  EchohuntSocialListeningPost,
  EchohuntSocialListeningSnapshot,
  EchohuntSocialListeningAlert,
  EchohuntSocialListeningAccountSignal,
} = require("../../../models/postgres-start");
const { RANGE_CONFIG, RANGE_KEYS, SENTIMENTS, ALERT_TYPES } = require("../constants");

function normalizeRangeKey(value) {
  const range = String(value || "7D").toUpperCase();
  return RANGE_KEYS.includes(range) ? range : "7D";
}

function getWindowForRange(rangeKey, now = new Date()) {
  const config = RANGE_CONFIG[normalizeRangeKey(rangeKey)];
  return {
    rangeKey: normalizeRangeKey(rangeKey),
    bucketSize: config.bucketSize,
    windowStartAt: new Date(now.getTime() - config.ms),
    windowEndAt: now,
  };
}

function toNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function startOfBucket(date, bucketSize) {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  if (bucketSize === "day") d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function getEngagement(post) {
  return toNumber(post.likesCount) + toNumber(post.repostsCount) + toNumber(post.quotesCount) + toNumber(post.repliesCount);
}

function incrementMap(map, key, patch) {
  if (!key) return;
  const current = map.get(key) || {};
  map.set(key, { ...current, ...patch(current) });
}

function aggregateListValues(map, values, post, options = {}) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  list.forEach((value) => {
    const key = typeof value === "string" ? value : value?.name || value?.tag || value?.keyword;
    if (!key) return;
    incrementMap(map, String(key), (current) => ({
      count: toNumber(current.count) + 1,
      views: toNumber(current.views) + toNumber(post.viewsCount),
      engagement: toNumber(current.engagement) + getEngagement(post),
      representativeTweetId: current.representativeTweetId || post.tweetId,
      source: options.source || current.source || null,
    }));
  });
}

function buildSeries(posts, bucketSize) {
  const bucketMap = new Map();
  posts.forEach((post) => {
    const bucket = startOfBucket(post.postCreatedAt, bucketSize);
    const current = bucketMap.get(bucket) || {
      bucket,
      volume: 0,
      views: 0,
      engagement: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      unknown: 0,
    };
    current.volume += 1;
    current.views += toNumber(post.viewsCount);
    current.engagement += getEngagement(post);
    const sentiment = post.sentiment || SENTIMENTS.UNKNOWN;
    if (current[sentiment] !== undefined) current[sentiment] += 1;
    else current.unknown += 1;
    bucketMap.set(bucket, current);
  });
  return Array.from(bucketMap.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function buildSentimentComposition(posts) {
  const composition = { positive: 0, neutral: 0, negative: 0, unknown: 0, analyzed: 0, total: posts.length };
  posts.forEach((post) => {
    const sentiment = post.sentiment || SENTIMENTS.UNKNOWN;
    if (composition[sentiment] !== undefined) composition[sentiment] += 1;
    else composition.unknown += 1;
  });
  composition.analyzed = composition.positive + composition.neutral + composition.negative;
  composition.positiveRatio = composition.analyzed ? composition.positive / composition.analyzed : null;
  composition.neutralRatio = composition.analyzed ? composition.neutral / composition.analyzed : null;
  composition.negativeRatio = composition.analyzed ? composition.negative / composition.analyzed : null;
  return composition;
}

async function buildSnapshotPayload(board, rangeKey, options = {}) {
  const now = options.now || new Date();
  const window = getWindowForRange(rangeKey, now);
  const posts = await EchohuntSocialListeningPost.findAll({
    where: {
      boardId: board.id,
      postCreatedAt: { [Op.gte]: window.windowStartAt, [Op.lt]: window.windowEndAt },
    },
    order: [["postCreatedAt", "ASC"]],
    raw: true,
  });

  const authorIds = new Set(posts.map((post) => post.authorTwitterId).filter(Boolean));
  const metrics = posts.reduce((acc, post) => {
    acc.discussionCount += 1;
    acc.viewsCount += toNumber(post.viewsCount);
    acc.engagementCount += getEngagement(post);
    return acc;
  }, { discussionCount: 0, accountCount: authorIds.size, viewsCount: 0, engagementCount: 0 });

  const sentimentComposition = buildSentimentComposition(posts);
  metrics.sentimentAnalyzedCount = sentimentComposition.analyzed;
  metrics.sentimentUnknownCount = sentimentComposition.unknown;
  metrics.negativeRatio = sentimentComposition.negativeRatio;
  metrics.partial = board.coverageStartAt ? new Date(board.coverageStartAt) > window.windowStartAt : true;

  const topicMap = new Map();
  const wordMap = new Map();
  posts.forEach((post) => {
    aggregateListValues(topicMap, post.topics, post, { source: "topics" });
    aggregateListValues(wordMap, post.keywords, post, { source: "keywords" });
  });

  const sortAggregate = (map, limit) => Array.from(map.entries())
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => (b.count - a.count) || (b.views - a.views))
    .slice(0, limit);

  const influentialCount = posts.filter((post) =>
    (toNumber(post.authorGlobalRank) > 0 && toNumber(post.authorGlobalRank) <= 10000) ||
    (toNumber(post.authorCnRank) > 0 && toNumber(post.authorCnRank) <= 1500)
  ).length;

  const activeAlertCount = await EchohuntSocialListeningAlert.count({
    where: { boardId: board.id, status: "active", triggeredAt: { [Op.gte]: window.windowStartAt } },
  }).catch(() => 0);

  return {
    boardId: board.id,
    rangeKey: window.rangeKey,
    bucketSize: window.bucketSize,
    windowStartAt: window.windowStartAt,
    windowEndAt: window.windowEndAt,
    processedThrough: board.processedThrough || now,
    metrics,
    volumeSeries: buildSeries(posts, window.bucketSize).map((item) => ({
      bucket: item.bucket,
      volume: item.volume,
      views: item.views,
      engagement: item.engagement,
    })),
    sentimentSeries: buildSeries(posts, window.bucketSize).map((item) => ({
      bucket: item.bucket,
      positive: item.positive,
      neutral: item.neutral,
      negative: item.negative,
      unknown: item.unknown,
    })),
    sentimentComposition,
    topics: sortAggregate(topicMap, 20),
    wordCloud: sortAggregate(wordMap, 50),
    accountSummary: {
      activeAccounts: authorIds.size,
      influentialMentionCount: influentialCount,
    },
    alertSummary: {
      activeCount: activeAlertCount,
    },
    generatedAt: now,
  };
}

async function generateSnapshotsForBoard(board, options = {}) {
  const snapshots = [];
  for (const rangeKey of RANGE_KEYS) {
    const payload = await buildSnapshotPayload(board, rangeKey, options);
    const [snapshot] = await EchohuntSocialListeningSnapshot.upsert(payload, {
      conflictFields: ["boardId", "rangeKey", "processedThrough"],
      returning: true,
    });
    snapshots.push(snapshot);
  }
  return snapshots;
}

async function generateInfluentialSignals(board, options = {}) {
  const since = options.since || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const posts = await EchohuntSocialListeningPost.findAll({
    where: {
      boardId: board.id,
      postCreatedAt: { [Op.gte]: since },
      [Op.or]: [
        { authorGlobalRank: { [Op.between]: [1, 10000] } },
        { authorCnRank: { [Op.between]: [1, 1500] } },
      ],
    },
    order: [["postCreatedAt", "DESC"]],
    limit: 200,
    raw: true,
  });

  for (const post of posts) {
    await EchohuntSocialListeningAccountSignal.upsert({
      boardId: board.id,
      twitterId: post.authorTwitterId,
      handle: post.authorHandle,
      name: post.authorName,
      avatar: post.authorAvatar,
      followersCount: post.authorFollowersCount,
      globalRank: post.authorGlobalRank,
      cnRank: post.authorCnRank,
      signalType: "influential_mention",
      occurredAt: post.postCreatedAt,
      mentionCount: 1,
      viewsCount: post.viewsCount,
      engagementCount: getEngagement(post),
      sentiment: post.sentiment,
      topics: post.topics,
      postIds: [post.tweetId],
      summaryZh: post.summaryZh || post.text,
      rankSnapshot: { globalRank: post.authorGlobalRank, cnRank: post.authorCnRank },
    }, { conflictFields: ["boardId", "signalType", "twitterId", "occurredAt"] }).catch(() => null);

    await EchohuntSocialListeningAlert.upsert({
      boardId: board.id,
      alertType: ALERT_TYPES.INFLUENTIAL_MENTION,
      severity: toNumber(post.authorGlobalRank) > 0 && toNumber(post.authorGlobalRank) <= 1000 ? "high" : "medium",
      dedupeKey: `${ALERT_TYPES.INFLUENTIAL_MENTION}:${post.tweetId}`,
      triggeredAt: post.postCreatedAt,
      lastSeenAt: new Date(),
      titleZh: "高影响力账号提及",
      messageZh: `${post.authorName || post.authorHandle || post.authorTwitterId} 提及了 ${board.projectName}`,
      currentValue: { globalRank: post.authorGlobalRank, cnRank: post.authorCnRank, views: post.viewsCount },
      baselineValue: null,
      sampleSize: 1,
      reason: "作者排名达到 Social Listening 预警阈值",
      evidenceTweetIds: [post.tweetId],
      status: "active",
    }, { conflictFields: ["boardId", "dedupeKey"] }).catch(() => null);
  }

  return posts.length;
}

module.exports = {
  normalizeRangeKey,
  getWindowForRange,
  generateSnapshotsForBoard,
  generateInfluentialSignals,
};
