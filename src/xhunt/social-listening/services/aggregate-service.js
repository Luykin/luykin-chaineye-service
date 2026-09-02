const { Op } = require("sequelize");
const {
  EchohuntSocialListeningPost,
  EchohuntSocialListeningSnapshot,
  EchohuntSocialListeningAlert,
  EchohuntSocialListeningAccountSignal,
} = require("../../../models/postgres-start");
const { RANGE_CONFIG, RANGE_KEYS, SENTIMENTS, ALERT_TYPES, ACCOUNT_SIGNAL_TYPES } = require("../constants");
const { fetchFollowSignalsForBoard } = require("./data-source");
const { getSocialListeningRuntimeConfig } = require("./runtime-config");

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

function isInfluentialRank(globalRank, cnRank) {
  return (toNumber(globalRank) > 0 && toNumber(globalRank) <= 10000) ||
    (toNumber(cnRank) > 0 && toNumber(cnRank) <= 1500);
}

const EFFECTIVE_SENTIMENTS = Object.freeze([
  SENTIMENTS.POSITIVE,
  SENTIMENTS.NEUTRAL,
  SENTIMENTS.NEGATIVE,
]);

function isEffectiveSentiment(value) {
  return EFFECTIVE_SENTIMENTS.includes(String(value || "").trim().toLowerCase());
}

function filterEffectiveSentimentPosts(posts) {
  return Array.isArray(posts) ? posts.filter((post) => isEffectiveSentiment(post?.sentiment)) : [];
}

function shouldExcludeUnknownSentiment(options = {}) {
  return options.excludeUnknownSentiment !== false;
}

function getMetricPosts(posts, options = {}) {
  return shouldExcludeUnknownSentiment(options) ? filterEffectiveSentimentPosts(posts) : posts;
}

function hasXhuntKolFlag(account = {}) {
  const kol = account.raw?.kol && typeof account.raw.kol === "object" ? account.raw.kol : {};
  return Object.values(kol).some((snapshot) => (
    snapshot?.global?.is_kol === true ||
    snapshot?.cn?.is_kol === true
  ));
}

function isXhuntKolAccount(account = {}) {
  return hasXhuntKolFlag(account) ||
    toNumber(account.globalRank) > 0 ||
    toNumber(account.cnRank) > 0;
}

function normalizeId(value) {
  return String(value || "").trim();
}

