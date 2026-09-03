const XLSX = require("xlsx");
const { Op, literal } = require("sequelize");
const {
  EchohuntSocialListeningPost,
  EchohuntSocialListeningAccessAuditLog,
} = require("../../../models/postgres-start");
const { normalizeRangeKey, getWindowForRange, EFFECTIVE_SENTIMENTS } = require("./aggregate-service");
const { serializePost } = require("./board-service");
const { publicError } = require("./errors");
const { getSocialListeningRuntimeConfig } = require("./runtime-config");

function rankOrderLiteral(paths, column) {
  const clauses = paths.map((path) => `
      WHEN ("EchohuntSocialListeningPost"."rawAuthor"#>>'${path}') ~ '^[0-9]+$'
        AND ("EchohuntSocialListeningPost"."rawAuthor"#>>'${path}')::int > 0
      THEN ("EchohuntSocialListeningPost"."rawAuthor"#>>'${path}')::int`).join("");
  return literal(`
    CASE${clauses}
      WHEN "EchohuntSocialListeningPost"."${column}" > 0 THEN "EchohuntSocialListeningPost"."${column}"
      ELSE 2147483647
    END
  `);
}

function buildRankAscOrder() {
  return [
    [rankOrderLiteral(["{feature,rank,kolRank}", "{feature,rank,globalRank}", "{feature,rank,kolGlobalRank}"], "authorGlobalRank"), "ASC"],
    [rankOrderLiteral(["{feature,rank,kolCnRank}", "{feature,rank,cnRank}", "{feature,rank,kolChineseRank}"], "authorCnRank"), "ASC"],
    ["postCreatedAt", "DESC"],
  ];
}

function buildPostWhere(boardId, query = {}, options = {}) {
  const rangeKey = normalizeRangeKey(query.range);
  const window = getWindowForRange(rangeKey);
  const sortKey = String(query.sort || "").trim().toLowerCase();
  const aiFilter = String(query.ai || "").trim().toLowerCase();
  const latestAiMode = sortKey === "ai_recent" && ["analyzed", "generated", "succeeded"].includes(aiFilter);
  const where = { boardId };
  if (!latestAiMode) {
    where.postCreatedAt = { [Op.gte]: window.windowStartAt, [Op.lt]: window.windowEndAt };
  }
  const sentiment = String(query.sentiment || query.filter || "").trim().toLowerCase();
  if (options.excludeUnknownSentiment) {
    where.sentiment = sentiment === "unknown"
      ? "__excluded_unknown__"
      : EFFECTIVE_SENTIMENTS.includes(sentiment)
        ? sentiment
        : { [Op.in]: EFFECTIVE_SENTIMENTS };
  } else if ([...EFFECTIVE_SENTIMENTS, "unknown"].includes(sentiment)) {
    where.sentiment = sentiment;
  }
  if (["analyzed", "generated", "succeeded"].includes(aiFilter)) where.aiAnalyzedAt = { [Op.ne]: null };
  const source = String(query.source || "").trim().toLowerCase();
  if (["mention", "quote", "reply", "comment"].includes(source)) where.source = source;
  const q = String(query.q || "").trim();
  if (q) {
    where[Op.or] = [
      { text: { [Op.iLike]: `%${q}%` } },
      { authorHandle: { [Op.iLike]: `%${q.replace(/^@+/, "")}%` } },
      { authorName: { [Op.iLike]: `%${q}%` } },
    ];
  }
  const keyword = String(query.keyword || query.word || "").trim();
  if (keyword) {
    where[Op.and] = [
      ...(where[Op.and] || []),
      {
        [Op.or]: [
          { keywords: { [Op.contains]: [keyword] } },
          { text: { [Op.iLike]: `%${keyword}%` } },
        ],
      },
    ];
  }
  const tweetIds = Array.isArray(query.tweetIds)
    ? query.tweetIds
    : String(query.tweetIds || "").split(",");
  const normalizedTweetIds = tweetIds.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 200);
  if (normalizedTweetIds.length) where.tweetId = { [Op.in]: normalizedTweetIds };
  return { where, rangeKey };
}

