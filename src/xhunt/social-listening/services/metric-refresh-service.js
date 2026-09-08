const { Op, literal } = require("sequelize");
const { EchohuntSocialListeningPost } = require("../../../models/postgres-start");
const { fetchTweetMetricsByIds, mapTweetMetricRow } = require("./data-source");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const TIER_QUOTAS = [0.5, 0.25, 0.15, 0.1];

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.floor(number), min), max);
}

function getMetricRefreshConfig(config = {}) {
  const source = config.metricRefresh || {};
  return {
    mode: source.mode === "disabled" ? "disabled" : "enabled",
    tickIntervalMinutes: clampInteger(source.tickIntervalMinutes, 20, 5, 240),
    batchSize: clampInteger(source.batchSize, 1000, 100, 2000),
    maxBatchesPerTick: clampInteger(source.maxBatchesPerTick, 1, 1, 5),
    recentHours: clampInteger(source.recentHours, 12, 1, 48),
    recentIntervalMinutes: clampInteger(source.recentIntervalMinutes, 20, 5, 240),
    dayIntervalMinutes: clampInteger(source.dayIntervalMinutes, 60, 10, 1440),
    weekIntervalMinutes: clampInteger(source.weekIntervalMinutes, 300, 30, 4320),
    monthIntervalMinutes: clampInteger(source.monthIntervalMinutes, 1080, 60, 10080),
  };
}

