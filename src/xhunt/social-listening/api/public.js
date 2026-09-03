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
  buildSnapshotPayload,
  EFFECTIVE_SENTIMENTS,
  appendDerivedNegativeContentAlert,
} = require("../services/aggregate-service");
const { buildPostWhere, buildPostOrder, exportPostsXlsx } = require("../services/export-service");
const { sendJsonError, publicError } = require("../services/errors");
const { buildTweetUrl } = require("../utils/twitter");
const {
  mapTweetRowToPostPayload,
  fetchTweetRowById,
  fetchTweetSnapshotFromCrawler,
} = require("../services/data-source");

const router = express.Router();
router.use(authenticateAuthCenterToken());

function normalizeAccountId(value) {
  return String(value || "").trim();
}

function normalizeHandle(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function getEffectiveSentimentSqlList() {
  return EFFECTIVE_SENTIMENTS.map((item) => `'${String(item).replace(/'/g, "''")}'`).join(", ");
}

function applyExcludeUnknownMentionSignals(where) {
  where[Op.and] = [
    ...(where[Op.and] || []),
    {
      [Op.or]: [
        { signalType: { [Op.ne]: "influential_mention" } },
        { sentiment: { [Op.in]: EFFECTIVE_SENTIMENTS } },
      ],
    },
  ];
  return where;
}

function applyExcludeUnknownMentionAlerts(where) {
  where[Op.and] = [
    ...(where[Op.and] || []),
    literal(`
      NOT (
        "EchohuntSocialListeningAlert"."alertType" = 'influential_mention'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE("EchohuntSocialListeningAlert"."evidenceTweetIds", '[]'::jsonb)) AS evidence(tweet_id)
          JOIN "EchohuntSocialListeningPosts" p
            ON p."boardId" = "EchohuntSocialListeningAlert"."boardId"
           AND p."tweetId" = evidence.tweet_id
          WHERE p."sentiment" IN (${getEffectiveSentimentSqlList()})
        )
      )
    `),
  ];
  return where;
}

function applyExcludeUnknownRelatedPostEvents(where) {
  where[Op.and] = [
    ...(where[Op.and] || []),
    literal(`
      NOT EXISTS (
        SELECT 1
        FROM "EchohuntSocialListeningPosts" p
        WHERE p."boardId" = "EchohuntSocialListeningKeyEvent"."boardId"
          AND p."tweetId" = "EchohuntSocialListeningKeyEvent"."tweetId"
          AND (p."sentiment" IS NULL OR p."sentiment" NOT IN (${getEffectiveSentimentSqlList()}))
      )
    `),
  ];
  return where;
}

function parseEventAt(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function snapshotFromRelatedPost(post) {
  if (!post) return null;
  return {
    tweetId: post.tweetId,
    tweetUrl: buildTweetUrl(post.authorHandle, post.tweetId),
    authorTwitterId: post.authorTwitterId || null,
    authorHandle: post.authorHandle || null,
    authorName: post.authorName || null,
    authorAvatar: post.authorAvatar || null,
    authorGlobalRank: post.authorGlobalRank || null,
    postCreatedAt: post.postCreatedAt || null,
    text: post.text || post.summaryZh || null,
    source: "social_listening_post",
    metrics: {
      views: post.viewsCount || null,
      likes: post.likesCount || null,
      reposts: post.repostsCount || null,
      quotes: post.quotesCount || null,
      replies: post.repliesCount || null,
    },
  };
}

function snapshotFromTweetRow(board, row, parsed) {
  if (!row) return null;
  const postPayload = mapTweetRowToPostPayload(board, row);
  return {
    tweetId: postPayload.tweetId || parsed.tweetId,
    tweetUrl: buildTweetUrl(postPayload.authorHandle || parsed.handle, postPayload.tweetId || parsed.tweetId),
    authorTwitterId: postPayload.authorTwitterId || null,
    authorHandle: postPayload.authorHandle || parsed.handle || null,
    authorName: postPayload.authorName || null,
    authorAvatar: postPayload.authorAvatar || null,
    authorGlobalRank: postPayload.authorGlobalRank || null,
    postCreatedAt: postPayload.postCreatedAt || null,
    text: postPayload.text || null,
    source: "tweet_db",
    metrics: {
      views: postPayload.viewsCount || null,
      likes: postPayload.likesCount || null,
      reposts: postPayload.repostsCount || null,
      quotes: postPayload.quotesCount || null,
      replies: postPayload.repliesCount || null,
    },
  };
}

function buildManualEventSnapshot(parsed, body = {}, currentEvent = null) {
  const eventAt = parseEventAt(body.eventAt || body.manualEventAt);
  if (!eventAt) {
    throw publicError("MANUAL_EVENT_AT_REQUIRED", 400, "手动添加关键事件时，请填写帖子发布时间。", {
      manualRequired: true,
      details: { manualRequired: true, tweetId: parsed.tweetId, tweetUrl: parsed.url || buildTweetUrl(parsed.handle, parsed.tweetId) },
    });
  }
  return {
    tweetId: parsed.tweetId,
    tweetUrl: parsed.url || buildTweetUrl(parsed.handle || currentEvent?.authorHandle, parsed.tweetId),
    authorTwitterId: currentEvent?.authorTwitterId || null,
    authorHandle: parsed.handle || currentEvent?.authorHandle || null,
    authorName: currentEvent?.authorName || null,
    authorAvatar: currentEvent?.authorAvatar || null,
    authorGlobalRank: currentEvent?.authorGlobalRank || null,
    postCreatedAt: eventAt,
    text: body.tweetText || currentEvent?.metadata?.tweetText || null,
    source: "manual",
    metrics: null,
  };
}

function buildKeyEventPayloadFromSnapshot(board, parsed, snapshot, body = {}, currentEvent = null) {
  const metadata = {
    ...(currentEvent?.metadata || {}),
    note: body?.note !== undefined ? body.note : currentEvent?.metadata?.note || null,
    tweetText: snapshot?.text || currentEvent?.metadata?.tweetText || null,
    source: snapshot?.source || currentEvent?.metadata?.source || null,
    tweetSnapshot: snapshot?.metrics || currentEvent?.metadata?.tweetSnapshot || null,
    hydratedAt: snapshot?.source && snapshot.source !== "manual" ? new Date().toISOString() : currentEvent?.metadata?.hydratedAt || null,
  };
  return {
    tweetUrl: snapshot?.tweetUrl || parsed.url || buildTweetUrl(parsed.handle || snapshot?.authorHandle || currentEvent?.authorHandle, parsed.tweetId),
    tweetId: parsed.tweetId,
    eventType: body?.eventType ? String(body.eventType).slice(0, 64) : (currentEvent?.eventType || "custom"),
    title: body?.title !== undefined ? String(body.title || "").slice(0, 255) || null : (currentEvent?.title || null),
    authorTwitterId: snapshot?.authorTwitterId || (currentEvent?.authorTwitterId || null),
    authorHandle: snapshot?.authorHandle || parsed.handle || (currentEvent?.authorHandle || null),
    authorName: snapshot?.authorName || (currentEvent?.authorName || null),
    authorAvatar: snapshot?.authorAvatar || (currentEvent?.authorAvatar || null),
    authorGlobalRank: snapshot?.authorGlobalRank || (currentEvent?.authorGlobalRank || null),
    eventAt: snapshot?.postCreatedAt || currentEvent?.eventAt,
    metadata,
  };
}

async function resolveKeyEventTweet(board, rawValue, body = {}, currentEvent = null) {
  const parsed = parseTweetUrl(rawValue);
  if (!parsed?.tweetId) throw publicError("INVALID_TWEET_URL", 400, "请输入合法的 X 帖子链接。");

  const relatedPost = await EchohuntSocialListeningPost.findOne({ where: { boardId: board.id, tweetId: parsed.tweetId }, raw: true });
  if (relatedPost) {
    if (!EFFECTIVE_SENTIMENTS.includes(String(relatedPost.sentiment || "").toLowerCase())) {
      throw publicError("IRRELEVANT_TWEET_EVENT_NOT_ALLOWED", 400, "无关/未表态的帖子不支持加入前台关键事件。");
    }
    return { parsed, snapshot: snapshotFromRelatedPost(relatedPost) };
  }

  const tweetRow = await fetchTweetRowById(parsed.tweetId).catch((error) => {
    console.warn("[SocialListening] 读取帖子库事件信息失败:", error.message);
    return null;
  });
  if (tweetRow) return { parsed, snapshot: snapshotFromTweetRow(board, tweetRow, parsed) };

  const manual = body?.manual === true || body?.manual === "true" || body?.confirmManual === true || body?.confirmManual === "true";
  if (manual) return { parsed, snapshot: buildManualEventSnapshot(parsed, body, currentEvent) };

  const crawlerSnapshot = await fetchTweetSnapshotFromCrawler(parsed.tweetId, parsed).catch((error) => {
    console.warn("[SocialListening] 爬虫补齐关键事件帖子失败:", error.message);
    return null;
  });
  if (crawlerSnapshot) return { parsed, snapshot: crawlerSnapshot };

  throw publicError("TWEET_EVENT_DETAIL_REQUIRED", 409, "暂时无法自动读取这条 X 帖子的发布时间和基础信息。请确认是否继续手动添加；手动添加需要填写帖子发布时间。", {
    manualRequired: true,
    details: { manualRequired: true, tweetId: parsed.tweetId, tweetUrl: parsed.url || buildTweetUrl(parsed.handle, parsed.tweetId) },
  });
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
    const storedSnapshot = await EchohuntSocialListeningSnapshot.findOne({
      where: { boardId: board.id, rangeKey },
      order: [["generatedAt", "DESC"]],
      raw: true,
    });
    const snapshot = storedSnapshot
      ? await enrichSnapshotMetricComparisons(storedSnapshot, board.id, { excludeUnknownSentiment: true })
      : await buildSnapshotPayload(board, rangeKey, { excludeUnknownSentiment: true });
    res.set("Cache-Control", "private, max-age=30");
    return res.json({
      success: true,
      data: {
        board: await getBoardDetail(board.id, req.authCenter),
        rangeKey,
        state: storedSnapshot ? "ready" : (board.status === "failed" ? "failed" : (snapshot ? "ready" : "processing")),
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
    const { where, rangeKey } = buildPostWhere(board.id, req.query, { excludeUnknownSentiment: true });
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
    }, req.redisClient, { excludeUnknownSentiment: true });
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
    const where = applyExcludeUnknownMentionSignals(applyExcludeOfficialAccount(
      { boardId: board.id, occurredAt: { [Op.gte]: window.windowStartAt, [Op.lt]: window.windowEndAt } },
      board
    ));
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
      EchohuntSocialListeningAccountSignal.findAll({
        where: applyExcludeUnknownMentionSignals({
          boardId: board.id,
          twitterId: req.params.twitterId,
          occurredAt: { [Op.gte]: window.windowStartAt },
        }),
        order: [["occurredAt", "DESC"]],
        limit: 50,
        raw: true,
      }),
      EchohuntSocialListeningPost.findAll({
        where: {
          boardId: board.id,
          authorTwitterId: req.params.twitterId,
          postCreatedAt: { [Op.gte]: window.windowStartAt },
          sentiment: { [Op.in]: EFFECTIVE_SENTIMENTS },
        },
        order: [["postCreatedAt", "DESC"]],
        limit: 50,
      }),
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
    const where = applyExcludeUnknownMentionAlerts(applyExcludeSelfMentionAlerts({ boardId: board.id, triggeredAt: { [Op.gte]: window.windowStartAt } }));
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
    const alert = await EchohuntSocialListeningAlert.findOne({
      where: applyExcludeUnknownMentionAlerts({ id: req.params.alertId, boardId: board.id }),
      raw: true,
    });
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
      where: applyExcludeUnknownRelatedPostEvents({ boardId: board.id, authCenterUserId: req.authCenter.user.id, eventAt: { [Op.gte]: window.windowStartAt } }),
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
    const { parsed, snapshot } = await resolveKeyEventTweet(board, req.body?.tweetUrl || req.body?.tweetId, req.body);
    const event = await EchohuntSocialListeningKeyEvent.create({
      boardId: board.id,
      authCenterUserId: req.authCenter.user.id,
      xhuntUserId: req.authCenter.user.xhuntUserId || null,
      ...buildKeyEventPayloadFromSnapshot(board, parsed, snapshot, req.body),
    });
    return res.json({ success: true, data: event });
  } catch (error) {
    return sendJsonError(res, error, "SOCIAL_LISTENING_EVENT_CREATE_FAILED");
  }
});

router.patch("/boards/:boardId/events/:eventId", async (req, res) => {
  try {
    const { board } = await assertBoardAccess(req.authCenter, req.params.boardId);
    const event = await EchohuntSocialListeningKeyEvent.findOne({ where: { id: req.params.eventId, boardId: req.params.boardId, authCenterUserId: req.authCenter.user.id } });
    if (!event) throw publicError("EVENT_NOT_FOUND", 404, "关键事件不存在。");

    const nextTweetValue = req.body?.tweetUrl !== undefined || req.body?.tweetId !== undefined
      ? (req.body?.tweetUrl || req.body?.tweetId)
      : null;
    if (nextTweetValue) {
      const { parsed, snapshot } = await resolveKeyEventTweet(board, nextTweetValue, req.body, event);
      await event.update(buildKeyEventPayloadFromSnapshot(board, parsed, snapshot, req.body, event));
    } else {
      const nextEventAt = parseEventAt(req.body?.eventAt || req.body?.manualEventAt);
      await event.update({
        eventType: req.body?.eventType ? String(req.body.eventType).slice(0, 64) : event.eventType,
        title: req.body?.title !== undefined ? String(req.body.title || "").slice(0, 255) || null : event.title,
        ...(nextEventAt ? { eventAt: nextEventAt } : {}),
        metadata: { ...(event.metadata || {}), note: req.body?.note !== undefined ? req.body.note : event.metadata?.note || null },
      });
    }
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
