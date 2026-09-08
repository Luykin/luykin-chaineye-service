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
const { getSocialListeningRuntimeConfig } = require("./runtime-config");
const { refreshBoardMetrics } = require("./metric-refresh-service");

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

async function getHistoryRange(stage, now = new Date()) {
  const config = await getSocialListeningRuntimeConfig();
  const historyDays = clampPositiveInteger(config.scan?.historyDays, 30, 1, 90);
  const recentDays = clampPositiveInteger(config.scan?.recentDays, 7, 1, 30);
  if (stage === "older_to_30d") {
    return { startAt: addDays(now, -historyDays), endAt: addDays(now, -recentDays) };
  }
  return { startAt: addDays(now, -recentDays), endAt: now };
}

async function getIncrementalRange(board, now = new Date()) {
  const config = await getSocialListeningRuntimeConfig();
  const overlapHours = clampPositiveInteger(config.scan?.incrementalOverlapHours, 2, 1, 24);
  const fallbackStart = addHours(now, -overlapHours);
  const processedThrough = board.processedThrough ? new Date(board.processedThrough) : fallbackStart;
  const startAt = new Date(Math.min(addHours(processedThrough, -overlapHours).getTime(), fallbackStart.getTime()));
  return { startAt, endAt: now };
}

async function getJobRange(board, job) {
  if (job.rangeStartAt && job.rangeEndAt) {
    return { startAt: new Date(job.rangeStartAt), endAt: new Date(job.rangeEndAt) };
  }
  if (job.jobType === JOB_TYPES.HISTORY_BACKFILL) {
    return getHistoryRange(job.metadata?.stage || "recent_7d");
  }
  return getIncrementalRange(board);
}