function buildPostOrder(sort) {
  const key = String(sort || "time_desc").toLowerCase();
  if (key === "views_desc") return [["viewsCount", "DESC"], ["postCreatedAt", "DESC"]];
  if (key === "engagement_desc") return [["likesCount", "DESC"], ["postCreatedAt", "DESC"]];
  if (key === "rank_asc") return buildRankAscOrder();
  if (key === "ai_recent") return [["aiAnalyzedAt", "DESC"], ["postCreatedAt", "DESC"]];
  return [["postCreatedAt", "DESC"]];
}

async function exportPostsXlsx(board, query = {}, actor = {}, redisClient = null, options = {}) {
  const runtimeConfig = await getSocialListeningRuntimeConfig();
  const exportConfig = runtimeConfig.export || {};
  const exportMaxRows = exportConfig.maxRows || 10000;
  const cooldownSubject = actor.authCenterUserId || actor.adminId || "unknown";
  const cooldownSeconds = actor.type === "admin" ? exportConfig.adminCooldownSeconds : exportConfig.userCooldownSeconds;
  const cooldownKey = `echohunt:social-listening:export:${actor.type || "user"}:${cooldownSubject}:${board.id}`;
  if (redisClient?.set) {
    const ok = cooldownSeconds > 0
      ? await redisClient.set(cooldownKey, "1", { NX: true, EX: cooldownSeconds }).catch(() => "OK")
      : "OK";
    if (ok === null) throw publicError("EXPORT_RATE_LIMITED", 429, "导出太频繁，请稍后再试。", { retryAfter: cooldownSeconds });
  }

  const { where, rangeKey } = buildPostWhere(board.id, query, options);
  const total = await EchohuntSocialListeningPost.count({ where });
  if (total > exportMaxRows) {
    throw publicError("EXPORT_TOO_LARGE", 400, `导出数据超过 ${exportMaxRows} 行，请缩短时间范围或增加筛选条件。`);
  }

  const rows = await EchohuntSocialListeningPost.findAll({
    where,
    order: buildPostOrder(query.sort),
    limit: exportMaxRows,
    raw: true,
  });

  const data = rows.map((row) => {
    const post = serializePost(row);
    return {
      TweetID: post.tweetId,
      URL: post.tweetUrl,
      发布时间: post.postCreatedAt ? new Date(post.postCreatedAt).toISOString() : "",
      作者Handle: post.author.handle || "",
      作者名称: post.author.name || "",
      作者TwitterID: post.author.twitterId || "",
      粉丝数: post.author.followersCount ?? "",
      全球排名: post.author.globalRank ?? "",
      华语排名: post.author.cnRank ?? "",
      来源: post.source || "",
      情绪: post.sentiment || "unknown",
      项目态度分: post.projectAttitudeScore ?? "",
      Views: post.metrics.views,
      Likes: post.metrics.likes,
      Reposts: post.metrics.reposts,
      Quotes: post.metrics.quotes,
      Replies: post.metrics.replies,
      主题: (post.topics || []).join(", "),
      关键词: (post.keywords || []).join(", "),
      中文摘要: post.summaryZh || "",
      英文摘要: post.summaryEn || "",
      原文: post.text || "",
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Posts");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

  await EchohuntSocialListeningAccessAuditLog.create({
    boardId: board.id,
    adminId: actor.adminId || null,
    authCenterUserId: actor.authCenterUserId || null,
    action: "posts_export",
    payload: {
      rangeKey,
      total,
      filters: {
        sentiment: query.sentiment || query.filter || null,
        source: query.source || null,
        q: query.q || null,
        sort: query.sort || null,
      },
    },
  }).catch(() => null);

  return {
    buffer,
    filename: `EchoHunt_${board.officialHandle}_${rangeKey}_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)}.xlsx`,
    total,
  };
}

module.exports = {
  buildPostWhere,
  buildPostOrder,
  exportPostsXlsx,
};
