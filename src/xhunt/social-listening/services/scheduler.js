const { Op } = require("sequelize");
const { randomUUID } = require("crypto");
const {
  EchohuntSocialListeningBoard,
  EchohuntSocialListeningJob,
} = require("../../../models/postgres-start");
const { BOARD_STATUSES, JOB_STATUSES, JOB_TYPES } = require("../constants");
const { processSocialListeningJob, recoverStaleRunningJobs, getIncrementalRange } = require("./ingest-service");
const { getSocialListeningRuntimeConfig } = require("./runtime-config");
const { findNextMetricRefreshCandidate, getMetricRefreshConfig } = require("./metric-refresh-service");

const SCHEDULER_STATE_KEY = "echohunt:social-listening:scheduler:state";
const SCHEDULER_ENABLED_VALUE = "running";
const GLOBAL_JOB_LOCK_KEY = "echohunt:social-listening:job-execution-lock";
// 全局锁在任务存活时会续期；进程重启时两类锁最多阻塞一个较短的恢复窗口。
const GLOBAL_JOB_LOCK_TTL_SECONDS = 5 * 60;
const BOARD_JOB_LOCK_TTL_SECONDS = 5 * 60;
const RENEW_LOCK_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) end return 0";
const RELEASE_LOCK_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

function formatSchedulerError(error) {
  if (!error || typeof error !== "object") return String(error);
  const stack = error.stack
    ? String(error.stack).split("\n").slice(0, 8).map((line) => line.trim()).join(" | ")
    : "";
  return [
    `name=${error.name || "-"}`,
    `code=${error.code || "-"}`,
    `message=${String(error.publicMessage || error.message || error).slice(0, 1200)}`,
    stack ? `stack=${stack}` : "",
  ].filter(Boolean).join(" ");
}

async function getSchedulerMode() {
  const config = await getSocialListeningRuntimeConfig();
  return config.scheduler?.mode || "default";
}

async function isForceDisabled() {
  return await getSchedulerMode() === "disabled";
}

async function isForceEnabled() {
  return await getSchedulerMode() === "enabled";
}

async function enableSocialListeningScheduler(redisClient, actor = {}) {
  if (await isForceDisabled()) return { enabled: false, reason: "nacos_disabled" };
  if (!redisClient?.set) return { enabled: false, reason: "redis_unavailable" };
  await redisClient.set(SCHEDULER_STATE_KEY, SCHEDULER_ENABLED_VALUE);
  await redisClient.set(`${SCHEDULER_STATE_KEY}:enabled_at`, JSON.stringify({
    at: new Date().toISOString(),
    actorType: actor.type || "admin",
    adminId: actor.adminId || null,
  })).catch(() => null);
  return { enabled: true };
}

