const { Op } = require("sequelize");
const {
  buildBoardKeywords,
  buildBoardRecallExcludeAuthorHandles,
  buildBoardRecallExcludeKeywords,
  fetchTweetRowsByIds,
  searchTweetRowsByText,
} = require("./data-source");
const { buildTweetUrl, normalizeTwitterHandle, parseTweetUrl } = require("../utils/twitter");
const { collectMatchedKeywords, normalizeTweetText } = require("../utils/text-normalize");

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
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    quoteId: row.quote_id ? String(row.quote_id) : null,
    replyId: row.reply_id ? String(row.reply_id) : null,
    retweetId: row.retweet_id ? String(row.retweet_id) : null,
  };
}

function getDiagnosticJobRange(job) {
  const progress = job.progress && typeof job.progress === "object" ? job.progress : {};
  const progressRange = progress.range && typeof progress.range === "object" ? progress.range : {};
  return {
    startAt: job.rangeStartAt || progressRange.startAt || null,
    endAt: job.rangeEndAt || progressRange.endAt || null,
  };
}

function isDateWithinJobRange(value, job) {
  const range = getDiagnosticJobRange(job);
  const timestamp = new Date(value || 0).getTime();
  const startAt = new Date(range.startAt || 0).getTime();
  const endAt = new Date(range.endAt || 0).getTime();
  return Number.isFinite(timestamp) && Number.isFinite(startAt) && Number.isFinite(endAt)
    && startAt <= timestamp && timestamp < endAt;
}

function serializeDiagnosticJob(job) {
  const progress = job.progress && typeof job.progress === "object" ? job.progress : {};
  const range = getDiagnosticJobRange(job);
  return {
    id: job.id,
    jobType: job.jobType,
    status: job.status,
    rangeStartAt: range.startAt,
    rangeEndAt: range.endAt,
    errorCode: job.errorCode || null,
    errorMessage: job.errorMessage || null,
    counters: progress.counters && typeof progress.counters === "object" ? progress.counters : null,
    createdAt: job.createdAt || null,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
  };
}

function getOfficialInteraction(sourceRow, board, referenceByTweetId) {
  const officialTwitterId = String(board.officialTwitterId || "");
  if (!officialTwitterId) return false;
  const tweetAt = new Date(sourceRow.create_time || 0).getTime();
  const minimumReferenceAt = tweetAt - 30 * 24 * 60 * 60 * 1000;
  return [sourceRow.quote_id, sourceRow.reply_id].filter(Boolean).some((tweetId) => {
    const reference = referenceByTweetId.get(String(tweetId));
    if (!reference || String(reference.twitter_user_id || reference.author_id || "") !== officialTwitterId) return false;
    const referenceAt = new Date(reference.create_time || 0).getTime();
    return Number.isFinite(referenceAt) && referenceAt >= minimumReferenceAt;
  });
}

function analyzeBoardConfig(sourceRow, board, referenceByTweetId) {
  const text = `${normalizeTweetText(sourceRow.text)} ${sourceRow.text || ""}`;
  const matchedKeywords = collectMatchedKeywords(text, buildBoardKeywords(board));
  const matchedExcludeKeywords = collectMatchedKeywords(text, buildBoardRecallExcludeKeywords(board));
  // 与 scanCandidateTweetsForBoard 的 SQL 保持一致：排除账号匹配 dev.twitter_user.username。
  const authorHandle = normalizeTwitterHandle(sourceRow.author_username || sourceRow.author_username_raw);
  const authorExcluded = Boolean(authorHandle)
    && buildBoardRecallExcludeAuthorHandles(board).includes(authorHandle);
  const officialInteraction = getOfficialInteraction(sourceRow, board, referenceByTweetId);

  return {
    matchedKeywords,
    matchedExcludeKeywords,
    authorHandle,
    authorExcluded,
    officialInteraction,
    recallConditionMatched: matchedKeywords.length > 0 || officialInteraction,
  };
}

