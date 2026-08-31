const express = require("express");
const { Op } = require("sequelize");
const { authenticateAuthCenterToken } = require("../../auth-center/middleware/auth");
const {
  EchohuntSocialListeningPost,
  EchohuntSocialListeningSnapshot,
  EchohuntSocialListeningAccountSignal,
  EchohuntSocialListeningAlert,
  EchohuntSocialListeningKeyEvent,
} = require("../../../models/postgres-start");
const {
  getAccessSummary,
  listAccessibleBoards,
  assertBoardAccess,
  getBoardDetail,
  createManualRefreshJob,
  serializeBoard,
  serializeJob,
  serializePost,
  normalizePage,
  parseTweetUrl,
} = require("../services/board-service");
const { normalizeRangeKey, getWindowForRange } = require("../services/aggregate-service");
const { buildPostWhere, buildPostOrder, exportPostsXlsx } = require("../services/export-service");
const { sendJsonError, publicError } = require("../services/errors");
const { buildTweetUrl } = require("../utils/twitter");

const router = express.Router();
router.use(authenticateAuthCenterToken());

router.get("/me/access-summary", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: await getAccessSummary(req.authCenter) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ACCESS_SUMMARY_FAILED");
  }
});

router.get("/boards", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: await listAccessibleBoards(req.authCenter) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_BOARDS_FAILED");
  }
});

router.get("/boards/:boardId", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: await getBoardDetail(req.params.boardId, req.authCenter) });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_BOARD_FAILED");
  }
});

router.get("/boards/:boardId/overview", async (req, res) => {
  try {
    const { board } = await assertBoardAccess(req.authCenter, req.params.boardId);
    const rangeKey = normalizeRangeKey(req.query.range);
    const snapshot = await EchohuntSocialListeningSnapshot.findOne({
      where: { boardId: board.id, rangeKey },
      order: [["generatedAt", "DESC"]],
      raw: true,
    });
    res.set("Cache-Control", "private, max-age=30");
    return res.json({
      success: true,
      data: {
        board: serializeBoard(board),
        rangeKey,
        state: snapshot ? "ready" : (board.status === "failed" ? "failed" : "processing"),
        snapshot: snapshot || null,
      },
    });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_OVERVIEW_FAILED");
  }
});

router.get("/boards/:boardId/posts", async (req, res) => {
  try {
    const { board } = await assertBoardAccess(req.authCenter, req.params.boardId);
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const { where, rangeKey } = buildPostWhere(board.id, req.query);
    const result = await EchohuntSocialListeningPost.findAndCountAll({
      where,
      order: buildPostOrder(req.query.sort),
      offset,
      limit,
    });
    res.set("Cache-Control", "private, max-age=30");
    return res.json({
      success: true,
      data: {
        rangeKey,
        items: result.rows.map(serializePost),
        page,
        pageSize,
        total: result.count,
      },
    });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_POSTS_FAILED");
  }
});

router.get("/boards/:boardId/posts/export", async (req, res) => {
  try {
    const { board } = await assertBoardAccess(req.authCenter, req.params.boardId);
    const result = await exportPostsXlsx(board, req.query, {
      type: "user",
      authCenterUserId: req.authCenter.user.id,
    }, req.redisClient);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(result.filename)}"`);
    return res.send(result.buffer);
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_EXPORT_FAILED");
  }
});

router.post("/boards/:boardId/refresh", async (req, res) => {
  try {
    await assertBoardAccess(req.authCenter, req.params.boardId);
    const { job, reused } = await createManualRefreshJob(req.params.boardId, {
      type: "user",
      authCenterUserId: req.authCenter.user.id,
    }, req.redisClient);
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: { job: serializeJob(job), reused } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_REFRESH_FAILED");
  }
});

