const express = require("express");
const { Op } = require("sequelize");
const { requirePermission } = require("../../../admin/middleware/adminAuth");
const {
  EchohuntSocialListeningBoard,
  EchohuntSocialListeningBoardAccess,
  EchohuntSocialListeningJob,
} = require("../../../models/postgres-start");
const { SOCIAL_LISTENING_PERMISSION, BOARD_STATUSES } = require("../constants");
const {
  resolveMonitoredAccount,
  createMonitoredAccount,
  listMonitoredAccounts,
  updateBoard,
  grantBoardAccess,
  revokeBoardAccess,
  getBoardDetail,
  createManualRefreshJob,
  serializeAccess,
  serializeJob,
  normalizePage,
  writeAudit,
} = require("../services/board-service");
const { sendJsonError, publicError } = require("../services/errors");

const router = express.Router();
router.use(requirePermission(SOCIAL_LISTENING_PERMISSION));

function getAdminId(req) {
  return req.adminUser?.id || null;
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
    const board = await updateBoard(req.params.boardId, { status: BOARD_STATUSES.MONITORING }, getAdminId(req));
    const refresh = await createManualRefreshJob(board.id, { type: "admin", adminId: getAdminId(req) }, req.redisClient);
    await writeAudit({ boardId: board.id, adminId: getAdminId(req), action: "board_resume" });
    return res.json({ success: true, data: { board: await getBoardDetail(board.id), job: serializeJob(refresh.job), reused: refresh.reused } });
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
    return res.json({ success: true, data: { job: serializeJob(result.job), reused: result.reused } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_REFRESH_FAILED");
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
    return res.json({ success: true, data: serializeJob(retry) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ADMIN_JOB_RETRY_FAILED");
  }
});

module.exports = router;