function resolveBoardDiagnosis(sourceRow, board, facts, jobs) {
  const coveringJobs = jobs
    .filter((job) => String(job.boardId) === String(board.id) && isDateWithinJobRange(sourceRow.create_time, job))
    .slice(0, 3);
  const jobRecords = coveringJobs.map(serializeDiagnosticJob);
  const base = {
    boardId: board.id,
    boardName: board.projectName || null,
    boardHandle: board.officialHandle || null,
    boardStatus: board.status,
    matchedKeywords: facts.matchedKeywords,
    matchedExcludeKeywords: facts.matchedExcludeKeywords,
    authorExcluded: facts.authorExcluded,
    officialInteraction: facts.officialInteraction,
    coverageStartAt: board.coverageStartAt || null,
    processedThrough: board.processedThrough || null,
    jobs: jobRecords,
  };

  if (sourceRow.retweet_id) {
    return { ...base, code: "retweet_excluded", severity: "info", label: "转推被排除", reason: "dev.tweet.retweet_id 有值，当前采集规则固定不召回转推。" };
  }
  if (facts.authorExcluded) {
    return { ...base, code: "author_excluded", severity: "warning", label: "作者被排除", reason: `作者 @${facts.authorHandle} 命中当前看板的召回排除账号。` };
  }
  if (facts.matchedExcludeKeywords.length) {
    return { ...base, code: "keyword_excluded", severity: "warning", label: "排除词命中", reason: `正文命中召回排除词：${facts.matchedExcludeKeywords.join("、")}。` };
  }
  if (!facts.recallConditionMatched) {
    return { ...base, code: "not_matched", severity: "default", label: "未满足召回", reason: "正文未命中当前关键词，且不是对该看板官方账号推文的引用或回复。" };
  }

  const activeJob = coveringJobs.find((job) => ["pending", "running"].includes(job.status));
  if (activeJob) {
    return { ...base, code: "job_in_progress", severity: "processing", label: "等待任务处理", reason: `当前配置满足召回，覆盖该时间的 ${activeJob.jobType} 任务仍在${activeJob.status === "pending" ? "排队" : "运行"}。` };
  }
  const latestCompletedJob = coveringJobs.find((job) => !["pending", "running"].includes(job.status));
  if (latestCompletedJob?.status === "succeeded") {
    return { ...base, code: "unexpected_missing", severity: "error", label: "疑似漏召回", reason: "当前配置满足召回，且存在已成功覆盖该时间的任务，但本地仍无记录。配置可能在任务完成后变更；也建议结合下方任务 counters 检查入库阶段。" };
  }
  if (latestCompletedJob?.status === "failed") {
    const errorDetail = latestCompletedJob.errorMessage || latestCompletedJob.errorCode;
    return { ...base, code: "covering_job_failed", severity: "error", label: "覆盖任务失败", reason: `当前配置满足召回，但最新一次覆盖该时间的任务失败${errorDetail ? `：${errorDetail}` : "。"}` };
  }
  if (latestCompletedJob?.status === "skipped") {
    const errorDetail = latestCompletedJob.errorMessage || latestCompletedJob.errorCode;
    return { ...base, code: "covering_job_skipped", severity: "warning", label: "覆盖任务已跳过", reason: `当前配置满足召回，但最新一次覆盖该时间的任务未实际执行${errorDetail ? `：${errorDetail}` : "。"}` };
  }
  if (latestCompletedJob?.status === "cancelled") {
    const errorDetail = latestCompletedJob.errorMessage || latestCompletedJob.errorCode;
    return { ...base, code: "covering_job_cancelled", severity: "warning", label: "覆盖任务已取消", reason: `当前配置满足召回，但最新一次覆盖该时间的任务已取消${errorDetail ? `：${errorDetail}` : "。"}` };
  }

  const tweetAt = new Date(sourceRow.create_time || 0).getTime();
  const coverageStartAt = new Date(board.coverageStartAt || 0).getTime();
  if (board.coverageStartAt && tweetAt < coverageStartAt) {
    return { ...base, code: "outside_coverage", severity: "warning", label: "尚未覆盖", reason: "当前配置满足召回，但推文发布时间早于看板 coverageStartAt。" };
  }
  const processedThroughAt = new Date(board.processedThrough || 0).getTime();
  if (board.processedThrough && tweetAt > processedThroughAt) {
    return { ...base, code: "not_scanned_yet", severity: "processing", label: "尚未扫描到", reason: "当前配置满足召回，但推文时间晚于看板 processedThrough。" };
  }
  if (board.status === "paused") {
    return { ...base, code: "board_paused", severity: "warning", label: "看板已暂停", reason: "当前配置满足召回，但看板处于暂停状态，且没有找到覆盖该时间的任务。" };
  }
  return { ...base, code: "no_covering_job", severity: "warning", label: "无覆盖任务", reason: "当前配置满足召回，但没有找到覆盖该推文时间的任务记录，可能尚未补数或相关任务记录已清理。" };
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

async function diagnoseTweetRecall({
  input,
  EchohuntSocialListeningPost,
  EchohuntSocialListeningBoard,
  EchohuntSocialListeningJob,
}) {
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

  const localTweetIds = new Set(localRows.map((row) => String(row.tweetId || "")).filter(Boolean));
  const missingSourceRows = sourceRows.filter((row) => !localTweetIds.has(String(row.id)));
  const retentionCutoffAt = Date.now() - 31 * 24 * 60 * 60 * 1000;
  const expiredSourceRows = missingSourceRows.filter((row) => {
    const tweetAt = new Date(row.create_time || 0).getTime();
    return Number.isFinite(tweetAt) && tweetAt < retentionCutoffAt;
  });
  const diagnosableSourceRows = missingSourceRows.filter((row) => !expiredSourceRows.includes(row));
  const localBoardIds = Array.from(new Set(localRows.map((row) => String(row.boardId || "")).filter(Boolean)));
  const needsMissingRecallDiagnosis = diagnosableSourceRows.length > 0;
  const boards = needsMissingRecallDiagnosis || localBoardIds.length
    ? await EchohuntSocialListeningBoard.findAll({
      where: needsMissingRecallDiagnosis
        ? { status: { [Op.ne]: "deleted" } }
        : { id: { [Op.in]: localBoardIds } },
      attributes: [
        "id",
        "projectName",
        "officialTwitterId",
        "officialHandle",
        "status",
        "coverageStartAt",
        "processedThrough",
        "metadata",
      ],
      order: [["createdAt", "ASC"], ["id", "ASC"]],
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

  const diagnosticsByTweetId = new Map();
  expiredSourceRows.forEach((sourceRow) => {
    diagnosticsByTweetId.set(String(sourceRow.id), {
      analyzedBoards: 0,
      matchingBoards: 0,
      eligibleBoards: 0,
      omittedUnmatchedBoards: 0,
      generalReason: "推文发布时间已超过 31 天，本地记录可能已按数据保留策略清理；当前未找到不代表当时没有召回。",
      boards: [],
    });
  });
  if (diagnosableSourceRows.length && boards.length) {
    const referenceTweetIds = Array.from(new Set(diagnosableSourceRows
      .flatMap((row) => [row.quote_id, row.reply_id])
      .map((tweetId) => String(tweetId || ""))
      .filter(Boolean)));
    const referenceRows = referenceTweetIds.length
      ? await fetchTweetRowsByIds(referenceTweetIds, referenceTweetIds.length)
      : [];
    const referenceByTweetId = new Map(referenceRows.map((row) => [String(row.id), row]));
    const factsByTweetId = new Map();
    const eligibleBoardIds = new Set();

    diagnosableSourceRows.forEach((sourceRow) => {
      const facts = boards.map((board) => {
        const config = analyzeBoardConfig(sourceRow, board, referenceByTweetId);
        if (config.recallConditionMatched && !config.authorExcluded && !config.matchedExcludeKeywords.length && !sourceRow.retweet_id) {
          eligibleBoardIds.add(String(board.id));
        }
        return { board, config };
      });
      factsByTweetId.set(String(sourceRow.id), facts);
    });

    const validTweetDates = diagnosableSourceRows
      .map((row) => new Date(row.create_time))
      .filter((date) => !Number.isNaN(date.getTime()));
    const earliestTweetAt = validTweetDates.length
      ? new Date(Math.min(...validTweetDates.map((date) => date.getTime())))
      : null;
    const latestManualJobAt = validTweetDates.length
      ? new Date(Math.min(
        Date.now(),
        Math.max(...validTweetDates.map((date) => date.getTime())) + 31 * 24 * 60 * 60 * 1000
      ))
      : null;
    const jobs = eligibleBoardIds.size && validTweetDates.length
      ? await EchohuntSocialListeningJob.findAll({
        where: {
          boardId: { [Op.in]: Array.from(eligibleBoardIds) },
          [Op.or]: [
            ...validTweetDates.map((date) => ({
              rangeStartAt: { [Op.lte]: date },
              rangeEndAt: { [Op.gt]: date },
            })),
            {
              jobType: "manual_refresh",
              rangeStartAt: null,
              rangeEndAt: null,
              createdAt: { [Op.between]: [earliestTweetAt, latestManualJobAt] },
            },
          ],
        },
        attributes: [
          "id",
          "boardId",
          "jobType",
          "status",
          "rangeStartAt",
          "rangeEndAt",
          "progress",
          "errorCode",
          "errorMessage",
          "createdAt",
          "startedAt",
          "finishedAt",
        ],
        order: [["createdAt", "DESC"]],
        limit: 500,
        raw: true,
      })
      : [];

    diagnosableSourceRows.forEach((sourceRow) => {
      const facts = factsByTweetId.get(String(sourceRow.id)) || [];
      // 排除词和排除作者只有在基础召回条件命中后才会真正影响 SQL 结果。
      // 仅展示命中基础条件的看板，避免把无关看板误报成“被排除”。
      const relevantFacts = facts.filter(({ config }) => config.recallConditionMatched);
      const diagnoses = relevantFacts.map(({ board, config }) => (
        resolveBoardDiagnosis(sourceRow, board, config, jobs)
      ));
      const matchingBoards = facts.filter(({ config }) => config.recallConditionMatched).length;
      const eligibleBoards = facts.filter(({ config }) => (
        config.recallConditionMatched
        && !config.authorExcluded
        && !config.matchedExcludeKeywords.length
        && !sourceRow.retweet_id
      )).length;
      const generalReason = sourceRow.retweet_id
        ? "这是一条转推，采集 SQL 会固定排除 retweet_id 非空的数据。"
        : matchingBoards === 0
          ? `已检查 ${boards.length} 个看板的当前配置：没有看板命中正文关键词，也没有识别为对官方账号推文的引用或回复。`
          : eligibleBoards === 0
            ? `有 ${matchingBoards} 个看板满足基础召回条件，但均被排除词或排除作者规则拦截。`
            : `有 ${eligibleBoards} 个看板按当前配置应该召回，已继续检查覆盖范围和任务执行记录。`;
      diagnosticsByTweetId.set(String(sourceRow.id), {
        analyzedBoards: boards.length,
        matchingBoards,
        eligibleBoards,
        omittedUnmatchedBoards: boards.length - relevantFacts.length,
        generalReason,
        boards: diagnoses,
      });
    });
  }

  const sourceByTweetId = new Map(sourceRows.map((row) => [String(row.id), serializeSourceTweet(row)]));
  const tweetIds = Array.from(new Set([...sourceByTweetId.keys(), ...localByTweetId.keys()]));
  const items = tweetIds.map((tweetId) => ({
    tweetId,
    source: sourceByTweetId.get(tweetId) || null,
    localMatches: localByTweetId.get(tweetId) || [],
    diagnostics: diagnosticsByTweetId.get(tweetId) || null,
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