function splitWindows(startAt, endAt, windowMinutes = 30) {
  const minutes = clampPositiveInteger(windowMinutes, 30, 5, 240);
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

function asProgressObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getJobStage(job) {
  return job?.metadata?.stage || job?.jobType || "running";
}

function serializeWindow(window, extras = {}) {
  if (!window) return null;
  return {
    startAt: new Date(window.startAt).toISOString(),
    endAt: new Date(window.endAt).toISOString(),
    ...extras,
  };
}

async function updateJobProgress(job, progress = {}) {
  return job.update({
    progress: {
      ...asProgressObject(job.progress),
      ...progress,
      heartbeatAt: new Date().toISOString(),
    },
  });
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
  const scanMeta = rows.scanMeta || null;
  const payloads = rows.map((row) => mapTweetRowToPostPayload(board, row));
  const upserted = await upsertPostPayloads(payloads);
  return { scanned: rows.length, upserted, scanMeta };
}

async function markJobRunning(job) {
  return job.update({
    status: JOB_STATUSES.RUNNING,
    startedAt: new Date(),
    progress: {
      ...asProgressObject(job.progress),
      stage: getJobStage(job),
      phase: "starting",
      statusMessage: "任务已领取，正在计算扫描范围。",
      heartbeatAt: new Date().toISOString(),
    },
  });
}

async function markJobSucceeded(job, progress = {}) {
  return job.update({
    status: JOB_STATUSES.SUCCEEDED,
    finishedAt: new Date(),
    progress: {
      ...asProgressObject(job.progress),
      ...progress,
      stage: "succeeded",
      phase: progress.phase || "succeeded",
      statusMessage: progress.statusMessage || "任务已完成。",
      heartbeatAt: new Date().toISOString(),
    },
    errorCode: null,
    errorMessage: null,
  });
}

async function markJobFailed(job, error, progress = {}) {
  const errorMessage = String(error.publicMessage || error.message || error).slice(0, 2000);
  return job.update({
    status: JOB_STATUSES.FAILED,
    finishedAt: new Date(),
    progress: {
      ...asProgressObject(job.progress),
      ...progress,
      stage: "failed",
      phase: progress.phase || "failed",
      statusMessage: progress.statusMessage || "任务执行失败，可查看错误信息或重试。",
      heartbeatAt: new Date().toISOString(),
    },
    errorCode: error.code || error.message || "JOB_FAILED",
    errorMessage,
  });
}

async function processMetricRefreshJob(job, board) {
  const runtimeConfig = await getSocialListeningRuntimeConfig();
  const counters = await refreshBoardMetrics(board, runtimeConfig);
  if (counters.enabled && counters.selected) {
    await generateAggregateAlerts(board);
    await generateSnapshotsForBoard(await EchohuntSocialListeningBoard.findByPk(board.id));
  }
  await markJobSucceeded(job, {
    counters,
    phase: "metric_refresh_succeeded",
    statusMessage: counters.selected
      ? `互动指标回刷完成：更新 ${counters.updated || 0} 条，源库未命中 ${counters.missing || 0} 条。`
      : "没有到期的互动指标需要回刷。",
  });
  return job;
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
  if (job.jobType === JOB_TYPES.METRIC_REFRESH) {
    try {
      return await processMetricRefreshJob(job, board);
    } catch (error) {
      await markJobFailed(job, error, { counters: {} });
      throw error;
    }
  }
  const counters = { scanned: 0, upserted: 0, windows: 0 };
  try {
    const runtimeConfig = await getSocialListeningRuntimeConfig();
    const range = await getJobRange(board, job);
    const windows = splitWindows(range.startAt, range.endAt, runtimeConfig.scan?.windowMinutes);
    const stage = getJobStage(job);
    await updateJobProgress(job, {
      stage,
      phase: windows.length ? "prepared" : "no_windows",
      statusMessage: windows.length
        ? `已拆分 ${windows.length} 个时间窗口，准备开始扫描。`
        : "当前范围没有需要扫描的时间窗口，将直接更新游标和聚合数据。",
      range: { startAt: range.startAt.toISOString(), endAt: range.endAt.toISOString() },
      currentWindow: serializeWindow(windows[0], { status: "pending" }),
      windowIndex: 0,
      activeWindowIndex: windows.length ? 1 : 0,
      windowTotal: windows.length,
      counters,
    });
    for (const [index, window] of windows.entries()) {
      const activeWindowIndex = index + 1;
      const windowStartedAt = new Date();
      await updateJobProgress(job, {
        stage,
        phase: "scanning",
        statusMessage: `正在扫描第 ${activeWindowIndex}/${windows.length} 个时间窗口。`,
        currentWindow: serializeWindow(window, { status: "running", startedAt: windowStartedAt.toISOString() }),
        windowIndex: index,
        activeWindowIndex,
        windowTotal: windows.length,
        counters,
      });
      const result = await processWindow(board, window);
      counters.scanned += result.scanned;
      counters.upserted += result.upserted;
      counters.windows += 1;
      if (result.scanMeta) {
        counters.scanPageSize = result.scanMeta.pageSize;
        counters.maxScanPages = result.scanMeta.maxPages;
        counters.candidatePagesScanned = (counters.candidatePagesScanned || 0) + result.scanMeta.pagesScanned;
        counters.candidateRowsScanned = (counters.candidateRowsScanned || 0) + result.scanMeta.candidatesScanned;
        counters.candidateScanBudget = (counters.candidateScanBudget || 0) + result.scanMeta.scanLimit;
      }
      await updateJobProgress(job, {
        stage,
        phase: activeWindowIndex >= windows.length ? "scan_finished" : "scanning",
        statusMessage: `已完成第 ${activeWindowIndex}/${windows.length} 个时间窗口。`,
        currentWindow: serializeWindow(window, {
          status: "finished",
          startedAt: windowStartedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          scanMeta: result.scanMeta || undefined,
        }),
        windowIndex: activeWindowIndex,
        activeWindowIndex,
        windowTotal: windows.length,
        counters,
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

    await updateJobProgress(job, {
      stage,
      phase: "aggregating",
      statusMessage: "扫描入库完成，正在生成关键账号信号、关注关系信号和聚合预警。",
      windowIndex: windows.length,
      activeWindowIndex: windows.length,
      windowTotal: windows.length,
      counters,
    });
    counters.contentAiAnalyzed = 0;
    counters.contentAiFailed = 0;
    counters.contentAiSkipped = 0;
    counters.contentAiEnabled = false;
    counters.contentAiMode = "ai_worker";
    counters.aiAnalyzed = 0;
    counters.aiFailed = 0;
    counters.aiEnabled = false;
    counters.aiMode = "ai_worker";

    counters.influentialSignals = await generateInfluentialSignals(board, { since: range.startAt, until: range.endAt });
    await updateJobProgress(job, {
      stage,
      phase: "aggregating",
      statusMessage: "关键账号信号已生成，正在生成关注关系信号。",
      windowIndex: windows.length,
      activeWindowIndex: windows.length,
      windowTotal: windows.length,
      counters,
    });
    counters.followSignals = await generateFollowSignals(board, { since: range.startAt, until: range.endAt });
    await updateJobProgress(job, {
      stage,
      phase: "aggregating",
      statusMessage: "关注关系信号已生成，正在生成聚合预警。",
      windowIndex: windows.length,
      activeWindowIndex: windows.length,
      windowTotal: windows.length,
      counters,
    });
    counters.aggregateAlerts = await generateAggregateAlerts(board);
    await updateJobProgress(job, {
      stage,
      phase: "snapshotting",
      statusMessage: "聚合预警已生成，正在刷新看板快照。",
      windowIndex: windows.length,
      activeWindowIndex: windows.length,
      windowTotal: windows.length,
      counters,
    });
    await generateSnapshotsForBoard(await EchohuntSocialListeningBoard.findByPk(board.id));
    await markJobSucceeded(job, {
      counters,
      windowIndex: windows.length,
      activeWindowIndex: windows.length,
      windowTotal: windows.length,
      phase: "succeeded",
      statusMessage: "任务已完成。",
    });

    if (job.jobType === JOB_TYPES.HISTORY_BACKFILL && (job.metadata?.stage || "recent_7d") === "recent_7d") {
      const olderRange = await getHistoryRange("older_to_30d");
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
  const runtimeConfig = await getSocialListeningRuntimeConfig();
  const staleMinutes = clampPositiveInteger(options.staleMinutes || runtimeConfig.scheduler?.staleRunningMinutes, 15, 10, 15);
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  const staleJobs = await EchohuntSocialListeningJob.findAll({
    where: {
      status: JOB_STATUSES.RUNNING,
      updatedAt: { [Op.lt]: cutoff },
    },
    order: [["updatedAt", "ASC"]],
    limit: 100,
  });
  const recoveredAt = new Date();
  for (const staleJob of staleJobs) {
    const currentProgress = asProgressObject(staleJob.progress);
    const lastHeartbeatAt = currentProgress.heartbeatAt
      || currentProgress.lastHeartbeatAt
      || (staleJob.updatedAt ? new Date(staleJob.updatedAt).toISOString() : undefined);
    await staleJob.update({
      status: JOB_STATUSES.FAILED,
      finishedAt: recoveredAt,
      errorCode: "STALE_RUNNING_JOB",
      errorMessage: "任务运行超时，已由调度器恢复为失败状态",
      progress: {
        ...currentProgress,
        previousStage: currentProgress.stage,
        stage: "failed",
        phase: "stale_recovered",
        statusMessage: "任务心跳超时，已自动标记失败；可手动重试，或等待下一轮增量任务。",
        lastHeartbeatAt,
        staleDetectedAt: recoveredAt.toISOString(),
        staleAfterMinutes: staleMinutes,
      },
    });
  }
  return staleJobs.length;
}

module.exports = {
  processSocialListeningJob,
  recoverStaleRunningJobs,
  getIncrementalRange,
  getHistoryRange,
};
