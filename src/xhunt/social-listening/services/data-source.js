const axios = require("axios");
const { QueryTypes } = require("sequelize");
const {
  getPostgresReadOnlyInstance,
  getPostgresReadOnlyStatus,
  isPostgresReadOnlyConfigured,
} = require("../../../infra/k8s/postgres-readonly");
const { assertTwitterHandle } = require("../utils/twitter");
const { normalizeTweetText, collectMatchedKeywords, normalizeKeywords } = require("../utils/text-normalize");
const { ACCOUNT_SIGNAL_TYPES } = require("../constants");
const { getSocialListeningRuntimeConfig } = require("./runtime-config");

const SOCIAL_LISTENING_READONLY_SCOPE = "social-listening";

function getReadonlyDbOrThrow() {
  const status = getPostgresReadOnlyStatus(SOCIAL_LISTENING_READONLY_SCOPE);
  if (!isPostgresReadOnlyConfigured(SOCIAL_LISTENING_READONLY_SCOPE) || !status.ready) {
    const error = new Error("PG_READ_NOT_READY");
    error.status = 503;
    error.publicMessage = "只读数据源暂不可用，请稍后再试。";
    error.details = status;
    throw error;
  }
  return getPostgresReadOnlyInstance(SOCIAL_LISTENING_READONLY_SCOPE);
}

function clampInteger(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
}

