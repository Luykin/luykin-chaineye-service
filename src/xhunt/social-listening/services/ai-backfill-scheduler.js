const { Op } = require("sequelize");
const {
  EchohuntSocialListeningBoard,
  EchohuntSocialListeningPost,
} = require("../../../models/postgres-start");
const { BOARD_STATUSES } = require("../constants");
const {
  analyzePendingContentMetadata,
  analyzePendingProjectAttitudes,
  getBoardAiConfig,
} = require("./analysis-service");
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
    const content = await analyzePendingContentMetadata(board, {
      limit: workerConfig.contentBatchSize,
      concurrency: workerConfig.contentConcurrency,
      maxTextLength: workerConfig.maxTextLength,
    });
    const attitude = await analyzePendingProjectAttitudes(board, {
      limit: workerConfig.projectAttitudeBatchSize,
      concurrency: workerConfig.projectAttitudeConcurrency,
      maxTextLength: workerConfig.maxTextLength,
    });
    const durationMs = Date.now() - startedAt;
    console.log(
      `[SocialListeningAIWorker] board=${board.id} handle=${board.officialHandle} content=${content.analyzed || 0}/${content.selected || 0} contentFailed=${content.failed || 0} attitude=${attitude.analyzed || 0}/${attitude.selected || 0} attitudeFailed=${attitude.failed || 0} ms=${durationMs}`
    );
    return { skipped: false, content, attitude, durationMs };
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
      const pendingBoardRows = await EchohuntSocialListeningPost.findAll({
        attributes: ["boardId"],
        where: buildPendingAiPostWhere(),
        group: ["boardId"],
        raw: true,
        limit: Math.min(maxBoards * 20, 200),
      });
      const pendingBoardIds = pendingBoardRows.map((item) => item.boardId).filter(Boolean);
      const boards = pendingBoardIds.length ? await EchohuntSocialListeningBoard.findAll({
        where: { id: { [Op.in]: pendingBoardIds }, status: BOARD_STATUSES.MONITORING },
        order: [["updatedAt", "ASC"]],
      }) : [];
      for (const board of boards) {
        if (summary.processedBoards >= maxBoards) break;
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
