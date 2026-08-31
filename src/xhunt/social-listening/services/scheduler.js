const { Op } = require("sequelize");
const {
  EchohuntSocialListeningBoard,
  EchohuntSocialListeningJob,
} = require("../../../models/postgres-start");
const { BOARD_STATUSES, JOB_STATUSES, JOB_TYPES } = require("../constants");
const { processSocialListeningJob, recoverStaleRunningJobs, getIncrementalRange } = require("./ingest-service");

function createSocialListeningScheduler({ redisClient, tickIntervalMs } = {}) {
  const intervalMs = Number(tickIntervalMs || process.env.SOCIAL_LISTENING_TICK_INTERVAL_MS || 60 * 1000);
  const enabled = process.env.SOCIAL_LISTENING_SCHEDULER_ENABLED !== "false";
  let timer = null;
  let ticking = false;

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

  async function enqueueDueIncrementalJobs() {
    const now = new Date();
    const dueBefore = new Date(now.getTime() - 15 * 60 * 1000);
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
      const range = getIncrementalRange(board, now);
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

  async function processPendingJobs() {
    const maxJobs = Number(process.env.SOCIAL_LISTENING_MAX_JOBS_PER_TICK || 3);
    const jobs = await EchohuntSocialListeningJob.findAll({
      where: { status: JOB_STATUSES.PENDING },
      order: [["createdAt", "ASC"]],
      limit: Math.max(1, Math.min(maxJobs, 10)),
    });

    let processed = 0;
    for (const job of jobs) {
      const result = await withBoardLock(job.boardId, async () => {
        await processSocialListeningJob(job.id);
        return true;
      });
      if (result) processed += 1;
    }
    return processed;
  }

  async function tick() {
    if (!enabled) return;
    if (ticking) return;
    ticking = true;
    try {
      const recovered = await recoverStaleRunningJobs().catch((error) => {
        console.warn("[SocialListeningScheduler] recover stale jobs failed:", error.message);
        return 0;
      });
      const enqueued = await enqueueDueIncrementalJobs();
      const processed = await processPendingJobs();
      if (recovered || enqueued || processed) {
        console.log(`[SocialListeningScheduler] tick recovered=${recovered} enqueued=${enqueued} processed=${processed}`);
      }
    } catch (error) {
      console.error("[SocialListeningScheduler] tick failed:", error.message || error);
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (!enabled) {
      console.warn("[SocialListeningScheduler] disabled by SOCIAL_LISTENING_SCHEDULER_ENABLED=false");
      return { enabled: false };
    }
    if (timer) return { enabled: true, alreadyStarted: true };
    timer = setInterval(tick, Math.max(intervalMs, 10 * 1000));
    timer.unref?.();
    setTimeout(tick, 5000).unref?.();
    console.log(`[SocialListeningScheduler] started intervalMs=${intervalMs}`);
    return { enabled: true };
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick, enqueueDueIncrementalJobs, processPendingJobs };
}

module.exports = { createSocialListeningScheduler };