router.get("/boards/:boardId/accounts", async (req, res) => {
  try {
    const { board } = await assertBoardAccess(req.authCenter, req.params.boardId);
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const rangeKey = normalizeRangeKey(req.query.range);
    const window = getWindowForRange(rangeKey);
    const where = { boardId: board.id, occurredAt: { [Op.gte]: window.windowStartAt, [Op.lt]: window.windowEndAt } };
    if (req.query.type) where.signalType = String(req.query.type);
    const q = String(req.query.q || "").trim();
    if (q) where[Op.or] = [{ handle: { [Op.iLike]: `%${q.replace(/^@+/, "")}%` } }, { name: { [Op.iLike]: `%${q}%` } }];
    const result = await EchohuntSocialListeningAccountSignal.findAndCountAll({ where, order: [["occurredAt", "DESC"]], offset, limit, raw: true });
    return res.json({ success: true, data: { rangeKey, items: result.rows, page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ACCOUNTS_FAILED");
  }
});

router.get("/boards/:boardId/accounts/:twitterId", async (req, res) => {
  try {
    const { board } = await assertBoardAccess(req.authCenter, req.params.boardId);
    const rangeKey = normalizeRangeKey(req.query.range);
    const window = getWindowForRange(rangeKey);
    const [signals, posts] = await Promise.all([
      EchohuntSocialListeningAccountSignal.findAll({ where: { boardId: board.id, twitterId: req.params.twitterId, occurredAt: { [Op.gte]: window.windowStartAt } }, order: [["occurredAt", "DESC"]], limit: 50, raw: true }),
      EchohuntSocialListeningPost.findAll({ where: { boardId: board.id, authorTwitterId: req.params.twitterId, postCreatedAt: { [Op.gte]: window.windowStartAt } }, order: [["postCreatedAt", "DESC"]], limit: 50 }),
    ]);
    return res.json({ success: true, data: { rangeKey, twitterId: req.params.twitterId, signals, posts: posts.map(serializePost) } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ACCOUNT_DETAIL_FAILED");
  }
});

router.get("/boards/:boardId/alerts", async (req, res) => {
  try {
    const { board } = await assertBoardAccess(req.authCenter, req.params.boardId);
    const { page, pageSize, offset, limit } = normalizePage(req.query);
    const rangeKey = normalizeRangeKey(req.query.range);
    const window = getWindowForRange(rangeKey);
    const where = { boardId: board.id, triggeredAt: { [Op.gte]: window.windowStartAt } };
    if (req.query.type) where.alertType = String(req.query.type);
    const result = await EchohuntSocialListeningAlert.findAndCountAll({ where, order: [["triggeredAt", "DESC"]], offset, limit, raw: true });
    return res.json({ success: true, data: { rangeKey, items: result.rows, page, pageSize, total: result.count } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ALERTS_FAILED");
  }
});

router.get("/boards/:boardId/alerts/:alertId", async (req, res) => {
  try {
    const { board } = await assertBoardAccess(req.authCenter, req.params.boardId);
    const alert = await EchohuntSocialListeningAlert.findOne({ where: { id: req.params.alertId, boardId: board.id }, raw: true });
    if (!alert) throw publicError("ALERT_NOT_FOUND", 404, "预警不存在。");
    return res.json({ success: true, data: alert });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_ALERT_FAILED");
  }
});

router.get("/boards/:boardId/events", async (req, res) => {
  try {
    const { board } = await assertBoardAccess(req.authCenter, req.params.boardId);
    const rangeKey = normalizeRangeKey(req.query.range);
    const window = getWindowForRange(rangeKey);
    const items = await EchohuntSocialListeningKeyEvent.findAll({
      where: { boardId: board.id, authCenterUserId: req.authCenter.user.id, eventAt: { [Op.gte]: window.windowStartAt } },
      order: [["eventAt", "DESC"]],
      raw: true,
    });
    return res.json({ success: true, data: { rangeKey, items } });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_EVENTS_FAILED");
  }
});

router.post("/boards/:boardId/events", async (req, res) => {
  try {
    const { board } = await assertBoardAccess(req.authCenter, req.params.boardId);
    const parsed = parseTweetUrl(req.body?.tweetUrl || req.body?.tweetId);
    if (!parsed?.tweetId) throw publicError("INVALID_TWEET_URL", 400, "请输入合法的 X 帖子链接。")
    const relatedPost = await EchohuntSocialListeningPost.findOne({ where: { boardId: board.id, tweetId: parsed.tweetId }, raw: true });
    const event = await EchohuntSocialListeningKeyEvent.create({
      boardId: board.id,
      authCenterUserId: req.authCenter.user.id,
      xhuntUserId: req.authCenter.user.xhuntUserId || null,
      tweetUrl: parsed.url || buildTweetUrl(parsed.handle || relatedPost?.authorHandle, parsed.tweetId),
      tweetId: parsed.tweetId,
      eventType: String(req.body?.eventType || "custom").slice(0, 64),
      title: req.body?.title ? String(req.body.title).slice(0, 255) : null,
      authorTwitterId: relatedPost?.authorTwitterId || null,
      authorHandle: relatedPost?.authorHandle || parsed.handle || null,
      authorName: relatedPost?.authorName || null,
      authorAvatar: relatedPost?.authorAvatar || null,
      authorGlobalRank: relatedPost?.authorGlobalRank || null,
      eventAt: relatedPost?.postCreatedAt || new Date(),
      metadata: { note: req.body?.note || null },
    });
    return res.json({ success: true, data: event });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_EVENT_CREATE_FAILED");
  }
});

router.patch("/boards/:boardId/events/:eventId", async (req, res) => {
  try {
    await assertBoardAccess(req.authCenter, req.params.boardId);
    const event = await EchohuntSocialListeningKeyEvent.findOne({ where: { id: req.params.eventId, boardId: req.params.boardId, authCenterUserId: req.authCenter.user.id } });
    if (!event) throw publicError("EVENT_NOT_FOUND", 404, "关键事件不存在。")
    await event.update({
      eventType: req.body?.eventType ? String(req.body.eventType).slice(0, 64) : event.eventType,
      title: req.body?.title !== undefined ? String(req.body.title || "").slice(0, 255) || null : event.title,
      metadata: { ...(event.metadata || {}), note: req.body?.note !== undefined ? req.body.note : event.metadata?.note },
    });
    return res.json({ success: true, data: event });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_EVENT_UPDATE_FAILED");
  }
});

router.delete("/boards/:boardId/events/:eventId", async (req, res) => {
  try {
    await assertBoardAccess(req.authCenter, req.params.boardId);
    const count = await EchohuntSocialListeningKeyEvent.destroy({ where: { id: req.params.eventId, boardId: req.params.boardId, authCenterUserId: req.authCenter.user.id } });
    if (!count) throw publicError("EVENT_NOT_FOUND", 404, "关键事件不存在。")
    return res.json({ success: true });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_EVENT_DELETE_FAILED");
  }
});

module.exports = router;
