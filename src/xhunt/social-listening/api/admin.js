const express = require("express");
const { Op, literal } = require("sequelize");
const { requirePermission } = require("../../../admin/middleware/adminAuth");
const {
  EchohuntSocialListeningBoard,
  EchohuntSocialListeningBoardAccess,
  EchohuntSocialListeningJob,
  EchohuntSocialListeningPost,
  EchohuntSocialListeningSnapshot,
  EchohuntSocialListeningAccountSignal,
  EchohuntSocialListeningAlert,
  EchohuntSocialListeningAccessAuditLog,
} = require("../../../models/postgres-start");
const { SOCIAL_LISTENING_PERMISSION, BOARD_STATUSES } = require("../constants");
const {
  resolveMonitoredAccount,
  createMonitoredAccount,
  resumeBoard,
  listMonitoredAccounts,
  updateBoard,
  grantBoardAccess,
  revokeBoardAccess,
  getBoardDetail,
  createManualRefreshJob,
  serializeAccess,
  serializeJob,
  serializePost,
  serializeAccountSignal,
  enrichSignalAvatars,
  normalizePage,
  writeAudit,
} = require("../services/board-service");
const { normalizeRangeKey, getWindowForRange } = require("../services/aggregate-service");
const { buildPostWhere, buildPostOrder, exportPostsXlsx } = require("../services/export-service");
const { enableSocialListeningScheduler } = require("../services/scheduler");
const { sendJsonError, publicError } = require("../services/errors");

const router = express.Router();
router.use(requirePermission(SOCIAL_LISTENING_PERMISSION));

function getAdminId(req) {
  return req.adminUser?.id || null;
}

function normalizeAccountId(value) {
  return String(value || "").trim();
}

