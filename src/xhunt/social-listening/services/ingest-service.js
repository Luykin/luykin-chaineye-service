const { Op } = require("sequelize");
const {
  EchohuntSocialListeningBoard,
  EchohuntSocialListeningJob,
  EchohuntSocialListeningPost,
} = require("../../../models/postgres-start");
const { BOARD_STATUSES, JOB_STATUSES, JOB_TYPES } = require("../constants");
const {
  fetchCandidateTweetsForBoard,
  mapTweetRowToPostPayload,
} = require("./data-source");
const {
  generateSnapshotsForBoard,
  generateInfluentialSignals,
  generateFollowSignals,
  generateAggregateAlerts,
} = require("./aggregate-service");
const { analyzePendingProjectAttitudes, analyzePendingContentMetadata } = require("./analysis-service");

const DEFAULT_WINDOW_MINUTES = Number(process.env.SOCIAL_LISTENING_WINDOW_MINUTES || 60);
const DEFAULT_HISTORY_DAYS = Number(process.env.SOCIAL_LISTENING_HISTORY_DAYS || 30);
const DEFAULT_RECENT_DAYS = Number(process.env.SOCIAL_LISTENING_RECENT_DAYS || 7);
const DEFAULT_OVERLAP_HOURS = Number(process.env.SOCIAL_LISTENING_INCREMENTAL_OVERLAP_HOURS || 2);

function clampPositiveInteger(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min) return fallback;
  return Math.min(Math.floor(num), max);
}

function addHours(date, hours) {
  return new Date(new Date(date).getTime() + hours * 60 * 60 * 1000);
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);
}

function getHistoryRange(stage, now = new Date()) {
  if (stage === "older_to_30d") {
    return { startAt: addDays(now, -DEFAULT_HISTORY_DAYS), endAt: addDays(now, -DEFAULT_RECENT_DAYS) };
  }
  return { startAt: addDays(now, -DEFAULT_RECENT_DAYS), endAt: now };
}

function getIncrementalRange(board, now = new Date()) {
  const overlapHours = clampPositiveInteger(DEFAULT_OVERLAP_HOURS, 2, 1, 24);
  const fallbackStart = addHours(now, -overlapHours);
  const processedThrough = board.processedThrough ? new Date(board.processedThrough) : fallbackStart;
  const startAt = new Date(Math.min(addHours(processedThrough, -overlapHours).getTime(), fallbackStart.getTime()));
  return { startAt, endAt: now };
}

function getJobRange(board, job) {
  if (job.rangeStartAt && job.rangeEndAt) {
    return { startAt: new Date(job.rangeStartAt), endAt: new Date(job.rangeEndAt) };
  }
  if (job.jobType === JOB_TYPES.HISTORY_BACKFILL) {
    return getHistoryRange(job.metadata?.stage || "recent_7d");
  }
  return getIncrementalRange(board);
}

function splitWindows(startAt, endAt, windowMinutes = DEFAULT_WINDOW_MINUTES) {
  const minutes = clampPositiveInteger(windowMinutes, 60, 15, 240);
  const output = [];
  let cursor = new Date(startAt);
  const end = new Date(endAt);
  while (cursor < end) {
    const next = new Date(Math.min(cursor.getTime() + minutes * 60 * 1000, end.getTime()));
    output.push({ startAt: cursor, endAt: next });
    cursor = next;
  }
  return output;
}

async function upsertPostPayloads(payloads) {
  if (!payloads.length) return 0;
  await EchohuntSocialListeningPost.bulkCreate(payloads, {
    updateOnDuplicate: [
      "authorHandle",
      "authorName",
      "authorAvatar",
      "authorFollowersCount",
      "authorGlobalRank",
      "authorCnRank",
      "authorIsCn",
      "text",
      "normalizedText",
      "source",
      "viewsCount",
      "likesCount",
      "repostsCount",
      "quotesCount",
      "repliesCount",
      "rawAuthor",
      "updatedAt",
    ],
  });
  return payloads.length;
}

async function processWindow(board, window) {
  const rows = await fetchCandidateTweetsForBoard(board, window.startAt, window.endAt);
  const payloads = rows.map((row) => mapTweetRowToPostPayload(board, row));
  const upserted = await upsertPostPayloads(payloads);
  return { scanned: rows.length, upserted };
}

async function markJobRunning(job) {
  return job.update({
    status: JOB_STATUSES.RUNNING,
    startedAt: new Date(),
    progress: { ...(job.progress || {}), stage: "running", heartbeatAt: new Date().toISOString() },
  });
}

async function markJobSucceeded(job, progress = {}) {
  return job.update({
    status: JOB_STATUSES.SUCCEEDED,
    finishedAt: new Date(),
    progress: { ...(job.progress || {}), ...progress, stage: "succeeded", heartbeatAt: new Date().toISOString() },
    errorCode: null,
    errorMessage: null,
  });
}

async function markJobFailed(job, error, progress = {}) {
  return job.update({
    status: JOB_STATUSES.FAILED,
    finishedAt: new Date(),
    progress: { ...(job.progress || {}), ...progress, stage: "failed", heartbeatAt: new Date().toISOString() },
    errorCode: error.code || error.message || "JOB_FAILED",
    errorMessage: String(error.publicMessage || error.message || error).slice(0, 2000),
  });
}

