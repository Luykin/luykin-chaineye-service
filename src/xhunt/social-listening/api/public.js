const express = require("express");
const { Op, literal } = require("sequelize");
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
  serializeJob,
  serializePost,
  serializeAccountSignal,
  enrichSignalAvatars,
  normalizePage,
  parseTweetUrl,
} = require("../services/board-service");
const {
  normalizeRangeKey,
  getWindowForRange,
  enrichSnapshotMetricComparisons,
  appendDerivedNegativeContentAlert,
} = require("../services/aggregate-service");
const { buildPostWhere, buildPostOrder, exportPostsXlsx } = require("../services/export-service");
const { sendJsonError, publicError } = require("../services/errors");
const { buildTweetUrl } = require("../utils/twitter");

const router = express.Router();
router.use(authenticateAuthCenterToken());

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
    const enrichedSnapshot = await enrichSnapshotMetricComparisons(snapshot, board.id);
    res.set("Cache-Control", "private, max-age=30");
    return res.json({
      success: true,
      data: {
        board: await getBoardDetail(board.id, req.authCenter),
        rangeKey,
        state: snapshot ? "ready" : (board.status === "failed" ? "failed" : "processing"),
        snapshot: enrichedSnapshot || null,
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
    const where = applyExcludeOfficialAccount(
      { boardId: board.id, occurredAt: { [Op.gte]: window.windowStartAt, [Op.lt]: window.windowEndAt } },
      board
    );
    if (req.query.type) where.signalType = String(req.query.type);
    const q = String(req.query.q || "").trim();
    if (q) where[Op.or] = [{ handle: { [Op.iLike]: `%${q.replace(/^@+/, "")}%` } }, { name: { [Op.iLike]: `%${q}%` } }];
    const result = await EchohuntSocialListeningAccountSignal.findAndCountAll({ where, order: [["occurredAt", "DESC"]], offset, limit, raw: true });
    const rows = await enrichSignalAvatars(result.rows);
    return res.json({ success: true, data: { rangeKey, items: rows.map(serializeAccountSignal), page, pageSize, total: result.count } });
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
    const enrichedSignals = await enrichSignalAvatars(signals);
    return res.json({ success: true, data: { rangeKey, twitterId: req.params.twitterId, signals: enrichedSignals.map(serializeAccountSignal), posts: posts.map(serializePost) } });
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
    const where = applyExcludeSelfMentionAlerts({ boardId: board.id, triggeredAt: { [Op.gte]: window.windowStartAt } });
    if (req.query.type) where.alertType = String(req.query.type);
    const result = await EchohuntSocialListeningAlert.findAndCountAll({ where, order: [["triggeredAt", "DESC"]], offset, limit, raw: true });
    const derived = offset === 0
      ? await appendDerivedNegativeContentAlert(board, window, result.rows, { type: req.query.type })
      : { rows: result.rows, appended: false };
    return res.json({ success: true, data: { rangeKey, items: derived.rows.slice(0, limit), page, pageSize, total: result.count + (derived.appended ? 1 : 0) } });
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