function getMetricRefreshTiers(config, now = new Date()) {
  const value = getMetricRefreshConfig(config);
  const endAt = new Date(now);
  const recentAt = new Date(endAt.getTime() - value.recentHours * 60 * 60 * 1000);
  const dayAt = new Date(endAt.getTime() - 36 * 60 * 60 * 1000);
  const weekAt = new Date(endAt.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAt = new Date(endAt.getTime() - THIRTY_DAYS_MS);
  return [
    { key: "recent", priority: 1, fromAt: recentAt, toAt: endAt, dueBefore: new Date(endAt.getTime() - value.recentIntervalMinutes * 60 * 1000) },
    { key: "day", priority: 2, fromAt: dayAt, toAt: recentAt, dueBefore: new Date(endAt.getTime() - value.dayIntervalMinutes * 60 * 1000) },
    { key: "week", priority: 3, fromAt: weekAt, toAt: dayAt, dueBefore: new Date(endAt.getTime() - value.weekIntervalMinutes * 60 * 1000) },
    { key: "month", priority: 4, fromAt: monthAt, toAt: weekAt, dueBefore: new Date(endAt.getTime() - value.monthIntervalMinutes * 60 * 1000) },
  ];
}

function buildTierWhere(boardId, tier, excludedIds = []) {
  const clauses = [
    { boardId },
    { postCreatedAt: { [Op.gte]: tier.fromAt, [Op.lt]: tier.toAt } },
    { [Op.or]: [{ metricsRefreshedAt: null }, { metricsRefreshedAt: { [Op.lt]: tier.dueBefore } }] },
  ];
  if (excludedIds.length) clauses.push({ id: { [Op.notIn]: excludedIds } });
  return { [Op.and]: clauses };
}

async function selectTierPosts(boardId, tier, limit, excludedIds = []) {
  if (limit <= 0) return [];
  return EchohuntSocialListeningPost.findAll({
    attributes: ["id", "tweetId", "postCreatedAt", "metricsRefreshedAt"],
    where: buildTierWhere(boardId, tier, excludedIds),
    order: [[literal('"metricsRefreshedAt" ASC NULLS FIRST')], ["postCreatedAt", "DESC"]],
    limit,
    raw: true,
  });
}

async function selectDueMetricRefreshPosts(boardId, runtimeConfig, options = {}) {
  const limit = clampInteger(options.limit || getMetricRefreshConfig(runtimeConfig).batchSize, 1000, 1, 2000);
  const tiers = getMetricRefreshTiers(runtimeConfig, options.now);
  const selected = [];
  const tierCounts = {};
  for (const [index, tier] of tiers.entries()) {
    const quota = index === tiers.length - 1
      ? Math.max(0, limit - selected.length)
      : Math.max(1, Math.floor(limit * TIER_QUOTAS[index]));
    const rows = await selectTierPosts(boardId, tier, quota, selected.map((item) => item.id));
    selected.push(...rows.map((row) => ({ ...row, metricRefreshTier: tier.key, metricRefreshPriority: tier.priority })));
    tierCounts[tier.key] = rows.length;
  }
  return { posts: selected.slice(0, limit), tierCounts };
}

async function updateMetricRows(rows, refreshedAt) {
  if (!rows.length) return 0;
  const db = EchohuntSocialListeningPost.sequelize;
  await db.query(
    `
      UPDATE "EchohuntSocialListeningPosts" AS post
      SET
        "viewsCount" = source."viewsCount",
        "likesCount" = source."likesCount",
        "repostsCount" = source."repostsCount",
        "quotesCount" = source."quotesCount",
        "repliesCount" = source."repliesCount",
        "metricsRefreshedAt" = :refreshedAt,
        "rawTweet" = COALESCE(post."rawTweet", '{}'::jsonb)
          || jsonb_build_object('metricObservedAt', source."metricObservedAt"),
        "updatedAt" = :refreshedAt
      FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS source(
        id uuid,
        "viewsCount" bigint,
        "likesCount" bigint,
        "repostsCount" bigint,
        "quotesCount" bigint,
        "repliesCount" bigint,
        "metricObservedAt" timestamptz
      )
      WHERE post.id = source.id
    `,
    { replacements: { rows: JSON.stringify(rows), refreshedAt } }
  );
  return rows.length;
}

async function refreshBoardMetrics(board, runtimeConfig, options = {}) {
  const config = getMetricRefreshConfig(runtimeConfig);
  if (config.mode === "disabled") return { enabled: false, selected: 0, updated: 0, missing: 0, tierCounts: {} };
  const startedAt = Date.now();
  const { posts, tierCounts } = await selectDueMetricRefreshPosts(board.id, runtimeConfig, { limit: options.limit || config.batchSize });
  if (!posts.length) return { enabled: true, selected: 0, updated: 0, missing: 0, tierCounts, durationMs: Date.now() - startedAt };

  const sourceRows = await fetchTweetMetricsByIds(posts.map((post) => post.tweetId), posts.length);
  const metricByTweetId = new Map(sourceRows.map(mapTweetMetricRow).filter((row) => row.tweetId).map((row) => [row.tweetId, row]));
  const refreshedAt = new Date();
  const updateRows = posts.flatMap((post) => {
    const metric = metricByTweetId.get(String(post.tweetId));
    return metric ? [{ id: post.id, ...metric }] : [];
  });
  const missingIds = posts.filter((post) => !metricByTweetId.has(String(post.tweetId))).map((post) => post.id);
  const updated = await updateMetricRows(updateRows, refreshedAt);
  if (missingIds.length) {
    await EchohuntSocialListeningPost.update({ metricsRefreshedAt: refreshedAt }, { where: { id: { [Op.in]: missingIds } } });
  }
  return {
    enabled: true,
    selected: posts.length,
    sourceMatched: updateRows.length,
    updated,
    missing: missingIds.length,
    tierCounts,
    durationMs: Date.now() - startedAt,
  };
}

async function findNextMetricRefreshCandidate(boards, runtimeConfig, now = new Date()) {
  let winner = null;
  for (const board of boards) {
    const { posts } = await selectDueMetricRefreshPosts(board.id, runtimeConfig, { limit: 1, now });
    const candidate = posts[0];
    if (!candidate) continue;
    if (!winner
      || candidate.metricRefreshPriority < winner.candidate.metricRefreshPriority
      || (candidate.metricRefreshPriority === winner.candidate.metricRefreshPriority
        && new Date(candidate.postCreatedAt) > new Date(winner.candidate.postCreatedAt))) {
      winner = { board, candidate };
    }
  }
  return winner;
}

module.exports = {
  getMetricRefreshConfig,
  getMetricRefreshTiers,
  selectDueMetricRefreshPosts,
  refreshBoardMetrics,
  findNextMetricRefreshCandidate,
};
