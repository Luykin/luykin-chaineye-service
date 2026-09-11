const { Op } = require("sequelize");
const { fetchTweetRowsByIds, searchTweetRowsByText } = require("./data-source");
const { buildTweetUrl, parseTweetUrl } = require("../utils/twitter");

const MAX_RESULTS = 20;
const MIN_TEXT_LENGTH = 4;
const MAX_INPUT_LENGTH = 1000;

function inputError(message) {
  const error = new Error("INVALID_RECALL_DIAGNOSTIC_INPUT");
  error.status = 400;
  error.publicMessage = message;
  return error;
}

function normalizeInput(value) {
  const input = String(value || "").trim();
  if (!input) throw inputError("请输入推文链接、tweet ID 或推文内容。");
  if (input.length > MAX_INPUT_LENGTH) throw inputError(`查询内容不能超过 ${MAX_INPUT_LENGTH} 个字符。`);

  const parsed = parseTweetUrl(input);
  if (parsed?.tweetId) {
    return { input, mode: "tweet_id", tweetId: parsed.tweetId, text: null };
  }
  if (input.length < MIN_TEXT_LENGTH) {
    throw inputError(`按内容搜索时至少输入 ${MIN_TEXT_LENGTH} 个字符。`);
  }
  return { input, mode: "text", tweetId: null, text: input };
}

function escapeLikePattern(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function buildContentPattern(value) {
  return `%${String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeLikePattern)
    .join("%")}%`;
}

function serializeSourceTweet(row) {
  if (!row) return null;
  const authorHandle = String(row.author_username_raw || row.author_username || "").replace(/^@+/, "") || null;
  return {
    tweetId: String(row.id),
    tweetUrl: buildTweetUrl(authorHandle, row.id),
    authorTwitterId: row.author_id ? String(row.author_id) : row.twitter_user_id ? String(row.twitter_user_id) : null,
    authorHandle,
    authorName: row.author_name || authorHandle,
    postCreatedAt: row.create_time || null,
    text: row.text || null,
    retweetId: row.retweet_id ? String(row.retweet_id) : null,
  };
}

function serializeLocalPost(row, boardById) {
  const board = boardById.get(String(row.boardId));
  const matchedKeywords = Array.isArray(row.rawTweet?.matchedKeywords) ? row.rawTweet.matchedKeywords : [];
  return {
    id: row.id,
    boardId: row.boardId,
    boardName: board?.projectName || null,
    boardHandle: board?.officialHandle || null,
    tweetId: String(row.tweetId),
    tweetUrl: buildTweetUrl(row.authorHandle, row.tweetId),
    authorHandle: row.authorHandle || null,
    postCreatedAt: row.postCreatedAt || null,
    recalledAt: row.createdAt || null,
    text: row.text || null,
    recallSource: row.source || null,
    matchedKeywords,
  };
}

async function diagnoseTweetRecall({ input, EchohuntSocialListeningPost, EchohuntSocialListeningBoard }) {
  const query = normalizeInput(input);
  let sourceRows = [];
  let sourceError = null;

  try {
    sourceRows = query.mode === "tweet_id"
      ? await fetchTweetRowsByIds([query.tweetId], 1)
      : await searchTweetRowsByText(query.text, MAX_RESULTS);
  } catch (error) {
    sourceError = error.publicMessage || "dev.tweet 只读源库查询失败，请稍后重试。";
  }

  const sourceTweetIds = sourceRows.map((row) => String(row.id || "")).filter(Boolean);
  const localContentWhere = query.mode === "text"
    ? {
      postCreatedAt: { [Op.gte]: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
      text: { [Op.iLike]: buildContentPattern(query.text) },
    }
    : null;
  const [localContentRows, localSourceRows] = await Promise.all([
    localContentWhere
      ? EchohuntSocialListeningPost.findAll({
        where: localContentWhere,
        order: [["postCreatedAt", "DESC"]],
        limit: MAX_RESULTS,
        raw: true,
      })
      : EchohuntSocialListeningPost.findAll({ where: { tweetId: query.tweetId }, raw: true }),
    sourceTweetIds.length
      ? EchohuntSocialListeningPost.findAll({ where: { tweetId: { [Op.in]: sourceTweetIds } }, raw: true })
      : [],
  ]);

  const localRowsById = new Map();
  [...localContentRows, ...localSourceRows].forEach((row) => localRowsById.set(String(row.id), row));
  const localRows = Array.from(localRowsById.values());

  if (!sourceError && query.mode === "text") {
    const knownSourceIds = new Set(sourceTweetIds);
    const missingSourceIds = Array.from(new Set(localRows
      .map((row) => String(row.tweetId || ""))
      .filter((tweetId) => tweetId && !knownSourceIds.has(tweetId))));
    if (missingSourceIds.length) {
      const extraSourceRows = await fetchTweetRowsByIds(missingSourceIds, missingSourceIds.length);
      sourceRows = [...sourceRows, ...extraSourceRows];
    }
  }

  const boardIds = Array.from(new Set(localRows.map((row) => String(row.boardId || "")).filter(Boolean)));
  const boards = boardIds.length
    ? await EchohuntSocialListeningBoard.findAll({
      where: { id: { [Op.in]: boardIds } },
      attributes: ["id", "projectName", "officialHandle"],
      raw: true,
    })
    : [];
  const boardById = new Map(boards.map((board) => [String(board.id), board]));
  const localItems = localRows.map((row) => serializeLocalPost(row, boardById));
  const localByTweetId = new Map();
  localItems.forEach((item) => {
    if (!localByTweetId.has(item.tweetId)) localByTweetId.set(item.tweetId, []);
    localByTweetId.get(item.tweetId).push(item);
  });

  const sourceByTweetId = new Map(sourceRows.map((row) => [String(row.id), serializeSourceTweet(row)]));
  const tweetIds = Array.from(new Set([...sourceByTweetId.keys(), ...localByTweetId.keys()]));
  const items = tweetIds.map((tweetId) => ({
    tweetId,
    source: sourceByTweetId.get(tweetId) || null,
    localMatches: localByTweetId.get(tweetId) || [],
  })).sort((left, right) => {
    const leftAt = new Date(left.source?.postCreatedAt || left.localMatches[0]?.postCreatedAt || 0).getTime();
    const rightAt = new Date(right.source?.postCreatedAt || right.localMatches[0]?.postCreatedAt || 0).getTime();
    return rightAt - leftAt;
  });

  const sourceItems = items.filter((item) => item.source);
  const localTweetCount = items.filter((item) => item.localMatches.length).length;
  return {
    query: {
      mode: query.mode,
      input: query.input,
      tweetId: query.tweetId,
      contentWindowDays: query.mode === "text" ? 31 : null,
      resultLimit: MAX_RESULTS,
    },
    source: {
      available: !sourceError,
      error: sourceError,
    },
    summary: {
      sourceTweets: sourceItems.length,
      localTweets: localTweetCount,
      localRecords: localItems.length,
      recalledSourceTweets: sourceItems.filter((item) => item.localMatches.length).length,
      unrecalledSourceTweets: sourceItems.filter((item) => !item.localMatches.length).length,
    },
    items,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  diagnoseTweetRecall,
  normalizeInput,
};