function normalizeHandle(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function applyExcludeOfficialAccount(where, board) {
  const clauses = [];
  const officialTwitterId = normalizeAccountId(board?.officialTwitterId);
  const officialHandle = normalizeHandle(board?.officialHandle);
  if (officialTwitterId) clauses.push({ twitterId: { [Op.ne]: officialTwitterId } });
  if (officialHandle) {
    clauses.push({
      [Op.or]: [
        { handle: null },
        { handle: { [Op.notILike]: officialHandle } },
      ],
    });
  }
  if (clauses.length) where[Op.and] = [...(where[Op.and] || []), ...clauses];
  return where;
}

function applyExcludeSelfMentionAlerts(where) {
  where[Op.and] = [
    ...(where[Op.and] || []),
    literal(`
      NOT (
        "EchohuntSocialListeningAlert"."alertType" = 'influential_mention'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE("EchohuntSocialListeningAlert"."evidenceTweetIds", '[]'::jsonb)) AS evidence(tweet_id)
          JOIN "EchohuntSocialListeningPosts" p
            ON p."boardId" = "EchohuntSocialListeningAlert"."boardId"
           AND p."tweetId" = evidence.tweet_id
          JOIN "EchohuntSocialListeningBoards" b
            ON b."id" = "EchohuntSocialListeningAlert"."boardId"
          WHERE (
            p."authorTwitterId" = b."officialTwitterId"
            OR lower(coalesce(p."authorHandle", '')) = lower(coalesce(b."officialHandle", ''))
          )
        )
      )
    `),
  ];
  return where;
}

router.get("/monitored-accounts", async (req, res) => {
  try {
    return res.json({ success: true, data: await listMonitoredAccounts(req.query) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_LIST_FAILED");
  }
});

router.post("/monitored-accounts/resolve", async (req, res) => {
  try {
    const data = await resolveMonitoredAccount(req.body?.handle || req.body?.officialHandle);
    return res.json({ success: true, data });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_RESOLVE_FAILED");
  }
});

router.post("/monitored-accounts", async (req, res) => {
  try {
    const result = await createMonitoredAccount(req.body || {}, getAdminId(req));
    return res.json({
      success: true,
      data: {
        board: await getBoardDetail(result.board.id),
        created: result.created,
        job: result.job ? serializeJob(result.job) : null,
      },
    });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_CREATE_FAILED");
  }
});

router.get("/monitored-accounts/:boardId", async (req, res) => {
  try {
    return res.json({ success: true, data: await getBoardDetail(req.params.boardId) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_DETAIL_FAILED");
  }
});

router.patch("/monitored-accounts/:boardId", async (req, res) => {
  try {
    const board = await updateBoard(req.params.boardId, req.body || {}, getAdminId(req));
    return res.json({ success: true, data: await getBoardDetail(board.id) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_UPDATE_FAILED");
  }
});

router.post("/boards/:boardId/pause", async (req, res) => {
  try {
    const board = await updateBoard(req.params.boardId, { status: BOARD_STATUSES.PAUSED }, getAdminId(req));
    await writeAudit({ boardId: board.id, adminId: getAdminId(req), action: "board_pause" });
    return res.json({ success: true, data: await getBoardDetail(board.id) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_PAUSE_FAILED");
  }
});

router.post("/boards/:boardId/resume", async (req, res) => {
  try {
    const result = await resumeBoard(req.params.boardId, getAdminId(req), req.redisClient);
    return res.json({
      success: true,
      data: {
        board: await getBoardDetail(result.board.id),
        job: serializeJob(result.job),
        reused: result.reused,
        firstActivation: result.firstActivation,
      },
    });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_RESUME_FAILED");
  }
});

router.delete("/boards/:boardId", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    await board.update({ status: BOARD_STATUSES.DELETED, updatedByAdminId: getAdminId(req) });
    await writeAudit({ boardId: board.id, adminId: getAdminId(req), action: "board_delete", targetTwitterHandle: board.officialHandle });
    return res.json({ success: true });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_DELETE_FAILED");
  }
});

router.post("/boards/:boardId/refresh", async (req, res) => {
  try {
    const result = await createManualRefreshJob(req.params.boardId, { type: "admin", adminId: getAdminId(req) }, req.redisClient);
    await enableSocialListeningScheduler(req.redisClient, { type: "admin", adminId: getAdminId(req) });
    return res.json({ success: true, data: { job: serializeJob(result.job), reused: result.reused } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_REFRESH_FAILED");
  }
});

router.get("/boards/:boardId/overview", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    const rangeKey = normalizeRangeKey(req.query.range);
    const snapshot = await EchohuntSocialListeningSnapshot.findOne({
      where: { boardId: board.id, rangeKey },
      order: [["generatedAt", "DESC"]],
      raw: true,
    });
    return res.json({
      success: true,
      data: {
        board: await getBoardDetail(board.id),
        rangeKey,
        state: snapshot ? "ready" : (board.status === "failed" ? "failed" : "processing"),
        snapshot: snapshot || null,
      },
    });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_OVERVIEW_FAILED");
  }
});

router.get("/boards/:boardId/posts", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const { where, rangeKey } = buildPostWhere(board.id, req.query);
    const result = await EchohuntSocialListeningPost.findAndCountAll({
      where,
      order: buildPostOrder(req.query.sort),
      offset,
      limit,
    });
    return res.json({ success: true, data: { rangeKey, items: result.rows.map(serializePost), page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_POSTS_FAILED");
  }
});

router.get("/boards/:boardId/posts/export", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    const result = await exportPostsXlsx(board, req.query, {
      type: "admin",
      adminId: getAdminId(req),
    }, req.redisClient);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(result.filename)}"`);
    return res.send(result.buffer);
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_EXPORT_FAILED");
  }
});

router.get("/boards/:boardId/accounts", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const rangeKey = normalizeRangeKey(req.query.range);
    const window = getWindowForRange(rangeKey);
    const where = applyExcludeOfficialAccount(
      { boardId: board.id, occurredAt: { [Op.gte]: window.windowStartAt, [Op.lt]: window.windowEndAt } },
      board
    );
    if (req.query.type) where.signalType = String(req.query.type);
    const result = await EchohuntSocialListeningAccountSignal.findAndCountAll({
      where,
      order: [["occurredAt", "DESC"]],
      offset,
      limit,
      raw: true,
    });
    const rows = await enrichSignalAvatars(result.rows);
    return res.json({ success: true, data: { rangeKey, items: rows.map(serializeAccountSignal), page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_SIGNALS_FAILED");
  }
});

router.get("/boards/:boardId/alerts", async (req, res) => {
  try {
    const board = await EchohuntSocialListeningBoard.findByPk(req.params.boardId);
    if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const rangeKey = normalizeRangeKey(req.query.range);
    const window = getWindowForRange(rangeKey);
    const where = applyExcludeSelfMentionAlerts({ boardId: board.id, triggeredAt: { [Op.gte]: window.windowStartAt } });
    if (req.query.type) where.alertType = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    const result = await EchohuntSocialListeningAlert.findAndCountAll({
      where,
      order: [["triggeredAt", "DESC"]],
      offset,
      limit,
      raw: true,
    });
    return res.json({ success: true, data: { rangeKey, items: result.rows, page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_BOARD_ALERTS_FAILED");
  }
});

router.get("/boards/:boardId/accesses", async (req, res) => {
  try {
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const where = { boardId: req.params.boardId };
    if (req.query.status) where.status = String(req.query.status);
    const result = await EchohuntSocialListeningBoardAccess.findAndCountAll({
      where,
      order: [["updatedAt", "DESC"]],
      offset,
      limit,
    });
    return res.json({ success: true, data: { items: result.rows.map(serializeAccess), page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_ACCESSES_FAILED");
  }
});

router.post("/boards/:boardId/accesses", async (req, res) => {
  try {
    const result = await grantBoardAccess(req.params.boardId, req.body || {}, getAdminId(req));
    return res.json({ success: true, data: { access: serializeAccess(result.access), created: result.created } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_GRANT_FAILED");
  }
});

router.delete("/boards/:boardId/accesses/:accessId", async (req, res) => {
  try {
    const access = await revokeBoardAccess(req.params.boardId, req.params.accessId, getAdminId(req));
    return res.json({ success: true, data: serializeAccess(access) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_REVOKE_FAILED");
  }
});

router.get("/jobs", async (req, res) => {
  try {
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const where = {};
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.boardId) where.boardId = String(req.query.boardId);
    if (req.query.jobType) where.jobType = String(req.query.jobType);
    const result = await EchohuntSocialListeningJob.findAndCountAll({ where, order: [["createdAt", "DESC"]], offset, limit });
    return res.json({ success: true, data: { items: result.rows.map(serializeJob), page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_JOBS_FAILED");
  }
});

router.get("/alerts", async (req, res) => {
  try {
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const where = applyExcludeSelfMentionAlerts({});
    if (req.query.boardId) where.boardId = String(req.query.boardId);
    if (req.query.type) where.alertType = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.severity) where.severity = String(req.query.severity);
    const result = await EchohuntSocialListeningAlert.findAndCountAll({
      where,
      order: [["triggeredAt", "DESC"]],
      offset,
      limit,
      raw: true,
    });
    return res.json({ success: true, data: { items: result.rows, page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_ALERTS_FAILED");
  }
});

router.get("/audit-logs", async (req, res) => {
  try {
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const where = {};
    if (req.query.boardId) where.boardId = String(req.query.boardId);
    if (req.query.action) where.action = String(req.query.action);
    if (req.query.adminId) where.adminId = Number(req.query.adminId);
    const result = await EchohuntSocialListeningAccessAuditLog.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      offset,
      limit,
      raw: true,
    });
    return res.json({ success: true, data: { items: result.rows, page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_AUDIT_FAILED");
  }
});

router.post("/jobs/:jobId/retry", async (req, res) => {
  try {
    const job = await EchohuntSocialListeningJob.findByPk(req.params.jobId);
    if (!job) throw publicError("JOB_NOT_FOUND", 404, "任务不存在。");
    const retry = await EchohuntSocialListeningJob.create({
      boardId: job.boardId,
      jobType: job.jobType,
      status: "pending",
      rangeStartAt: job.rangeStartAt,
      rangeEndAt: job.rangeEndAt,
      triggeredBy: "admin",
      triggeredByAdminId: getAdminId(req),
      metadata: { ...(job.metadata || {}), retryFromJobId: job.id },
    });
    await enableSocialListeningScheduler(req.redisClient, { type: "admin", adminId: getAdminId(req) });
    return res.json({ success: true, data: serializeJob(retry) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_JOB_RETRY_FAILED");
  }
});

module.exports = router;