async function processSocialListeningJob(jobId) {
  const job = await EchohuntSocialListeningJob.findByPk(jobId);
  if (!job) throw new Error("SOCIAL_LISTENING_JOB_NOT_FOUND");
  if (![JOB_STATUSES.PENDING, JOB_STATUSES.RUNNING].includes(job.status)) return job;

  const board = await EchohuntSocialListeningBoard.findByPk(job.boardId);
  if (!board || [BOARD_STATUSES.DELETED, BOARD_STATUSES.DELETING].includes(board.status)) {
    await job.update({ status: JOB_STATUSES.SKIPPED, finishedAt: new Date(), errorCode: "BOARD_NOT_AVAILABLE" });
    return job;
  }
  if (board.status === BOARD_STATUSES.PAUSED) {
    await job.update({
      status: JOB_STATUSES.SKIPPED,
      finishedAt: new Date(),
      errorCode: "BOARD_PAUSED",
      errorMessage: "看板已暂停，任务不会自动执行。",
    });
    return job;
  }

  await markJobRunning(job);
  const counters = { scanned: 0, upserted: 0, windows: 0 };
  try {
    const range = getJobRange(board, job);
    const windows = splitWindows(range.startAt, range.endAt);
    for (const [index, window] of windows.entries()) {
      const result = await processWindow(board, window);
      counters.scanned += result.scanned;
      counters.upserted += result.upserted;
      counters.windows += 1;
      await job.update({
        progress: {
          ...(job.progress || {}),
          stage: job.metadata?.stage || job.jobType,
          currentWindow: { startAt: window.startAt.toISOString(), endAt: window.endAt.toISOString() },
          windowIndex: index + 1,
          windowTotal: windows.length,
          counters,
          heartbeatAt: new Date().toISOString(),
        },
      });
    }

    const nextCoverageStartAt = board.coverageStartAt
      ? new Date(Math.min(new Date(board.coverageStartAt).getTime(), range.startAt.getTime()))
      : range.startAt;
    const nextStatus = board.status === BOARD_STATUSES.INITIALIZING ? BOARD_STATUSES.MONITORING : board.status;
    await board.update({
      status: nextStatus,
      coverageStartAt: nextCoverageStartAt,
      processedThrough: range.endAt,
      lastSuccessAt: new Date(),
      lastFailureReason: null,
    });

    const contentAiResult = await analyzePendingContentMetadata(board, { limit: job.jobType === JOB_TYPES.HISTORY_BACKFILL ? 10 : 30 });
    counters.contentAiAnalyzed = contentAiResult.analyzed || 0;
    counters.contentAiFailed = contentAiResult.failed || 0;
    counters.contentAiSkipped = contentAiResult.skipped || 0;
    counters.contentAiEnabled = !!contentAiResult.enabled;

    const aiResult = await analyzePendingProjectAttitudes(board, { limit: job.jobType === JOB_TYPES.HISTORY_BACKFILL ? 20 : 50 });
    counters.aiAnalyzed = aiResult.analyzed || 0;
    counters.aiFailed = aiResult.failed || 0;
    counters.aiEnabled = !!aiResult.enabled;

    counters.influentialSignals = await generateInfluentialSignals(board, { since: range.startAt, until: range.endAt });
    counters.followSignals = await generateFollowSignals(board, { since: range.startAt, until: range.endAt });
    counters.aggregateAlerts = await generateAggregateAlerts(board);
    await generateSnapshotsForBoard(await EchohuntSocialListeningBoard.findByPk(board.id));
    await markJobSucceeded(job, { counters });

    if (job.jobType === JOB_TYPES.HISTORY_BACKFILL && (job.metadata?.stage || "recent_7d") === "recent_7d") {
      const olderRange = getHistoryRange("older_to_30d");
      await EchohuntSocialListeningJob.create({
        boardId: board.id,
        jobType: JOB_TYPES.HISTORY_BACKFILL,
        status: JOB_STATUSES.PENDING,
        rangeStartAt: olderRange.startAt,
        rangeEndAt: olderRange.endAt,
        triggeredBy: "system",
        metadata: { stage: "older_to_30d", parentJobId: job.id },
      });
    }

    return job;
  } catch (error) {
    await board.update({
      status: board.status === BOARD_STATUSES.INITIALIZING ? BOARD_STATUSES.FAILED : board.status,
      lastFailureAt: new Date(),
      lastFailureReason: String(error.publicMessage || error.message || error).slice(0, 2000),
    }).catch(() => null);
    await markJobFailed(job, error, { counters });
    throw error;
  }
}

async function recoverStaleRunningJobs(options = {}) {
  const staleMinutes = clampPositiveInteger(options.staleMinutes || 60, 60, 15, 24 * 60);
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  const [count] = await EchohuntSocialListeningJob.update(
    {
      status: JOB_STATUSES.FAILED,
      finishedAt: new Date(),
      errorCode: "STALE_RUNNING_JOB",
      errorMessage: "任务运行超时，已由调度器恢复为失败状态",
    },
    {
      where: {
        status: JOB_STATUSES.RUNNING,
        updatedAt: { [Op.lt]: cutoff },
      },
    }
  );
  return count;
}

module.exports = {
  processSocialListeningJob,
  recoverStaleRunningJobs,
  getIncrementalRange,
  getHistoryRange,
};