function escapeLikePattern(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function escapeRegexPattern(value) {
  return String(value || "").replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function buildKeywordScanPattern(keyword, index) {
  const normalizedKeyword = String(keyword || "").trim().replace(/^@+/, "");
  if (hasCjk(normalizedKeyword)) {
    return {
      key: `kw${index}`,
      type: "like",
      value: `%${escapeLikePattern(normalizedKeyword)}%`,
    };
  }
  return {
    key: `kw${index}`,
    type: "regex",
    value: `(^|[^a-z0-9])${escapeRegexPattern(normalizedKeyword)}([^a-z0-9]|$)`,
  };
}

function isNumericId(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function isStatementTimeoutError(error) {
  const errors = [error, error?.parent, error?.original].filter(Boolean);
  return errors.some((item) => {
    const code = String(item.code || "");
    const message = String(item.message || "");
    return code === "57014" && /statement timeout/i.test(message);
  }) || errors.some((item) => /canceling statement due to statement timeout/i.test(String(item.message || "")));
}

function isReadonlyPoolAcquireTimeoutError(error) {
  const errors = [error, error?.parent, error?.original].filter(Boolean);
  return errors.some((item) => String(item.name || "") === "SequelizeConnectionAcquireTimeoutError")
    || errors.some((item) => String(item.code || "") === "PG_READ_POOL_ACQUIRE_TIMEOUT")
    || errors.some((item) => /Operation timeout/i.test(String(item.message || "")));
}

function normalizeReadonlyQueryError(error, db) {
  if (!isReadonlyPoolAcquireTimeoutError(error)) return error;
  const pool = db?.options?.pool || {};
  error.code = "PG_READ_POOL_ACQUIRE_TIMEOUT";
  error.status = 503;
  error.publicMessage = [
    "Social Listening 获取只读 PostgreSQL 连接超时，不是前端 URL 或接口地址配置问题。",
    `只读连接池 scope=${SOCIAL_LISTENING_READONLY_SCOPE} max=${pool.max || "-"} acquire=${pool.acquire || "-"}ms。`,
    "通常是只读池被慢查询/并发查询占满，可调大 K8S_PG_READ_SOCIAL_LISTENING_POOL_MAX，或降低 social-listening 的 scan.pageSize / scan.maxPages / scheduler.maxJobsPerTick 后重试。",
  ].join(" ");
  error.details = {
    scope: SOCIAL_LISTENING_READONLY_SCOPE,
    poolMax: pool.max,
    poolAcquireMs: pool.acquire,
  };
  return error;
}

async function queryReadonlyWithStatementTimeout(db, sql, queryOptions, statementTimeoutMs) {
  const configuredTimeout = statementTimeoutMs ?? (await getSocialListeningRuntimeConfig()).scan?.statementTimeoutMs;
  const timeoutMs = Number(configuredTimeout);
  try {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return await db.query(sql, queryOptions);

    // 使用 Sequelize managed transaction，异常时会自动 rollback 并释放连接；
    // 不在业务代码里保存 transaction / connection 引用，避免异常路径泄漏只读连接。
    return await db.transaction(async (transaction) => {
      await db.query("SELECT set_config('statement_timeout', $statementTimeout, true)", {
        bind: { statementTimeout: `${Math.floor(timeoutMs)}ms` },
        type: QueryTypes.SELECT,
        transaction,
      });
      return db.query(sql, { ...queryOptions, transaction });
    });
  } catch (error) {
    throw normalizeReadonlyQueryError(error, db);
  }
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickPositiveRank(...values) {
  for (const value of values) {
    const num = toNumberOrNull(value);
    if (num !== null && num > 0) return num;
  }
  return null;
}

function pickRank(user = {}) {
  const featureRank = user.feature?.rank || {};
  const kol = user.kol || {};
  const snap = kol.snap_20250606 || {};
  return {
    // EchoHunt 前台“全球排名”对应 XHunt KOL 总榜 kolRank；kolGlobalRank 是另一套更宽泛的全球字段，
    // 不能优先用于“全球 #”展示，否则会把 DeFiTeddy 这类账号展示成 #47.9K 而不是 #1.8K。
    globalRank: pickPositiveRank(
      featureRank.kolRank,
      featureRank.globalRank,
      featureRank.kolGlobalRank,
      snap.global?.rank
    ),
    cnRank: pickPositiveRank(
      featureRank.kolCnRank,
      featureRank.cnRank,
      featureRank.kolChineseRank,
      snap.cn?.rank
    ),
    rawRank: Object.keys(featureRank).length ? featureRank : null,
  };
}

function pickAvatarUrl(profile = {}) {
  return profile.profile_image_url ||
    profile.profile_image_url_https ||
    profile.profileImageUrl ||
    profile.profileImageUrlHttps ||
    profile.avatar ||
    profile.avatar_url ||
    profile.avatarUrl ||
    profile.image ||
    profile.image_url ||
    profile.imageUrl ||
    null;
}

function serializeTwitterUser(row) {
  if (!row) return null;
  const profile = row.profile && typeof row.profile === "object" ? row.profile : {};
  const rank = pickRank(row);
  const handle = String(row.username_raw || row.username || "").replace(/^@+/, "");
  return {
    twitterId: row.id ? String(row.id) : null,
    handle: handle || null,
    handleLower: String(row.username || handle || "").toLowerCase() || null,
    name: row.name || handle || null,
    description: profile.description || null,
    avatar: pickAvatarUrl(profile),
    banner: profile.profile_banner_url || null,
    verified: profile.verified ?? profile.is_blue_verified ?? null,
    followersCount: toNumberOrNull(profile.followers_count),
    followingCount: toNumberOrNull(profile.following_count),
    tweetsCount: toNumberOrNull(profile.tweets_count),
    listedCount: toNumberOrNull(profile.listed_count),
    isCn: row.ai?.is_cn ?? null,
    globalRank: rank.globalRank,
    cnRank: rank.cnRank,
    rankSource: rank.rawRank ? "feature.rank" : null,
    raw: {
      id: row.id ? String(row.id) : null,
      username: row.username || null,
      usernameRaw: row.username_raw || null,
      name: row.name || null,
      profile,
      ai: row.ai || null,
      feature: row.feature || null,
      kol: row.kol || null,
    },
  };
}

async function resolveTwitterUserByHandle(handle) {
  const normalizedHandle = assertTwitterHandle(handle);
  const db = getReadonlyDbOrThrow();
  const [row] = await db.query(
    `
      SELECT id::text, username, username_raw, name, profile, ai, feature, kol
      FROM dev.twitter_user
      WHERE username = $handle
      LIMIT 1
    `,
    {
      bind: { handle: normalizedHandle },
      type: QueryTypes.SELECT,
    }
  );
  return serializeTwitterUser(row);
}

function buildBoardKeywords(board) {
  const metadata = board?.metadata && typeof board.metadata === "object" ? board.metadata : {};
  return normalizeKeywords([
    board?.officialHandle,
    board?.projectName,
    ...(Array.isArray(metadata.keywords) ? metadata.keywords : []),
    ...(Array.isArray(metadata.aliases) ? metadata.aliases : []),
    ...(metadata.token ? [metadata.token] : []),
  ]);
}

function buildBoardRecallExcludeKeywords(board) {
  const metadata = board?.metadata && typeof board.metadata === "object" ? board.metadata : {};
  const recall = metadata.recall && typeof metadata.recall === "object" ? metadata.recall : {};
  return normalizeKeywords([
    ...(Array.isArray(metadata.recallExcludeKeywords) ? metadata.recallExcludeKeywords : []),
    ...(Array.isArray(metadata.excludeKeywords) ? metadata.excludeKeywords : []),
    ...(Array.isArray(recall.excludeKeywords) ? recall.excludeKeywords : []),
  ]);
}

async function fetchOfficialTweetIdsForBoard(db, board, startAt, endAt, limit) {
  if (!isNumericId(board?.officialTwitterId)) return [];
  const rows = await queryReadonlyWithStatementTimeout(
    db,
    `
      SELECT ot.id::text AS id
      FROM dev.tweet ot
      WHERE ot.twitter_user_id::text = $officialTwitterId
        AND ot.create_time >= ($startAt::timestamptz - interval '30 days')
        AND ot.create_time < $endAt
      ORDER BY ot.create_time DESC
      LIMIT $limit
    `,
    {
      bind: {
        officialTwitterId: String(board.officialTwitterId),
        startAt,
        endAt,
        limit,
      },
      type: QueryTypes.SELECT,
    }
  );
  return rows.map((row) => String(row.id)).filter(Boolean);
}

async function fetchCandidateTweetPage(db, bind, keywordClause, excludeClause) {
  return queryReadonlyWithStatementTimeout(
    db,
    `
      SELECT
        t.id::text AS id,
        t.create_time,
        (
          (
            ${keywordClause}
            OR (
              cardinality($officialTweetIds::text[]) > 0
              AND (
                t.quote_id::text = ANY($officialTweetIds::text[])
                OR t.reply_id::text = ANY($officialTweetIds::text[])
              )
            )
          )
          AND NOT (${excludeClause})
        ) AS is_match
      FROM dev.tweet t
      WHERE t.create_time >= $startAt
        AND t.create_time < $endAt
        AND t.retweet_id IS NULL
        AND (
          $cursorCreateTime::timestamptz IS NULL
          OR t.create_time < $cursorCreateTime::timestamptz
          OR (t.create_time = $cursorCreateTime::timestamptz AND t.id::text < $cursorTweetId)
        )
      ORDER BY t.create_time DESC, t.id::text DESC
      LIMIT $pageSize
    `,
    { bind, type: QueryTypes.SELECT }
  );
}

async function fetchTweetRowsByIds(db, tweetIds, limit) {
  if (!tweetIds.length) return [];
  return queryReadonlyWithStatementTimeout(
    db,
    `
      SELECT
        t.id::text,
        t.text,
        t.create_time,
        t.twitter_user_id::text,
        t.conversation_id::text,
        t.quote_id::text,
        t.reply_id::text,
        t.retweet_id::text,
        t.statistic,
        t.info,
        t.mention,
        t.metric_observed_at,
        u.id::text AS author_id,
        u.username AS author_username,
        u.username_raw AS author_username_raw,
        u.name AS author_name,
        u.profile AS author_profile,
        u.ai AS author_ai,
        u.feature AS author_feature,
        u.kol AS author_kol
      FROM dev.tweet t
      JOIN dev.twitter_user u ON u.id::text = t.twitter_user_id::text
      WHERE t.id::text = ANY($tweetIds::text[])
      ORDER BY t.create_time DESC, t.id::text DESC
      LIMIT $limit
    `,
    { bind: { tweetIds, limit }, type: QueryTypes.SELECT }
  );
}


async function fetchTweetRowById(tweetId) {
  const db = getReadonlyDbOrThrow();
  const rows = await fetchTweetRowsByIds(db, [String(tweetId)], 1);
  return rows[0] || null;
}

function getSocialListeningCrawlerUrl() {
  const fullUrl = String(process.env.SOCIAL_LISTENING_CRAWLER_URL || "").trim();
  if (fullUrl) return fullUrl;
  const baseUrl = String(
    process.env.SOCIAL_LISTENING_CRAWLER_BASE_URL ||
      process.env.CRYPTOHUNT_CRAWLER_BASE_URL ||
      process.env.CRAWLER_TWITTER_BASE_URL ||
      ""
  ).trim().replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}/crawler` : "";
}

function findCrawlerTweetPayload(value, tweetId) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || value.tweet_id || "");
  if (id && id === String(tweetId)) return value;
  if (value.tweet && typeof value.tweet === "object") {
    const tweet = findCrawlerTweetPayload(value.tweet, tweetId);
    if (tweet) return tweet;
  }
  if (Array.isArray(value.tweets)) {
    for (const item of value.tweets) {
      const tweet = findCrawlerTweetPayload(item, tweetId);
      if (tweet) return tweet;
    }
  }
  if (value.data && typeof value.data === "object") {
    const tweet = findCrawlerTweetPayload(value.data, tweetId);
    if (tweet) return tweet;
  }
  return null;
}

function pickCrawlerEventTime(tweet = {}) {
  const candidates = [tweet.time_parsed, tweet.created_at, tweet.create_time];
  for (const value of candidates) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const timestamp = Number(tweet.timestamp || tweet.createdAtTimestamp || 0);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    const date = new Date(timestamp > 10_000_000_000 ? timestamp : timestamp * 1000);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function buildCrawlerTweetEventSnapshot(tweet = {}, parsed = {}) {
  const profile = tweet.user_profile && typeof tweet.user_profile === "object" ? tweet.user_profile : {};
  const authorHandle = String(profile.username || tweet.username || parsed.handle || "").replace(/^@+/, "").toLowerCase() || null;
  const tweetId = String(tweet.id || parsed.tweetId || "");
  const eventAt = pickCrawlerEventTime(tweet);
  return {
    tweetId,
    tweetUrl: tweet.permanent_url || (tweetId ? `https://x.com/${authorHandle || "i/web"}/status/${tweetId}` : parsed.url || null),
    authorTwitterId: profile.id || tweet.user_id || null,
    authorHandle,
    authorName: profile.name || tweet.name || authorHandle,
    authorAvatar: profile.profile_image_url || null,
    authorGlobalRank: null,
    postCreatedAt: eventAt,
    text: tweet.text || null,
    source: "crawler",
    metrics: {
      views: toNumberOrNull(tweet.views),
      likes: toNumberOrNull(tweet.likes),
      reposts: toNumberOrNull(tweet.retweet_count),
      quotes: toNumberOrNull(tweet.quote_count),
      replies: toNumberOrNull(tweet.reply_count),
      bookmarks: toNumberOrNull(tweet.bookmark_count),
    },
    raw: tweet,
  };
}

async function fetchTweetSnapshotFromCrawler(tweetId, parsed = {}) {
  const crawlerUrl = getSocialListeningCrawlerUrl();
  if (!crawlerUrl) return null;
  const response = await axios.post(crawlerUrl, {
    endpoint: "tweet_detail",
    tweet_id: String(tweetId),
  }, {
    timeout: Number(process.env.SOCIAL_LISTENING_CRAWLER_TIMEOUT_MS || 18000),
    headers: { "Content-Type": "application/json" },
  });
  const body = response.data || {};
  const code = Number(body.code || body.status || 200);
  if (code && code !== 200) return null;
  const tweet = findCrawlerTweetPayload(body.data ?? body, tweetId);
  if (!tweet) return null;
  const snapshot = buildCrawlerTweetEventSnapshot(tweet, parsed);
  return snapshot.postCreatedAt ? snapshot : null;
}

function buildInitialAiFields(matchedKeywords = []) {
  const keywords = matchedKeywords.filter(Boolean);
  return {
    topics: null,
    keywords: keywords.length ? Array.from(new Set(keywords.map(String))) : matchedKeywords,
    summaryZh: null,
    summaryEn: null,
    titleZh: null,
    titleEn: null,
    abstractZh: null,
    abstractEn: null,
    tagStatus: "pending",
    summaryStatus: "pending",
    aiSource: "social_listening_pending",
  };
}

function pickStat(statistic = {}, ...keys) {
  for (const key of keys) {
    const value = toNumberOrNull(statistic?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function detectSource(tweet, officialHandle, matchedKeywords) {
  const infoMentions = Array.isArray(tweet.info?.mentions) ? tweet.info.mentions : [];
  const mentioned = infoMentions.some((item) => {
    const username = String(item?.username || item?.screen_name || item || "").replace(/^@+/, "").toLowerCase();
    return username === officialHandle;
  });
  if (mentioned || matchedKeywords.length > 0) return "mention";
  if (tweet.quote_id) return "quote";
  if (tweet.reply_id) return "reply";
  if (tweet.conversation_id) return "comment";
  return "mention";
}

function mapTweetRowToPostPayload(board, row) {
  const officialHandle = String(board.officialHandle || "").toLowerCase();
  const keywords = buildBoardKeywords(board);
  const normalizedText = normalizeTweetText(row.text);
  const matchedKeywords = collectMatchedKeywords(`${normalizedText} ${row.text || ""}`, keywords);
  const author = serializeTwitterUser({
    id: row.author_id,
    username: row.author_username,
    username_raw: row.author_username_raw,
    name: row.author_name,
    profile: row.author_profile,
    ai: row.author_ai,
    feature: row.author_feature,
    kol: row.author_kol,
  });
  const ai = buildInitialAiFields(matchedKeywords);
  const statistic = row.statistic && typeof row.statistic === "object" ? row.statistic : {};

  return {
    boardId: board.id,
    tweetId: String(row.id),
    authorTwitterId: String(row.author_id || row.twitter_user_id),
    authorHandle: author?.handle || null,
    authorName: author?.name || null,
    authorAvatar: author?.avatar || null,
    authorFollowersCount: author?.followersCount,
    authorGlobalRank: author?.globalRank,
    authorCnRank: author?.cnRank,
    authorIsCn: author?.isCn,
    postCreatedAt: row.create_time,
    text: row.text || null,
    normalizedText,
    source: detectSource(row, officialHandle, matchedKeywords),
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    quoteId: row.quote_id ? String(row.quote_id) : null,
    replyId: row.reply_id ? String(row.reply_id) : null,
    retweetId: row.retweet_id ? String(row.retweet_id) : null,
    viewsCount: pickStat(statistic, "views", "view_count", "impression_count"),
    likesCount: pickStat(statistic, "likes", "like_count"),
    repostsCount: pickStat(statistic, "retweet_count", "reposts", "repost_count"),
    quotesCount: pickStat(statistic, "quote_count", "quotes"),
    repliesCount: pickStat(statistic, "reply_count", "replies"),
    sentiment: "unknown",
    attitudeStatus: "pending",
    aiStatus: "pending",
    ...ai,
    rawTweet: {
      id: String(row.id),
      metricObservedAt: row.metric_observed_at || null,
      matchedKeywords,
      info: row.info || null,
      mention: row.mention || null,
    },
    rawAuthor: author?.raw || null,
  };
}

async function fetchCandidateTweetsForBoard(board, startAt, endAt, options = {}) {
  const db = getReadonlyDbOrThrow();
  const runtimeConfig = await getSocialListeningRuntimeConfig();
  const scanConfig = runtimeConfig.scan || {};
  const limit = Math.min(Math.max(Number(options.limit || scanConfig.matchLimit || 500), 1), 2000);
  const pageSize = clampInteger(options.pageSize || scanConfig.pageSize, scanConfig.pageSize || 200, 50, 1000);
  const maxPages = clampInteger(options.maxPages || scanConfig.maxPages, scanConfig.maxPages || 3, 1, 20);
  const scanLimit = pageSize * maxPages;
  const officialPostLimit = clampInteger(options.officialPostScanLimit || scanConfig.officialPostScanLimit, scanConfig.officialPostScanLimit || 1000, 50, 5000);
  const keywords = buildBoardKeywords(board).slice(0, 10);
  const recallExcludeKeywords = buildBoardRecallExcludeKeywords(board).slice(0, 20);
  const patterns = keywords.map(buildKeywordScanPattern);
  const excludePatterns = recallExcludeKeywords.map((keyword, index) => ({
    ...buildKeywordScanPattern(keyword, index),
    key: `excludeKw${index}`,
  }));

  const keywordClause = patterns.length
    ? patterns.map((item) => (
      item.type === "regex"
        ? `COALESCE(t.text, '') ~* $${item.key}`
        : `t.text ILIKE $${item.key} ESCAPE '\\'`
    )).join(" OR ")
    : "FALSE";

  const excludeClause = excludePatterns.length
    ? excludePatterns.map((item) => (
      item.type === "regex"
        ? `COALESCE(t.text, '') ~* $${item.key}`
        : `t.text ILIKE $${item.key} ESCAPE '\\'`
    )).join(" OR ")
    : "FALSE";

  const scanMeta = {
    strategy: "keyset_candidate_pages",
    pageSize,
    maxPages,
    scanLimit,
    matchLimit: limit,
    recallExcludeCount: recallExcludeKeywords.length,
    officialPostLimit,
    officialPostCount: 0,
    pagesScanned: 0,
    candidatesScanned: 0,
    matchedBeforeLimit: 0,
    stoppedReason: "max_pages",
  };

  let rows = [];
  try {
    const officialTweetIds = await fetchOfficialTweetIdsForBoard(db, board, startAt, endAt, officialPostLimit);
    scanMeta.officialPostCount = officialTweetIds.length;

    const matchedIds = [];
    const seenIds = new Set();
    let cursorCreateTime = null;
    let cursorTweetId = null;
    for (let page = 0; page < maxPages && matchedIds.length < limit; page += 1) {
      const bind = {
        startAt,
        endAt,
        pageSize,
        cursorCreateTime,
        cursorTweetId: cursorTweetId || "0",
        officialTweetIds,
      };
      patterns.forEach((item) => { bind[item.key] = item.value; });
      excludePatterns.forEach((item) => { bind[item.key] = item.value; });

      const pageRows = await fetchCandidateTweetPage(db, bind, keywordClause, excludeClause);
      scanMeta.pagesScanned += 1;
      scanMeta.candidatesScanned += pageRows.length;
      if (!pageRows.length) {
        scanMeta.stoppedReason = "no_more_candidates";
        break;
      }

      for (const item of pageRows) {
        const id = String(item.id || "");
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        if (item.is_match === true || item.is_match === "true" || item.is_match === "t") matchedIds.push(id);
        if (matchedIds.length >= limit) {
          scanMeta.stoppedReason = "match_limit";
          break;
        }
      }

      const last = pageRows[pageRows.length - 1];
      cursorCreateTime = last.create_time;
      cursorTweetId = String(last.id || "0");
      if (pageRows.length < pageSize) {
        scanMeta.stoppedReason = "no_more_candidates";
        break;
      }
    }
    scanMeta.matchedBeforeLimit = matchedIds.length;
    rows = await fetchTweetRowsByIds(db, matchedIds.slice(0, limit), limit);
  } catch (error) {
    if (isReadonlyPoolAcquireTimeoutError(error)) {
      scanMeta.stoppedReason = "readonly_pool_acquire_timeout";
      throw error;
    }
    if (!isStatementTimeoutError(error)) throw error;
    error.publicMessage = [
      "只读库扫描推文超时，不是前端 URL 或接口地址配置问题。",
      `当前窗口：${new Date(startAt).toISOString()} → ${new Date(endAt).toISOString()}。`,
      `当前已按 keyset 分页扫描，已扫 ${scanMeta.pagesScanned} 页 / ${maxPages} 页，每页 ${pageSize} 条。`,
      "可在 Nacos 配置 echohunt_social_listening_config 中调小 scan.windowMinutes / scan.pageSize / scan.maxPages，或调大 scan.statementTimeoutMs 后重试。",
    ].join(" ");
    throw error;
  }

  Object.defineProperty(rows, "scanMeta", {
    enumerable: false,
    value: scanMeta,
  });
  return rows;
}

function shouldIncludeProjectFollow(board) {
  return Boolean(board?.officialTwitterId);
}

function mapRelationRow(row) {
  const account = serializeTwitterUser({
    id: row.related_id,
    username: row.related_username,
    username_raw: row.related_username_raw,
    name: row.related_name,
    profile: row.related_profile,
    ai: row.related_ai,
    feature: row.related_feature,
    kol: row.related_kol,
  });
  return {
    signalType: row.signal_type,
    occurredAt: row.occurred_at,
    sourceTable: row.source_table,
    direction: row.direction,
    projectKey: row.project_key || null,
    relation: {
      followerId: row.follower_id ? String(row.follower_id) : null,
      followingId: row.following_id ? String(row.following_id) : null,
      latest: toNumberOrNull(row.latest),
      persist: toNumberOrNull(row.persist),
    },
    account,
  };
}

async function fetchFollowSignalsForBoard(board, startAt, endAt, options = {}) {
  if (!isNumericId(board?.officialTwitterId)) return [];
  const db = getReadonlyDbOrThrow();
  const runtimeConfig = await getSocialListeningRuntimeConfig();
  const scanConfig = runtimeConfig.scan || {};
  const limit = Math.min(Math.max(Number(options.limit || 200), 1), 1000);
  const followLatestMin = clampInteger(options.followLatestMin ?? scanConfig.followLatestMin, 150, 1, 200);
  const now = options.now || new Date();
  const safeUnfollowEndAt = new Date(Math.min(new Date(endAt).getTime(), now.getTime() - 60 * 60 * 1000));
  const bind = {
    officialTwitterId: String(board.officialTwitterId),
    startAt,
    endAt,
    safeUnfollowEndAt,
    limit,
    followLatestMin,
  };

  const unionParts = [
    `
      SELECT
        'dev.twitter_user_follow' AS source_table,
        '${ACCOUNT_SIGNAL_TYPES.ACCOUNT_FOLLOWED_PROJECT}' AS signal_type,
        'inbound' AS direction,
        f.follower_id::text AS related_id,
        f.follower_id::text AS follower_id,
        f.following_id::text AS following_id,
        f.created_at AS occurred_at,
        f.latest,
        NULL::integer AS persist,
        NULL::text AS project_key
      FROM dev.twitter_user_follow f
        WHERE f.following_id::text = $officialTwitterId
        AND f.created_at >= $startAt
        AND f.created_at < $endAt
        AND COALESCE(f.latest, 0) >= $followLatestMin
    `,
    `
      SELECT
        'dev.twitter_user_follow' AS source_table,
        '${ACCOUNT_SIGNAL_TYPES.PROJECT_FOLLOWED_ACCOUNT}' AS signal_type,
        'outbound' AS direction,
        f.following_id::text AS related_id,
        f.follower_id::text AS follower_id,
        f.following_id::text AS following_id,
        f.created_at AS occurred_at,
        f.latest,
        NULL::integer AS persist,
        NULL::text AS project_key
      FROM dev.twitter_user_follow f
        WHERE f.follower_id::text = $officialTwitterId
        AND f.created_at >= $startAt
        AND f.created_at < $endAt
        AND COALESCE(f.latest, 0) >= $followLatestMin
    `,
  ];

  if (safeUnfollowEndAt > new Date(startAt)) {
    unionParts.push(
      `
        SELECT
          'dev.twitter_user_unfollow' AS source_table,
          '${ACCOUNT_SIGNAL_TYPES.ACCOUNT_UNFOLLOWED_PROJECT}' AS signal_type,
          'inbound' AS direction,
          uf.follower_id::text AS related_id,
          uf.follower_id::text AS follower_id,
          uf.following_id::text AS following_id,
          uf.created_at AS occurred_at,
          uf.latest,
          uf.persist,
          NULL::text AS project_key
        FROM dev.twitter_user_unfollow uf
        WHERE uf.following_id::text = $officialTwitterId
          AND uf.created_at >= $startAt
          AND uf.created_at < $safeUnfollowEndAt
          AND (COALESCE(uf.persist, 0) > 0 OR COALESCE(uf.latest, 0) > 0)
      `,
      `
        SELECT
          'dev.twitter_user_unfollow' AS source_table,
          '${ACCOUNT_SIGNAL_TYPES.PROJECT_UNFOLLOWED_ACCOUNT}' AS signal_type,
          'outbound' AS direction,
          uf.following_id::text AS related_id,
          uf.follower_id::text AS follower_id,
          uf.following_id::text AS following_id,
          uf.created_at AS occurred_at,
          uf.latest,
          uf.persist,
          NULL::text AS project_key
        FROM dev.twitter_user_unfollow uf
        WHERE uf.follower_id::text = $officialTwitterId
          AND uf.created_at >= $startAt
          AND uf.created_at < $safeUnfollowEndAt
          AND (COALESCE(uf.persist, 0) > 0 OR COALESCE(uf.latest, 0) > 0)
      `
    );
  }

  if (shouldIncludeProjectFollow(board)) {
    unionParts.push(
      `
        SELECT
          'dev.project_follow' AS source_table,
          '${ACCOUNT_SIGNAL_TYPES.ACCOUNT_FOLLOWED_PROJECT}' AS signal_type,
          'project_inbound' AS direction,
          pf.follower_id::text AS related_id,
          pf.follower_id::text AS follower_id,
          pf.following_id::text AS following_id,
          pf.created_at AS occurred_at,
          pf.latest,
          NULL::integer AS persist,
          pf.project::text AS project_key
        FROM dev.project_follow pf
        WHERE pf.following_id::text = $officialTwitterId
          AND pf.created_at >= $startAt
          AND pf.created_at < $endAt
          AND pf.latest > 0
      `,
      `
        SELECT
          'dev.project_follow' AS source_table,
          '${ACCOUNT_SIGNAL_TYPES.PROJECT_FOLLOWED_ACCOUNT}' AS signal_type,
          'project_outbound' AS direction,
          pf.following_id::text AS related_id,
          pf.follower_id::text AS follower_id,
          pf.following_id::text AS following_id,
          pf.created_at AS occurred_at,
          pf.latest,
          NULL::integer AS persist,
          pf.project::text AS project_key
        FROM dev.project_follow pf
        WHERE pf.follower_id::text = $officialTwitterId
          AND pf.created_at >= $startAt
          AND pf.created_at < $endAt
          AND pf.latest > 0
      `
    );
  }

  const rows = await queryReadonlyWithStatementTimeout(
    db,
    `
      WITH relation_rows AS (
        ${unionParts.join("\nUNION ALL\n")}
      )
      SELECT
        r.*,
        u.id::text AS related_id,
        u.username AS related_username,
        u.username_raw AS related_username_raw,
        u.name AS related_name,
        u.profile AS related_profile,
        u.ai AS related_ai,
        u.feature AS related_feature,
        u.kol AS related_kol
      FROM relation_rows r
      JOIN dev.twitter_user u ON u.id::text = r.related_id
      WHERE r.related_id <> $officialTwitterId
      ORDER BY r.occurred_at DESC
      LIMIT $limit
    `,
    { bind, type: QueryTypes.SELECT }
  );

  return rows.map(mapRelationRow);
}

module.exports = {
  getReadonlyDbOrThrow,
  resolveTwitterUserByHandle,
  serializeTwitterUser,
  pickRank,
  buildBoardKeywords,
  mapTweetRowToPostPayload,
  fetchTweetRowById,
  fetchTweetSnapshotFromCrawler,
  fetchCandidateTweetsForBoard,
  fetchFollowSignalsForBoard,
};