function normalizeHandle(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function isBoardOfficialAccount(board, account = {}) {
  const officialTwitterId = normalizeId(board?.officialTwitterId);
  const accountTwitterId = normalizeId(account.twitterId || account.authorTwitterId);
  if (officialTwitterId && accountTwitterId && officialTwitterId === accountTwitterId) return true;

  const officialHandle = normalizeHandle(board?.officialHandle);
  const accountHandle = normalizeHandle(account.handle || account.authorHandle);
  return Boolean(officialHandle && accountHandle && officialHandle === accountHandle);
}

function startOfHour(date) {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

function incrementMap(map, key, patch) {
  if (!key) return;
  const current = map.get(key) || {};
  map.set(key, { ...current, ...patch(current) });
}

const TOPIC_ZH_MAP = Object.freeze({
  crypto: "加密/Web3",
  ai: "AI",
  科技: "科技",
  金融: "金融",
  内容创作: "内容创作",
  抽奖: "抽奖",
  DeFi: "DeFi",
  Layer1: "Layer1",
  Layer2: "Layer2",
  Meme: "Meme",
  NFT: "NFT",
  GameFi: "GameFi",
  DePIN: "DePIN",
  CeFi: "CeFi",
  Wallet: "钱包",
  Stablecoin: "稳定币",
  RWA: "RWA",
  Mining: "挖矿",
  Airdrop: "空投",
  Exchange: "交易所",
  Infra: "基础设施",
  Security: "安全",
  DAO: "DAO",
  Bridge: "跨链桥",
  Derivatives: "衍生品",
  Lending: "借贷",
  Staking: "质押",
  Oracle: "预言机",
  Payment: "支付",
  Launchpad: "Launchpad",
  LLM: "大语言模型",
  Agent: "智能体",
  Model: "模型",
  Data: "数据",
  App: "应用",
  Robotics: "机器人",
  Inference: "推理",
  Training: "训练",
  Chip: "芯片",
});

function getTopicZh(value) {
  const text = String(value || "").trim();
  return TOPIC_ZH_MAP[text] || text;
}

function pushLimited(list, value, limit) {
  if (!value || list.includes(value) || list.length >= limit) return;
  list.push(value);
}

function normalizeAggregateItem(value) {
  if (typeof value === "string") return { name: value, word: value, wordZh: getTopicZh(value) };
  if (!value || typeof value !== "object") return null;
  const name = value.name || value.tag || value.keyword || value.word || value.topic;
  if (!name) return null;
  return {
    name: String(name),
    word: String(value.word || name),
    wordZh: value.wordZh || value.word_zh || value.topicZh || value.topic_zh || getTopicZh(name),
  };
}

function normalizeWordKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/^[@#$]+/, "")
    .toLowerCase()
    .replace(/[\s_\-.,!?，。！？:：;；()[\]{}"'“”‘’`]+/g, "");
}

function getBoardDiscussionKeywordExclusions(board = {}) {
  const metadata = board.metadata && typeof board.metadata === "object" ? board.metadata : {};
  const wordCloud = metadata.wordCloud && typeof metadata.wordCloud === "object" ? metadata.wordCloud : {};
  const values = [
    board.officialHandle,
    board.projectName,
    ...(Array.isArray(metadata.keywords) ? metadata.keywords : []),
    ...(Array.isArray(metadata.aliases) ? metadata.aliases : []),
    ...(Array.isArray(metadata.wordCloudExcludeKeywords) ? metadata.wordCloudExcludeKeywords : []),
    ...(Array.isArray(metadata.wordCloudExcludedKeywords) ? metadata.wordCloudExcludedKeywords : []),
    ...(Array.isArray(wordCloud.excludeKeywords) ? wordCloud.excludeKeywords : []),
    ...(metadata.token ? [metadata.token] : []),
  ];
  return new Set(values.map(normalizeWordKey).filter(Boolean));
}

function filterDiscussionKeywords(values, board) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  const exclusions = getBoardDiscussionKeywordExclusions(board);
  return list.filter((value) => {
    const item = normalizeAggregateItem(value);
    if (!item?.name) return false;
    const key = normalizeWordKey(item.name || item.word);
    if (!key || key.length < 2) return false;
    return !exclusions.has(key);
  });
}

function getDominantSentiment(counts = {}) {
  const order = [SENTIMENTS.POSITIVE, SENTIMENTS.NEGATIVE, SENTIMENTS.NEUTRAL, SENTIMENTS.UNKNOWN];
  return order
    .map((key) => ({ key, value: toNumber(counts[key]) }))
    .sort((a, b) => (b.value - a.value) || order.indexOf(a.key) - order.indexOf(b.key))[0]?.key || SENTIMENTS.UNKNOWN;
}

function aggregateListValues(map, values, post, options = {}) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  list.forEach((value) => {
    const item = normalizeAggregateItem(value);
    if (!item?.name) return;
    const sentiment = post.sentiment || SENTIMENTS.UNKNOWN;
    incrementMap(map, item.name, (current) => {
      const sentimentCounts = {
        ...(current.sentimentCounts || {}),
        [sentiment]: toNumber(current.sentimentCounts?.[sentiment]) + 1,
      };
      const postIds = Array.isArray(current.postIds) ? current.postIds.slice() : [];
      const tweetIds = Array.isArray(current.tweetIds) ? current.tweetIds.slice() : [];
      pushLimited(postIds, post.id, 100);
      pushLimited(tweetIds, post.tweetId, 100);
      return {
        name: item.name,
        word: item.word,
        wordZh: item.wordZh,
        topic: item.name,
        topicZh: item.wordZh,
        count: toNumber(current.count) + 1,
        views: toNumber(current.views) + toNumber(post.viewsCount),
        engagement: toNumber(current.engagement) + getEngagement(post),
        sentimentCounts,
        sentiment: getDominantSentiment(sentimentCounts),
        representativePostId: current.representativePostId || post.id,
        representativeTweetId: current.representativeTweetId || post.tweetId,
        postIds,
        tweetIds,
        source: options.source || current.source || null,
      };
    });
  });
}

function buildBucketKeys(window) {
  const keys = [];
  const current = new Date(startOfBucket(window.windowStartAt, window.bucketSize));
  const end = new Date(window.windowEndAt);
  while (current < end) {
    keys.push(current.toISOString());
    if (window.bucketSize === "day") current.setUTCDate(current.getUTCDate() + 1);
    else current.setUTCHours(current.getUTCHours() + 1);
  }
  return keys;
}

function buildTopicTrends(posts, topTopics, window) {
  const buckets = buildBucketKeys(window);
  const bucketIndex = new Map(buckets.map((bucket, index) => [bucket, index]));
  return topTopics.slice(0, 3).map((topic) => {
    const values = buckets.map(() => 0);
    posts.forEach((post) => {
      const postTopics = Array.isArray(post.topics) ? post.topics.map((item) => normalizeAggregateItem(item)?.name).filter(Boolean) : [];
      if (!postTopics.includes(topic.name)) return;
      const index = bucketIndex.get(startOfBucket(post.postCreatedAt, window.bucketSize));
      if (index !== undefined) values[index] += 1;
    });
    return {
      topic: topic.name,
      topicZh: topic.topicZh || getTopicZh(topic.name),
      name: topic.name,
      count: topic.count,
      mentions: topic.count,
      buckets,
      values,
    };
  });
}

function pickTopAggregateValues(posts, field, limit = 5) {
  const map = new Map();
  posts.forEach((post) => aggregateListValues(map, post[field], post, { source: field }));
  return Array.from(map.values())
    .sort((a, b) => (b.count - a.count) || (b.views - a.views))
    .slice(0, limit);
}

function pickTopDiscussionKeywords(posts, board, limit = 5) {
  const map = new Map();
  posts.forEach((post) => {
    aggregateListValues(map, filterDiscussionKeywords(post.keywords, board), post, { source: "ai_hot_tags" });
  });
  return Array.from(map.values())
    .sort((a, b) => (b.count - a.count) || (b.views - a.views))
    .slice(0, limit);
}

function pickPostSummary(post, lang) {
  if (lang === "zh") return post.summaryZh || post.sentimentSummaryZh || post.text || "";
  return post.summaryEn || post.text || "";
}

function buildViewpointText(posts, sentiment, board, lang) {
  const projectName = board.projectName || board.officialHandle || "该项目";
  const selected = posts
    .filter((post) => post.sentiment === sentiment)
    .sort((a, b) => (toNumber(b.viewsCount) - toNumber(a.viewsCount)) || (getEngagement(b) - getEngagement(a)))
    .slice(0, 3);
  if (!selected.length) {
    if (lang === "zh") return `当前范围内暂无可归纳的${sentiment === SENTIMENTS.POSITIVE ? "正面" : "负面"}观点。`;
    return `No ${sentiment === SENTIMENTS.POSITIVE ? "positive" : "negative"} viewpoint can be summarized for the selected range.`;
  }
  const topicNames = pickTopAggregateValues(selected, "topics", 3).map((item) => lang === "zh" ? item.topicZh : item.name).filter(Boolean);
  const keywordNames = pickTopDiscussionKeywords(selected, board, 5).map((item) => item.word).filter(Boolean);
  const summaries = selected.map((post) => pickPostSummary(post, lang)).filter(Boolean).slice(0, 2);
  if (lang === "zh") {
    const sentimentLabel = sentiment === SENTIMENTS.POSITIVE ? "正面" : "负面";
    return `${projectName} 的${sentimentLabel}讨论主要集中在 ${[...topicNames, ...keywordNames].slice(0, 5).join("、") || "相关帖子"}。代表内容：${summaries.join("；")}`;
  }
  return `${sentiment === SENTIMENTS.POSITIVE ? "Positive" : "Negative"} discussion around ${projectName} focuses on ${[...topicNames, ...keywordNames].slice(0, 5).join(", ") || "related posts"}. Representative posts: ${summaries.join("; ")}`;
}

function buildViewpoints(posts, board) {
  const positivePosts = posts.filter((post) => post.sentiment === SENTIMENTS.POSITIVE);
  const negativePosts = posts.filter((post) => post.sentiment === SENTIMENTS.NEGATIVE);
  return {
    positive: buildViewpointText(posts, SENTIMENTS.POSITIVE, board, "en"),
    positiveZh: buildViewpointText(posts, SENTIMENTS.POSITIVE, board, "zh"),
    negative: buildViewpointText(posts, SENTIMENTS.NEGATIVE, board, "en"),
    negativeZh: buildViewpointText(posts, SENTIMENTS.NEGATIVE, board, "zh"),
    sampleSize: {
      positive: positivePosts.length,
      negative: negativePosts.length,
    },
    generatedBy: "deterministic_aggregation",
  };
}

function sortAggregate(map, limit) {
  return Array.from(map.values())
    .sort((a, b) => (b.count - a.count) || (b.views - a.views))
    .slice(0, limit);
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

function summarizeMetricPosts(posts) {
  const authorIds = new Set(posts.map((post) => post.authorTwitterId).filter(Boolean));
  const sentimentComposition = buildSentimentComposition(posts);
  return posts.reduce((acc, post) => {
    acc.discussionCount += 1;
    acc.viewsCount += toNumber(post.viewsCount);
    acc.engagementCount += getEngagement(post);
    return acc;
  }, {
    discussionCount: 0,
    accountCount: authorIds.size,
    viewsCount: 0,
    engagementCount: 0,
    sentimentAnalyzedCount: sentimentComposition.analyzed,
    sentimentUnknownCount: sentimentComposition.unknown,
    positiveRatio: sentimentComposition.positiveRatio,
    negativeRatio: sentimentComposition.negativeRatio,
  });
}

function buildMetricChange(currentValue, previousValue) {
  const current = toNumber(currentValue);
  const previous = toNumber(previousValue);
  return {
    current,
    previous,
    absoluteChange: current - previous,
    changeRatio: previous > 0 ? (current - previous) / previous : null,
  };
}

function buildRatioMetricChange(currentValue, previousValue) {
  const current = currentValue === null || currentValue === undefined ? null : Number(currentValue);
  const previous = previousValue === null || previousValue === undefined ? null : Number(previousValue);
  return {
    current,
    previous,
    absoluteChange: Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null,
    percentagePointChange: Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null,
    changeRatio: Number.isFinite(current) && Number.isFinite(previous) && previous > 0 ? (current - previous) / previous : null,
  };
}

function buildMetricComparisons(currentMetrics, previousMetrics, previousWindow) {
  return {
    previousWindowStartAt: previousWindow.windowStartAt,
    previousWindowEndAt: previousWindow.windowEndAt,
    previousMetrics: {
      discussionCount: previousMetrics.discussionCount,
      accountCount: previousMetrics.accountCount,
      viewsCount: previousMetrics.viewsCount,
      engagementCount: previousMetrics.engagementCount,
      positiveRatio: previousMetrics.positiveRatio,
      sentimentAnalyzedCount: previousMetrics.sentimentAnalyzedCount,
      sentimentUnknownCount: previousMetrics.sentimentUnknownCount,
    },
    changes: {
      discussionCount: buildMetricChange(currentMetrics.discussionCount, previousMetrics.discussionCount),
      accountCount: buildMetricChange(currentMetrics.accountCount, previousMetrics.accountCount),
      viewsCount: buildMetricChange(currentMetrics.viewsCount, previousMetrics.viewsCount),
      engagementCount: buildMetricChange(currentMetrics.engagementCount, previousMetrics.engagementCount),
      positiveRatio: buildRatioMetricChange(currentMetrics.positiveRatio, previousMetrics.positiveRatio),
    },
  };
}

function getPreviousWindow(window) {
  const windowStartAt = new Date(window.windowStartAt);
  const windowEndAt = new Date(window.windowEndAt);
  const durationMs = windowEndAt.getTime() - windowStartAt.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  return {
    windowStartAt: new Date(windowStartAt.getTime() - durationMs),
    windowEndAt: windowStartAt,
  };
}

async function fetchMetricPosts(boardId, windowStartAt, windowEndAt) {
  return EchohuntSocialListeningPost.findAll({
    where: {
      boardId,
      postCreatedAt: { [Op.gte]: windowStartAt, [Op.lt]: windowEndAt },
    },
    attributes: [
      "authorTwitterId",
      "postCreatedAt",
      "viewsCount",
      "likesCount",
      "repostsCount",
      "quotesCount",
      "repliesCount",
      "sentiment",
    ],
    raw: true,
  });
}

async function enrichSnapshotMetricComparisons(snapshot, boardId, options = {}) {
  if (!snapshot) return snapshot;
  const windowStartAt = new Date(snapshot.windowStartAt);
  const windowEndAt = new Date(snapshot.windowEndAt);
  if (Number.isNaN(windowStartAt.getTime()) || Number.isNaN(windowEndAt.getTime())) return snapshot;
  const previousWindow = getPreviousWindow({ windowStartAt, windowEndAt });
  if (!previousWindow) return snapshot;
  const previousPosts = await fetchMetricPosts(boardId || snapshot.boardId, previousWindow.windowStartAt, previousWindow.windowEndAt);
  const previousMetrics = summarizeMetricPosts(getMetricPosts(previousPosts, options));
  const metrics = snapshot.metrics && typeof snapshot.metrics === "object" ? snapshot.metrics : {};
  const sentimentComposition = snapshot.sentimentComposition && typeof snapshot.sentimentComposition === "object" ? snapshot.sentimentComposition : {};
  const currentMetrics = {
    ...metrics,
    positiveRatio: metrics.positiveRatio ?? sentimentComposition.positiveRatio,
  };
  return {
    ...snapshot,
    metrics: {
      ...metrics,
      ...buildMetricComparisons(currentMetrics, previousMetrics, previousWindow),
    },
  };
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

  const metricPosts = getMetricPosts(posts, options);
  const authorIds = new Set(metricPosts.map((post) => post.authorTwitterId).filter(Boolean));
  const sentimentComposition = buildSentimentComposition(metricPosts);
  const metrics = summarizeMetricPosts(metricPosts);
  metrics.sentimentAnalyzedCount = sentimentComposition.analyzed;
  metrics.sentimentUnknownCount = sentimentComposition.unknown;
  metrics.positiveRatio = sentimentComposition.positiveRatio;
  metrics.negativeRatio = sentimentComposition.negativeRatio;
  metrics.partial = board.coverageStartAt ? new Date(board.coverageStartAt) > window.windowStartAt : true;

  const previousWindow = getPreviousWindow(window);
  if (previousWindow) {
    const previousPosts = await fetchMetricPosts(board.id, previousWindow.windowStartAt, previousWindow.windowEndAt);
    Object.assign(metrics, buildMetricComparisons(metrics, summarizeMetricPosts(getMetricPosts(previousPosts, options)), previousWindow));
  }

  const topicMap = new Map();
  const wordMap = new Map();
  metricPosts.forEach((post) => {
    aggregateListValues(topicMap, post.topics, post, { source: "topics" });
    aggregateListValues(wordMap, filterDiscussionKeywords(post.keywords, board), post, { source: "ai_hot_tags" });
  });

  const topTopics = sortAggregate(topicMap, 20);
  const wordCloud = sortAggregate(wordMap, 50);

  const influentialCount = metricPosts.filter((post) => isInfluentialRank(post.authorGlobalRank, post.authorCnRank)).length;

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
    volumeSeries: buildSeries(metricPosts, window.bucketSize).map((item) => ({
      bucket: item.bucket,
      volume: item.volume,
      views: item.views,
      engagement: item.engagement,
    })),
    sentimentSeries: buildSeries(metricPosts, window.bucketSize).map((item) => ({
      bucket: item.bucket,
      positive: item.positive,
      neutral: item.neutral,
      negative: item.negative,
      unknown: item.unknown,
    })),
    sentimentComposition,
    topics: topTopics,
    topicTrends: buildTopicTrends(metricPosts, topTopics, window),
    wordCloud,
    viewpoints: buildViewpoints(metricPosts, board),
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
  const until = options.until || new Date();
  const selfExclusions = [];
  const officialTwitterId = normalizeId(board?.officialTwitterId);
  const officialHandle = normalizeHandle(board?.officialHandle);
  if (officialTwitterId) selfExclusions.push({ authorTwitterId: { [Op.ne]: officialTwitterId } });
  if (officialHandle) {
    selfExclusions.push({
      [Op.or]: [
        { authorHandle: null },
        { authorHandle: { [Op.notILike]: officialHandle } },
      ],
    });
  }

  const posts = await EchohuntSocialListeningPost.findAll({
    where: {
      boardId: board.id,
      postCreatedAt: { [Op.gte]: since, [Op.lt]: until },
      sentiment: { [Op.in]: EFFECTIVE_SENTIMENTS },
      ...(selfExclusions.length ? { [Op.and]: selfExclusions } : {}),
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
    if (isBoardOfficialAccount(board, post)) continue;
    await EchohuntSocialListeningAccountSignal.upsert({
      boardId: board.id,
      twitterId: post.authorTwitterId,
      handle: post.authorHandle,
      name: post.authorName,
      avatar: post.authorAvatar,
      followersCount: post.authorFollowersCount,
      globalRank: post.authorGlobalRank,
      cnRank: post.authorCnRank,
      signalType: ACCOUNT_SIGNAL_TYPES.INFLUENTIAL_MENTION,
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
      currentValue: {
        authorTwitterId: post.authorTwitterId,
        authorHandle: post.authorHandle,
        globalRank: post.authorGlobalRank,
        cnRank: post.authorCnRank,
        views: post.viewsCount,
      },
      baselineValue: null,
      sampleSize: 1,
      reason: "作者排名达到 Social Listening 预警阈值",
      evidenceTweetIds: [post.tweetId],
      status: "active",
    }, { conflictFields: ["boardId", "dedupeKey"] }).catch(() => null);
  }

  return posts.length;
}

function describeFollowSignal(signalType, accountName, boardName) {
  const name = accountName || "关键账号";
  if (signalType === ACCOUNT_SIGNAL_TYPES.ACCOUNT_FOLLOWED_PROJECT) return `${name} 新关注了 ${boardName}`;
  if (signalType === ACCOUNT_SIGNAL_TYPES.PROJECT_FOLLOWED_ACCOUNT) return `${boardName} 新关注了 ${name}`;
  if (signalType === ACCOUNT_SIGNAL_TYPES.ACCOUNT_UNFOLLOWED_PROJECT) return `${name} 取关了 ${boardName}`;
  if (signalType === ACCOUNT_SIGNAL_TYPES.PROJECT_UNFOLLOWED_ACCOUNT) return `${boardName} 取关了 ${name}`;
  return `${name} 关注关系发生变化`;
}

async function generateFollowSignals(board, options = {}) {
  if (!board.officialTwitterId) return 0;
  const startAt = options.since || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const endAt = options.until || new Date();
  const rows = await fetchFollowSignalsForBoard(board, startAt, endAt, options).catch((error) => {
    console.warn("[SocialListening] 读取关注/取关动态失败:", error.message);
    return [];
  });

  let saved = 0;
  for (const row of rows) {
    const account = row.account;
    if (!account?.twitterId) continue;
    if (isBoardOfficialAccount(board, account)) continue;
    if (!isXhuntKolAccount(account)) continue;
    const displayName = account.name || account.handle || account.twitterId;
    await EchohuntSocialListeningAccountSignal.upsert({
      boardId: board.id,
      twitterId: account.twitterId,
      handle: account.handle,
      name: account.name,
      avatar: account.avatar,
      followersCount: account.followersCount,
      globalRank: account.globalRank,
      cnRank: account.cnRank,
      signalType: row.signalType,
      occurredAt: row.occurredAt,
      mentionCount: 0,
      viewsCount: null,
      engagementCount: null,
      sentiment: null,
      topics: null,
      postIds: [],
      summaryZh: describeFollowSignal(row.signalType, displayName, board.projectName),
      rankSnapshot: {
        globalRank: account.globalRank,
        cnRank: account.cnRank,
        sourceTable: row.sourceTable,
        direction: row.direction,
        projectKey: row.projectKey,
        relation: row.relation,
      },
    }, { conflictFields: ["boardId", "signalType", "twitterId", "occurredAt"] }).catch(() => null);
    saved += 1;
  }
  return saved;
}

function getNegativeRatio(posts) {
  const analyzed = posts.filter((post) => [SENTIMENTS.POSITIVE, SENTIMENTS.NEUTRAL, SENTIMENTS.NEGATIVE].includes(post.sentiment));
  if (!analyzed.length) return { ratio: null, analyzed: 0, negative: 0 };
  const negative = analyzed.filter((post) => post.sentiment === SENTIMENTS.NEGATIVE).length;
  return { ratio: negative / analyzed.length, analyzed: analyzed.length, negative };
}

async function upsertAggregateAlert(board, payload) {
  await EchohuntSocialListeningAlert.upsert({
    boardId: board.id,
    status: "active",
    ...payload,
  }, { conflictFields: ["boardId", "dedupeKey"] });
  return 1;
}

function getRangeLabel(rangeKey) {
  if (rangeKey === "24H") return "最近 24 小时";
  if (rangeKey === "30D") return "最近 30 天";
  return "最近 7 天";
}

async function buildDerivedNegativeContentAlertForRange(board, window, options = {}) {
  if (!board?.id || !window?.windowStartAt || !window?.windowEndAt) return null;
  const where = {
    boardId: board.id,
    sentiment: SENTIMENTS.NEGATIVE,
    postCreatedAt: { [Op.gte]: window.windowStartAt, [Op.lt]: window.windowEndAt },
  };
  const evidenceLimit = Math.min(Math.max(Number(options.evidenceLimit || 20), 1), 50);
  const [negativeCount, negativeAuthorCount, negativeViews, evidencePosts] = await Promise.all([
    EchohuntSocialListeningPost.count({ where }),
    EchohuntSocialListeningPost.count({ where, distinct: true, col: "authorTwitterId" }).catch(() => 0),
    EchohuntSocialListeningPost.sum("viewsCount", { where }).catch(() => 0),
    EchohuntSocialListeningPost.findAll({
      where,
      attributes: ["tweetId", "postCreatedAt", "viewsCount"],
      order: [["postCreatedAt", "DESC"]],
      limit: evidenceLimit,
      raw: true,
    }),
  ]);
  if (!negativeCount) return null;

  const runtimeConfig = await getSocialListeningRuntimeConfig().catch(() => ({}));
  const alertConfig = runtimeConfig.alert || {};
  const minNegativePosts = Math.max(Number(alertConfig.concentratedNegativeMinPosts || 3), 1);
  const minNegativeAuthors = Math.max(Number(alertConfig.concentratedNegativeMinAuthors || 2), 1);
  const minNegativeViews = Math.max(Number(alertConfig.concentratedNegativeMinViews || 0), 0);
  const views = toNumber(negativeViews);
  const isConcentratedNegative = negativeCount >= minNegativePosts && negativeAuthorCount >= minNegativeAuthors;
  const latestPostAt = evidencePosts[0]?.postCreatedAt || window.windowEndAt;
  const detectedAt = window.windowEndAt;
  const rangeKey = normalizeRangeKey(window.rangeKey);
  const rangeLabel = getRangeLabel(rangeKey);

  return {
    id: `derived-${ALERT_TYPES.NEGATIVE_CONTENT}-${board.id}-${rangeKey}`,
    boardId: board.id,
    alertType: ALERT_TYPES.NEGATIVE_CONTENT,
    severity: isConcentratedNegative || views >= Math.max(minNegativeViews * 2, 50000) ? "high" : "medium",
    dedupeKey: `${ALERT_TYPES.NEGATIVE_CONTENT}:${rangeKey}:${new Date(window.windowStartAt).toISOString()}`,
    triggeredAt: detectedAt,
    lastSeenAt: detectedAt,
    titleZh: isConcentratedNegative ? "集中负面内容风险" : "负面内容风险",
    messageZh: `${rangeLabel}识别到 ${negativeCount} 条负面讨论，来自 ${negativeAuthorCount || 1} 个账号。`,
    currentValue: {
      count: negativeCount,
      negativeCount,
      authorCount: negativeAuthorCount,
      views,
      rangeKey,
      windowStartAt: window.windowStartAt,
      windowEndAt: window.windowEndAt,
      latestPostAt,
      derivedFromSentiment: true,
    },
    baselineValue: null,
    sampleSize: negativeCount,
    reason: "根据所选时间范围内已识别为负面的讨论派生，确保内容风险与概览统计口径一致。",
    evidenceTweetIds: evidencePosts.map((post) => post.tweetId).filter(Boolean),
    status: "active",
    createdAt: detectedAt,
    updatedAt: detectedAt,
  };
}

async function appendDerivedNegativeContentAlert(board, window, alerts, options = {}) {
  const rows = Array.isArray(alerts) ? alerts : [];
  const requestedType = options.type ? String(options.type) : "";
  if (requestedType && requestedType !== ALERT_TYPES.NEGATIVE_CONTENT) return { rows, appended: false };
  if (rows.some((alert) => alert.alertType === ALERT_TYPES.NEGATIVE_CONTENT)) return { rows, appended: false };
  const derivedAlert = await buildDerivedNegativeContentAlertForRange(board, window, options);
  if (!derivedAlert) return { rows, appended: false };
  return {
    rows: [...rows, derivedAlert].sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()),
    appended: true,
  };
}

async function generateAggregateAlerts(board, options = {}) {
  const now = options.now || new Date();
  const currentEndAt = options.until || now;
  const currentStartAt = options.since ? new Date(options.since) : new Date(currentEndAt.getTime() - 60 * 60 * 1000);
  const bucketStart = startOfHour(currentStartAt);
  const runtimeConfig = await getSocialListeningRuntimeConfig();
  const alertConfig = runtimeConfig.alert || {};
  const baselineDays = Math.min(Math.max(Number(alertConfig.baselineDays || 7), 1), 30);
  const baselineStartAt = new Date(currentStartAt.getTime() - baselineDays * 24 * 60 * 60 * 1000);

  const [currentPosts, baselinePosts] = await Promise.all([
    EchohuntSocialListeningPost.findAll({
      where: { boardId: board.id, postCreatedAt: { [Op.gte]: currentStartAt, [Op.lt]: currentEndAt } },
      raw: true,
    }),
    EchohuntSocialListeningPost.findAll({
      where: { boardId: board.id, postCreatedAt: { [Op.gte]: baselineStartAt, [Op.lt]: currentStartAt } },
      attributes: ["tweetId", "authorTwitterId", "postCreatedAt", "sentiment", "viewsCount"],
      raw: true,
    }),
  ]);

  const effectiveCurrentPosts = filterEffectiveSentimentPosts(currentPosts);
  const effectiveBaselinePosts = filterEffectiveSentimentPosts(baselinePosts);
  const baselineHour = bucketStart.getUTCHours();
  const sameHourBaseline = effectiveBaselinePosts.filter((post) => new Date(post.postCreatedAt).getUTCHours() === baselineHour);
  const baselineAvg = sameHourBaseline.length / baselineDays;
  const minVolume = Math.max(Number(alertConfig.volumeSpikeMinPosts || 5), 1);
  const volumeMultiplier = Math.max(Number(alertConfig.volumeSpikeMultiplier || 2), 1);
  let alerts = 0;

  if (effectiveCurrentPosts.length >= minVolume && baselineAvg > 0 && effectiveCurrentPosts.length >= baselineAvg * volumeMultiplier) {
    alerts += await upsertAggregateAlert(board, {
      alertType: ALERT_TYPES.VOLUME_SPIKE,
      severity: effectiveCurrentPosts.length >= baselineAvg * volumeMultiplier * 1.5 ? "high" : "medium",
      dedupeKey: `${ALERT_TYPES.VOLUME_SPIKE}:${bucketStart.toISOString()}`,
      triggeredAt: currentStartAt,
      lastSeenAt: now,
      titleZh: "讨论量异常升高",
      messageZh: `最近 1 小时有效讨论量 ${effectiveCurrentPosts.length} 条，达到同小时历史基线 ${baselineAvg.toFixed(1)} 条的 ${volumeMultiplier} 倍以上。`,
      currentValue: { count: effectiveCurrentPosts.length, windowStartAt: currentStartAt, windowEndAt: currentEndAt },
      baselineValue: { average: baselineAvg, days: baselineDays, sameHourSampleSize: sameHourBaseline.length },
      sampleSize: effectiveCurrentPosts.length,
      reason: "最近 1 小时有效讨论量显著高于过去 7 天同小时段基线",
      evidenceTweetIds: effectiveCurrentPosts.slice(0, 20).map((post) => post.tweetId),
    });
  }

  const currentNegative = getNegativeRatio(effectiveCurrentPosts);
  const baselineNegative = getNegativeRatio(sameHourBaseline);
  const minAnalyzed = Math.max(Number(alertConfig.negativeSpikeMinAnalyzed || 20), 1);
  const ratioDelta = Number(alertConfig.negativeShareSpikeDelta ?? 0.2);
  if (
    currentNegative.analyzed >= minAnalyzed &&
    baselineNegative.analyzed >= minAnalyzed &&
    currentNegative.ratio !== null &&
    baselineNegative.ratio !== null &&
    currentNegative.ratio - baselineNegative.ratio >= ratioDelta
  ) {
    alerts += await upsertAggregateAlert(board, {
      alertType: ALERT_TYPES.NEGATIVE_SHARE_SPIKE,
      severity: currentNegative.ratio >= 0.5 ? "high" : "medium",
      dedupeKey: `${ALERT_TYPES.NEGATIVE_SHARE_SPIKE}:${bucketStart.toISOString()}`,
      triggeredAt: currentStartAt,
      lastSeenAt: now,
      titleZh: "负面占比异常升高",
      messageZh: `最近 1 小时负面占比 ${(currentNegative.ratio * 100).toFixed(1)}%，较历史基线上升 ${((currentNegative.ratio - baselineNegative.ratio) * 100).toFixed(1)} 个百分点。`,
      currentValue: currentNegative,
      baselineValue: { ...baselineNegative, days: baselineDays },
      sampleSize: currentNegative.analyzed,
      reason: "负面情绪占比相对历史同小时段基线上升超过阈值",
      evidenceTweetIds: effectiveCurrentPosts.filter((post) => post.sentiment === SENTIMENTS.NEGATIVE).slice(0, 20).map((post) => post.tweetId),
    });
  }

  const negativePosts = effectiveCurrentPosts.filter((post) => post.sentiment === SENTIMENTS.NEGATIVE);
  const negativeAuthors = new Set(negativePosts.map((post) => post.authorTwitterId).filter(Boolean));
  const negativeViews = negativePosts.reduce((sum, post) => sum + toNumber(post.viewsCount), 0);
  const minNegativePosts = Math.max(Number(alertConfig.concentratedNegativeMinPosts || 3), 1);
  const minNegativeAuthors = Math.max(Number(alertConfig.concentratedNegativeMinAuthors || 2), 1);
  const minNegativeViews = Math.max(Number(alertConfig.concentratedNegativeMinViews || 0), 0);
  const negativeContentMinPosts = Math.max(Number(alertConfig.negativeContentMinPosts ?? 1), 1);
  const negativeContentMinAuthors = Math.max(Number(alertConfig.negativeContentMinAuthors ?? 1), 1);
  const isConcentratedNegative = (
    negativePosts.length >= minNegativePosts &&
    negativeAuthors.size >= minNegativeAuthors
  );
  if (
    negativePosts.length >= negativeContentMinPosts &&
    negativeAuthors.size >= negativeContentMinAuthors &&
    negativeViews >= minNegativeViews
  ) {
    alerts += await upsertAggregateAlert(board, {
      alertType: ALERT_TYPES.NEGATIVE_CONTENT,
      severity: isConcentratedNegative || negativeViews >= Math.max(minNegativeViews * 2, 50000) ? "high" : "medium",
      dedupeKey: `${ALERT_TYPES.NEGATIVE_CONTENT}:${bucketStart.toISOString()}`,
      triggeredAt: currentStartAt,
      lastSeenAt: now,
      titleZh: isConcentratedNegative ? "集中负面内容风险" : "负面内容风险",
      messageZh: `最近 1 小时识别到 ${negativePosts.length} 条负面讨论，来自 ${negativeAuthors.size} 个账号。`,
      currentValue: { count: negativePosts.length, negativeCount: negativePosts.length, authorCount: negativeAuthors.size, views: negativeViews },
      baselineValue: null,
      sampleSize: negativePosts.length,
      reason: isConcentratedNegative ? "同一时间窗内负面帖数量和负面作者数达到集中风险阈值" : "时间窗内存在已确认负面讨论",
      evidenceTweetIds: negativePosts.slice(0, 20).map((post) => post.tweetId),
    });
  }

  return alerts;
}

module.exports = {
  normalizeRangeKey,
  getWindowForRange,
  generateSnapshotsForBoard,
  generateInfluentialSignals,
  generateFollowSignals,
  generateAggregateAlerts,
  enrichSnapshotMetricComparisons,
  EFFECTIVE_SENTIMENTS,
  isEffectiveSentiment,
  filterEffectiveSentimentPosts,
  buildDerivedNegativeContentAlertForRange,
  appendDerivedNegativeContentAlert,
};
