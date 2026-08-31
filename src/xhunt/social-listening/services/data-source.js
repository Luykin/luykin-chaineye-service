const { QueryTypes } = require("sequelize");
const {
  getPostgresReadOnlyInstance,
  getPostgresReadOnlyStatus,
  isPostgresReadOnlyConfigured,
} = require("../../../infra/k8s/postgres-readonly");
const { assertTwitterHandle } = require("../utils/twitter");
const { normalizeTweetText, collectMatchedKeywords, normalizeKeywords } = require("../utils/text-normalize");
const { ACCOUNT_SIGNAL_TYPES } = require("../constants");

function getReadonlyDbOrThrow() {
  const status = getPostgresReadOnlyStatus();
  if (!isPostgresReadOnlyConfigured() || !status.ready) {
    const error = new Error("PG_READ_NOT_READY");
    error.status = 503;
    error.publicMessage = "只读数据源暂不可用，请稍后再试。";
    error.details = status;
    throw error;
  }
  return getPostgresReadOnlyInstance();
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickRank(user = {}) {
  const featureRank = user.feature?.rank || {};
  const kol = user.kol || {};
  const snap = kol.snap_20250606 || {};
  return {
    globalRank: toNumberOrNull(
      featureRank.kolGlobalRank ??
        featureRank.kolRank ??
        featureRank.globalRank ??
        snap.global?.rank
    ),
    cnRank: toNumberOrNull(
      featureRank.kolCnRank ??
        featureRank.cnRank ??
        featureRank.kolChineseRank ??
        snap.cn?.rank
    ),
    rawRank: featureRank,
  };
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
    avatar: profile.profile_image_url || null,
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
  const limit = Math.min(Math.max(Number(options.limit || 500), 1), 2000);
  const keywords = buildBoardKeywords(board).slice(0, 10);
  const patterns = keywords.map((keyword, index) => ({ key: `kw${index}`, value: `%${String(keyword).replace(/^@+/, "")}%` }));
  const bind = {
    startAt,
    endAt,
    limit,
    officialTwitterId: board.officialTwitterId ? String(board.officialTwitterId) : null,
  };
  patterns.forEach((item) => { bind[item.key] = item.value; });

  const keywordClause = patterns.length
    ? patterns.map((item) => `t.text ILIKE $${item.key}`).join(" OR ")
    : "FALSE";

  return db.query(
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
      JOIN dev.twitter_user u ON u.id = t.twitter_user_id
      WHERE t.create_time >= $startAt
        AND t.create_time < $endAt
        AND t.retweet_id IS NULL
        AND (
          ${keywordClause}
          OR ($officialTwitterId::text IS NOT NULL AND t.quote_id::text IN (
            SELECT ot.id::text FROM dev.tweet ot
            WHERE ot.twitter_user_id::text = $officialTwitterId
              AND ot.create_time >= ($startAt::timestamptz - interval '30 days')
              AND ot.create_time < $endAt
          ))
          OR ($officialTwitterId::text IS NOT NULL AND t.reply_id::text IN (
            SELECT rt.id::text FROM dev.tweet rt
            WHERE rt.twitter_user_id::text = $officialTwitterId
              AND rt.create_time >= ($startAt::timestamptz - interval '30 days')
              AND rt.create_time < $endAt
          ))
        )
      ORDER BY t.create_time DESC
      LIMIT $limit
    `,
    { bind, type: QueryTypes.SELECT }
  );
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
  if (!board?.officialTwitterId) return [];
  const db = getReadonlyDbOrThrow();
  const limit = Math.min(Math.max(Number(options.limit || 200), 1), 1000);
  const now = options.now || new Date();
  const safeUnfollowEndAt = new Date(Math.min(new Date(endAt).getTime(), now.getTime() - 60 * 60 * 1000));
  const bind = {
    officialTwitterId: String(board.officialTwitterId),
    startAt,
    endAt,
    safeUnfollowEndAt,
    limit,
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
        AND f.latest > 0
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
        AND f.latest > 0
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

  const rows = await db.query(
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
  buildBoardKeywords,
  mapTweetRowToPostPayload,
  fetchCandidateTweetsForBoard,
  fetchFollowSignalsForBoard,
};