function createSocialListeningScheduler({ redisClient, tickIntervalMs } = {}) {
  const fallbackIntervalMs = tickIntervalMs || 60 * 1000;
  let timer = null;
  let ticking = false;
  let pausedLogged = false;

  async function isSchedulerEnabled() {
    if (await isForceDisabled()) return false;
    if (await isForceEnabled()) return true;
    const state = await redisClient?.get?.(SCHEDULER_STATE_KEY).catch(() => null);
    return state === SCHEDULER_ENABLED_VALUE;
  }

  async function withBoardLock(boardId, fn) {
    const key = `echohunt:social-listening:job-lock:${boardId}`;
    if (!redisClient?.set) return fn();
    const locked = await redisClient.set(key, String(process.pid), { NX: true, EX: BOARD_JOB_LOCK_TTL_SECONDS }).catch(() => null);
    if (locked === null) return null;
    try {
      return await fn();
    } finally {
      await redisClient.del(key).catch(() => null);
    }
  }

  async function withGlobalJobLock(fn) {
    if (!redisClient?.set) return fn();
    const lockToken = `${process.pid}:${randomUUID()}`;
    const locked = await redisClient.set(GLOBAL_JOB_LOCK_KEY, lockToken, { NX: true, EX: GLOBAL_JOB_LOCK_TTL_SECONDS }).catch(() => null);
    if (locked === null) return null;
    const renewalTimer = setInterval(() => {
      redisClient.eval(RENEW_LOCK_LUA, {
        keys: [GLOBAL_JOB_LOCK_KEY],
        arguments: [lockToken, String(GLOBAL_JOB_LOCK_TTL_SECONDS)],
      }).catch(() => null);
    }, GLOBAL_JOB_LOCK_TTL_SECONDS * 500);
    renewalTimer.unref?.();
    try {
      return await fn();
    } finally {
      clearInterval(renewalTimer);
      await redisClient.eval(RELEASE_LOCK_LUA, {
        keys: [GLOBAL_JOB_LOCK_KEY],
        arguments: [lockToken],
      }).catch(() => null);
    }
  }

  async function enqueueDueIncrementalJobs() {
    const now = new Date();
    const runtimeConfig = await getSocialListeningRuntimeConfig();
    const incrementalIntervalMinutes = runtimeConfig.scheduler?.incrementalIntervalMinutes || 15;
    const dueBefore = new Date(now.getTime() - incrementalIntervalMinutes * 60 * 1000);
    const boards = await EchohuntSocialListeningBoard.findAll({
      where: {
        status: BOARD_STATUSES.MONITORING,
        [Op.or]: [
          { processedThrough: null },
          { processedThrough: { [Op.lt]: dueBefore } },
        ],
      },
      order: [["updatedAt", "ASC"]],
      limit: 10,
    }).catch(async () => EchohuntSocialListeningBoard.findAll({
      where: { status: BOARD_STATUSES.MONITORING },
      order: [["updatedAt", "ASC"]],
      limit: 10,
    }));

    let created = 0;
    for (const board of boards) {
      const existing = await EchohuntSocialListeningJob.findOne({
        where: { boardId: board.id, status: { [Op.in]: [JOB_STATUSES.PENDING, JOB_STATUSES.RUNNING] } },
      });
      if (existing) continue;
      const range = await getIncrementalRange(board, now);
      await EchohuntSocialListeningJob.create({
        boardId: board.id,
        jobType: JOB_TYPES.INCREMENTAL,
        status: JOB_STATUSES.PENDING,
        rangeStartAt: range.startAt,
        rangeEndAt: range.endAt,
        triggeredBy: "system",
        metadata: { source: "scheduler" },
      });
      created += 1;
    }
    return created;
  }

  async function enqueueDueMetricRefreshJobs() {
    const now = new Date();
    const runtimeConfig = await getSocialListeningRuntimeConfig();
    const config = getMetricRefreshConfig(runtimeConfig);
    if (config.mode === "disabled") return 0;
    const existing = await EchohuntSocialListeningJob.findOne({
      where: { jobType: JOB_TYPES.METRIC_REFRESH, status: { [Op.in]: [JOB_STATUSES.PENDING, JOB_STATUSES.RUNNING] } },
      attributes: ["id"],
    });
    if (existing) return 0;
    const latest = await EchohuntSocialListeningJob.findOne({
      where: { jobType: JOB_TYPES.METRIC_REFRESH },
      order: [["createdAt", "DESC"]],
      attributes: ["createdAt"],
    });
    if (latest?.createdAt && now.getTime() - new Date(latest.createdAt).getTime() < config.tickIntervalMinutes * 60 * 1000) return 0;
    const boards = await EchohuntSocialListeningBoard.findAll({
      where: { status: BOARD_STATUSES.MONITORING },
      order: [["updatedAt", "ASC"]],
      limit: 100,
    });
    const availableBoards = boards.slice();
    let created = 0;
    while (availableBoards.length && created < config.maxBatchesPerTick) {
      const next = await findNextMetricRefreshCandidate(availableBoards, runtimeConfig, now);
      if (!next) break;
      await EchohuntSocialListeningJob.create({
        boardId: next.board.id,
        jobType: JOB_TYPES.METRIC_REFRESH,
        status: JOB_STATUSES.PENDING,
        triggeredBy: "system",
        metadata: {
          source: "metric_refresh_scheduler",
          priority: next.candidate.metricRefreshPriority,
          tier: next.candidate.metricRefreshTier,
        },
      });
      created += 1;
      const index = availableBoards.findIndex((board) => board.id === next.board.id);
      if (index >= 0) availableBoards.splice(index, 1);
    }
    return created;
  }

  async function processPendingJobs() {
    return (await withGlobalJobLock(async () => {
      const runtimeConfig = await getSocialListeningRuntimeConfig();
      const maxJobs = Number(runtimeConfig.scheduler?.maxJobsPerTick || 3);
      const jobs = await EchohuntSocialListeningJob.findAll({
        where: { status: JOB_STATUSES.PENDING },
        order: [["createdAt", "ASC"]],
        limit: Math.max(1, Math.min(maxJobs, 10)),
      });

      let processed = 0;
      for (const job of jobs) {
        const result = await withBoardLock(job.boardId, async () => {
          try {
            await processSocialListeningJob(job.id);
          } catch (error) {
            console.error(`[SocialListeningScheduler] job failed id=${job.id} board=${job.boardId} type=${job.jobType}:`, formatSchedulerError(error));
            throw error;
          }
          return true;
        });
        if (result) processed += 1;
      }
      return processed;
    })) || 0;
  }

  async function tick() {
    const enabled = await isSchedulerEnabled();
    if (!enabled) {
      if (!pausedLogged) {
        console.warn("[SocialListeningScheduler] paused by default; resume a board in admin to enable scheduled processing.");
        pausedLogged = true;
      }
      return;
    }
    pausedLogged = false;
    if (ticking) return;
    ticking = true;
    try {
      const recovered = await recoverStaleRunningJobs().catch((error) => {
        console.warn("[SocialListeningScheduler] recover stale jobs failed:", formatSchedulerError(error));
        return 0;
      });
      const enqueued = await enqueueDueIncrementalJobs();
      const metricRefreshEnqueued = await enqueueDueMetricRefreshJobs();
      const processed = await processPendingJobs();
      if (recovered || enqueued || metricRefreshEnqueued || processed) {
        console.log(`[SocialListeningScheduler] tick recovered=${recovered} enqueued=${enqueued} metricRefreshEnqueued=${metricRefreshEnqueued} processed=${processed}`);
      }
    } catch (error) {
      console.error("[SocialListeningScheduler] tick failed:", formatSchedulerError(error));
    } finally {
      ticking = false;
    }
  }

  async function getNextTickIntervalMs() {
    const config = await getSocialListeningRuntimeConfig().catch(() => null);
    return Math.max(Number(config?.scheduler?.tickIntervalMs || fallbackIntervalMs), 10 * 1000);
  }

  function scheduleNext(delayMs) {
    timer = setTimeout(async () => {
      await tick();
      if (!timer) return;
      scheduleNext(await getNextTickIntervalMs());
    }, Math.max(delayMs, 1000));
    timer.unref?.();
  }

  function start() {
    if (timer) return { enabled: true, alreadyStarted: true };
    scheduleNext(5000);
    console.log(`[SocialListeningScheduler] started defaultIntervalMs=${fallbackIntervalMs}, configSource=nacos, defaultState=nacos_or_redis`);
    return { enabled: true };
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { start, stop, tick, enqueueDueIncrementalJobs, enqueueDueMetricRefreshJobs, processPendingJobs };
}

module.exports = {
  SCHEDULER_STATE_KEY,
  createSocialListeningScheduler,
  enableSocialListeningScheduler,
};
