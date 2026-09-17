const { Op } = require("sequelize");
const {
  EchohuntSocialListeningBoard,
  EchohuntSocialListeningJob,
  EchohuntSocialListeningPost,
} = require("../../../models/postgres-start");
const { BOARD_STATUSES, JOB_STATUSES, JOB_TYPES } = require("../constants");
const {
  analyzePendingPostAi,
  getBoardAiConfig,
} = require("./analysis-service");
const {
  generateAggregateAlerts,
  generateSnapshotsForBoard,
  syncInfluentialSignalForPost,
} = require("./aggregate-service");
const { getSocialListeningRuntimeConfig } = require("./runtime-config");

const AI_WORKER_STATE_KEY = "echohunt:social-listening:ai-worker:state";
const AI_WORKER_LAST_RUN_KEY = "echohunt:social-listening:ai-worker:last-run";
const AI_WORKER_RUNNING_VALUE = "running";
const AI_WORKER_PAUSED_VALUE = "paused";
const AI_WORKER_ACTIVE_DELAY_MS = 10 * 1000;

function clampInteger(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getReanalyzeBatchSize(workerConfig) {
  return clampInteger(
    Math.max(workerConfig.contentBatchSize || 0, workerConfig.projectAttitudeBatchSize || 0),
    20,
    1,
    100
  );
}

function buildReanalyzeCounters(job) {
  return {
    total: Number(job.metadata?.totalPosts || 0),
    processed: 0,
    contentAiAnalyzed: 0,
    contentAiFailed: 0,
    aiAnalyzed: 0,
    aiFailed: 0,
    signalsSynced: 0,
    ...asObject(job.progress).counters,
  };
}

async function getAiWorkerConfig() {
  const config = await getSocialListeningRuntimeConfig();
  return config.aiWorker || {};
}

function buildPendingAiPostWhere() {
  return {
    text: { [Op.ne]: null },
    [Op.or]: [
      { tagStatus: null },
      { tagStatus: { [Op.in]: ["pending", "failed", "reused"] } },
      { summaryStatus: null },
      { summaryStatus: { [Op.in]: ["pending", "failed", "reused"] } },
      { attitudeStatus: null },
      { attitudeStatus: { [Op.in]: ["pending", "failed"] } },
      { aiSource: "dev_tweet_ai" },
    ],
  };
}

async function isConfigDisabled() {
  const config = await getAiWorkerConfig();
  return String(config.mode || "enabled").toLowerCase() === "disabled";
}

async function pauseSocialListeningAiWorker(redisClient, actor = {}) {
  if (!redisClient?.set) return { paused: false, reason: "redis_unavailable" };
  await redisClient.set(AI_WORKER_STATE_KEY, AI_WORKER_PAUSED_VALUE);
  await redisClient.set(`${AI_WORKER_STATE_KEY}:paused_at`, JSON.stringify({
    at: new Date().toISOString(),
    actorType: actor.type || "admin",
    adminId: actor.adminId || null,
  })).catch(() => null);
  return { paused: true };
}

async function resumeSocialListeningAiWorker(redisClient, actor = {}) {
  if (await isConfigDisabled()) return { enabled: false, reason: "nacos_disabled" };
  if (!redisClient?.set) return { enabled: false, reason: "redis_unavailable" };
  await redisClient.set(AI_WORKER_STATE_KEY, AI_WORKER_RUNNING_VALUE);
  await redisClient.set(`${AI_WORKER_STATE_KEY}:enabled_at`, JSON.stringify({
    at: new Date().toISOString(),
    actorType: actor.type || "admin",
    adminId: actor.adminId || null,
  })).catch(() => null);
  return { enabled: true };
}

async function getSocialListeningAiWorkerStatus(redisClient) {
  const config = await getAiWorkerConfig().catch(() => ({}));
  const redisState = await redisClient?.get?.(AI_WORKER_STATE_KEY).catch(() => null);
  const lastRunRaw = await redisClient?.get?.(AI_WORKER_LAST_RUN_KEY).catch(() => null);
  let lastRun = null;
  try {
    lastRun = lastRunRaw ? JSON.parse(lastRunRaw) : null;
  } catch (_) {
    lastRun = null;
  }
  const configDisabled = String(config.mode || "enabled").toLowerCase() === "disabled";
  const paused = configDisabled || redisState === AI_WORKER_PAUSED_VALUE;
  return {
    state: paused ? AI_WORKER_PAUSED_VALUE : AI_WORKER_RUNNING_VALUE,
    redisState: redisState || "default_running",
    configMode: config.mode || "enabled",
    paused,
    enabled: !paused,
    config,
    lastRun,
  };
}

function createSocialListeningAiWorker({ redisClient, tickIntervalMs } = {}) {
  const fallbackIntervalMs = tickIntervalMs || 60 * 1000;
  let timer = null;
  let ticking = false;
  let pausedLogged = false;

  async function isWorkerEnabled() {
    const status = await getSocialListeningAiWorkerStatus(redisClient);
    return status.enabled;
  }

  async function withBoardLock(boardId, fn) {
    const key = `echohunt:social-listening:job-lock:${boardId}`;
    if (!redisClient?.set) return fn();
    const locked = await redisClient.set(key, String(process.pid), { NX: true, EX: 30 * 60 }).catch(() => null);
    if (locked === null) return null;
    try {
      return await fn();
    } finally {
      await redisClient.del(key).catch(() => null);
    }
  }

  async function runBoardAi(board, workerConfig) {
    const aiConfig = await getBoardAiConfig(board);
    if (!aiConfig.contentEnabled && !aiConfig.projectAttitudeEnabled) {
      return { skipped: true, reason: "board_ai_disabled" };
    }
    const startedAt = Date.now();
    const result = await analyzePendingPostAi(board, {
      limit: Math.max(workerConfig.contentBatchSize || 0, workerConfig.projectAttitudeBatchSize || 0),
      concurrency: Math.max(workerConfig.contentConcurrency || 0, workerConfig.projectAttitudeConcurrency || 0),
      maxTextLength: workerConfig.maxTextLength,
    });
    const content = result.content || {};
    const attitude = result.attitude || {};
    const durationMs = Date.now() - startedAt;
    console.log(
      `[SocialListeningAIWorker] board=${board.id} handle=${board.officialHandle} content=${content.analyzed || 0}/${content.selected || 0} contentFailed=${content.failed || 0} attitude=${attitude.analyzed || 0}/${attitude.selected || 0} attitudeFailed=${attitude.failed || 0} ms=${durationMs}`
    );
    return { skipped: false, content, attitude, durationMs };
  }

  async function processReanalyzeJob(job, board, workerConfig) {
    const batchSize = getReanalyzeBatchSize(workerConfig);
    const progress = asObject(job.progress);
    const cursor = asObject(progress.cursor);
    const rangeStartAt = new Date(job.rangeStartAt);
    const rangeEndAt = new Date(job.rangeEndAt);
    const counters = buildReanalyzeCounters(job);
    const where = {
      boardId: board.id,
      text: { [Op.ne]: null },
      postCreatedAt: { [Op.gte]: rangeStartAt, [Op.lte]: rangeEndAt },
      // 固定本次任务创建时已有的数据，避免执行过程中新增的历史推文改变任务范围。
      createdAt: { [Op.lte]: job.createdAt },
    };
    if (cursor.postCreatedAt && cursor.id) {
      const cursorAt = new Date(cursor.postCreatedAt);
      where[Op.or] = [
        { postCreatedAt: { [Op.gt]: cursorAt } },
        { postCreatedAt: cursorAt, id: { [Op.gt]: cursor.id } },
      ];
    }

    try {
      await job.update({
        status: JOB_STATUSES.RUNNING,
        startedAt: job.startedAt || new Date(),
        progress: {
          ...progress,
          stage: "manual_range_reanalyze",
          phase: "reanalyzing",
          statusMessage: `正在按当前提示词重新分析第 ${counters.processed + 1} 条起的推文。`,
          counters,
          heartbeatAt: new Date().toISOString(),
        },
      });
      const posts = await EchohuntSocialListeningPost.findAll({
        attributes: ["id", "postCreatedAt"],
        where,
        order: [["postCreatedAt", "ASC"], ["id", "ASC"]],
        limit: batchSize,
        raw: true,
      });
      if (!posts.length) {
        await generateAggregateAlerts(board);
        await generateSnapshotsForBoard(await EchohuntSocialListeningBoard.findByPk(board.id));
        await job.update({
          status: JOB_STATUSES.SUCCEEDED,
          finishedAt: new Date(),
          errorCode: null,
          errorMessage: null,
          progress: {
            ...progress,
            stage: "succeeded",
            phase: "succeeded",
            statusMessage: `AI 重分析完成，已处理 ${counters.processed} 条推文。`,
            counters,
            heartbeatAt: new Date().toISOString(),
          },
        });
        return { processed: true, completed: true };
      }

      const result = await analyzePendingPostAi(board, {
        force: true,
        postIds: posts.map((post) => post.id),
        limit: posts.length,
        concurrency: Math.max(workerConfig.contentConcurrency || 0, workerConfig.projectAttitudeConcurrency || 0),
        maxTextLength: workerConfig.maxTextLength,
      });
      if (!result.enabled) {
        const error = new Error("当前看板的综合 AI 未开启或模型配置不完整，无法重跑。");
        error.code = "BOARD_AI_DISABLED";
        throw error;
      }

      const refreshedPosts = await EchohuntSocialListeningPost.findAll({ where: { id: { [Op.in]: posts.map((post) => post.id) } } });
      for (const post of refreshedPosts) {
        const signalResult = await syncInfluentialSignalForPost(board, post);
        if (signalResult?.synced) counters.signalsSynced += 1;
      }
      counters.processed += posts.length;
      counters.contentAiAnalyzed += Number(result.content?.analyzed || 0);
      counters.contentAiFailed += Number(result.content?.failed || 0);
      counters.aiAnalyzed += Number(result.attitude?.analyzed || 0);
      counters.aiFailed += Number(result.attitude?.failed || 0);
      const lastPost = posts[posts.length - 1];
      await job.update({
        // 每批完成后重新排队：AI Worker 暂停时不会把这条长任务误判为超时失败。
        status: JOB_STATUSES.PENDING,
        progress: {
          ...progress,
          stage: "manual_range_reanalyze",
          phase: "queued_next_batch",
          statusMessage: `已完成 ${counters.processed}/${counters.total || "?"} 条，等待下一批。`,
          cursor: { postCreatedAt: new Date(lastPost.postCreatedAt).toISOString(), id: lastPost.id },
          counters,
          heartbeatAt: new Date().toISOString(),
        },
      });
      return { processed: true, completed: false };
    } catch (error) {
      await job.update({
        status: JOB_STATUSES.FAILED,
        finishedAt: new Date(),
        errorCode: error.code || "REANALYZE_FAILED",
        errorMessage: String(error.publicMessage || error.message || error).slice(0, 2000),
        progress: {
          ...progress,
          stage: "failed",
          phase: "failed",
          statusMessage: "批量 AI 重分析失败，可在执行过程里查看错误后重试。",
          counters,
          heartbeatAt: new Date().toISOString(),
        },
      }).catch(() => null);
      console.error(`[SocialListeningAIWorker] reanalyze job failed id=${job.id} board=${board.id}:`, error.message || error);
      return { processed: true, completed: true, failed: true };
    }
  }

  async function processPendingReanalyzeJob(workerConfig) {
    const job = await EchohuntSocialListeningJob.findOne({
      where: { jobType: JOB_TYPES.REANALYZE, status: JOB_STATUSES.PENDING },
      order: [["createdAt", "ASC"]],
    });
    if (!job) return { processed: false };
    const board = await EchohuntSocialListeningBoard.findByPk(job.boardId);
    if (!board || board.status !== BOARD_STATUSES.MONITORING) {
      await job.update({
        status: JOB_STATUSES.SKIPPED,
        finishedAt: new Date(),
        errorCode: "BOARD_NOT_AVAILABLE",
        errorMessage: "看板不存在或已不处于监控中，批量 AI 重分析未执行。",
      });
      return { processed: true, completed: true };
    }
    const result = await withBoardLock(board.id, () => processReanalyzeJob(job, board, workerConfig));
    return result || { processed: false };
  }

  async function tick() {
    if (!await isWorkerEnabled()) {
      if (!pausedLogged) {
        console.warn("[SocialListeningAIWorker] paused; use admin AI worker resume to process pending AI posts.");
        pausedLogged = true;
      }
      return { processedBoards: 0, skippedBoards: 0 };
    }
    pausedLogged = false;
    if (ticking) return { processing: true };
    ticking = true;
    const startedAt = Date.now();
    const summary = {
      processedBoards: 0,
      skippedBoards: 0,
      contentSelected: 0,
      contentAnalyzed: 0,
      contentFailed: 0,
      attitudeSelected: 0,
      attitudeAnalyzed: 0,
      attitudeFailed: 0,
    };
    try {
      const workerConfig = await getAiWorkerConfig();
      const maxBoards = clampInteger(workerConfig.maxBoardsPerTick, 3, 1, 20);
      const reanalyzeResult = await processPendingReanalyzeJob(workerConfig);
      const availableBoardSlots = Math.max(0, maxBoards - (reanalyzeResult.processed ? 1 : 0));
      if (!availableBoardSlots) {
        summary.reanalyzeProcessed = Boolean(reanalyzeResult.processed);
        summary.reanalyzeCompleted = Boolean(reanalyzeResult.completed);
        summary.durationMs = Date.now() - startedAt;
        summary.finishedAt = new Date().toISOString();
        await redisClient?.set?.(AI_WORKER_LAST_RUN_KEY, JSON.stringify(summary), { EX: 7 * 24 * 60 * 60 }).catch(() => null);
        return summary;
      }
      const pendingBoardRows = await EchohuntSocialListeningPost.findAll({
        attributes: ["boardId"],
        where: buildPendingAiPostWhere(),
        group: ["boardId"],
        raw: true,
        limit: Math.min(availableBoardSlots * 20, 200),
      });
      const pendingBoardIds = pendingBoardRows.map((item) => item.boardId).filter(Boolean);
      const boards = pendingBoardIds.length ? await EchohuntSocialListeningBoard.findAll({
        where: { id: { [Op.in]: pendingBoardIds }, status: BOARD_STATUSES.MONITORING },
        order: [["updatedAt", "ASC"]],
      }) : [];
      for (const board of boards) {
        if (summary.processedBoards >= availableBoardSlots) break;
        const result = await withBoardLock(board.id, () => runBoardAi(board, workerConfig));
        if (!result) {
          summary.skippedBoards += 1;
          continue;
        }
        if (result.skipped) {
          summary.skippedBoards += 1;
          continue;
        }
        const contentSelected = result.content?.selected || 0;
        const attitudeSelected = result.attitude?.selected || 0;
        if (!contentSelected && !attitudeSelected) {
          summary.skippedBoards += 1;
          continue;
        }
        summary.processedBoards += 1;
        summary.contentSelected += contentSelected;
        summary.contentAnalyzed += result.content?.analyzed || 0;
        summary.contentFailed += result.content?.failed || 0;
        summary.attitudeSelected += attitudeSelected;
        summary.attitudeAnalyzed += result.attitude?.analyzed || 0;
        summary.attitudeFailed += result.attitude?.failed || 0;
      }
      summary.durationMs = Date.now() - startedAt;
      summary.finishedAt = new Date().toISOString();
      summary.reanalyzeProcessed = Boolean(reanalyzeResult.processed);
      summary.reanalyzeCompleted = Boolean(reanalyzeResult.completed);
      await redisClient?.set?.(AI_WORKER_LAST_RUN_KEY, JSON.stringify(summary), { EX: 7 * 24 * 60 * 60 }).catch(() => null);
      if (summary.processedBoards || summary.skippedBoards || summary.contentAnalyzed || summary.attitudeAnalyzed) {
        console.log(`[SocialListeningAIWorker] tick ${JSON.stringify(summary)}`);
      }
      return summary;
    } catch (error) {
      const failed = { ...summary, durationMs: Date.now() - startedAt, finishedAt: new Date().toISOString(), error: String(error.message || error).slice(0, 1000) };
      await redisClient?.set?.(AI_WORKER_LAST_RUN_KEY, JSON.stringify(failed), { EX: 7 * 24 * 60 * 60 }).catch(() => null);
      console.error("[SocialListeningAIWorker] tick failed:", error.message || error);
      return failed;
    } finally {
      ticking = false;
    }
  }

  async function getIdleTickIntervalMs() {
    const config = await getAiWorkerConfig().catch(() => ({}));
    return Math.max(Number(config.tickIntervalMs || fallbackIntervalMs), 10 * 1000);
  }

  function hasSelectedWork(summary = {}) {
    return (
      Number(summary.contentSelected || 0) > 0 ||
      Number(summary.attitudeSelected || 0) > 0 ||
      Number(summary.contentAnalyzed || 0) > 0 ||
      Number(summary.contentFailed || 0) > 0 ||
      Number(summary.attitudeAnalyzed || 0) > 0 ||
      Number(summary.attitudeFailed || 0) > 0
    );
  }

  async function getNextDelayMs(summary) {
    if (hasSelectedWork(summary)) return AI_WORKER_ACTIVE_DELAY_MS;
    return getIdleTickIntervalMs();
  }

  function scheduleNext(delayMs) {
    timer = setTimeout(async () => {
      const result = await tick();
      if (!timer) return;
      scheduleNext(await getNextDelayMs(result));
    }, Math.max(delayMs, 1000));
    timer.unref?.();
  }

  function start() {
    if (timer) return { enabled: true, alreadyStarted: true };
    scheduleNext(8000);
    console.log(`[SocialListeningAIWorker] started defaultIntervalMs=${fallbackIntervalMs}, configSource=nacos, defaultState=running_unless_paused`);
    return { enabled: true };
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { start, stop, tick };
}

module.exports = {
  AI_WORKER_STATE_KEY,
  createSocialListeningAiWorker,
  getSocialListeningAiWorkerStatus,
  pauseSocialListeningAiWorker,
  resumeSocialListeningAiWorker,
};
