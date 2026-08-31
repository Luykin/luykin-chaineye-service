const { Op } = require("sequelize");
const {
  pgInstance,
  AuthCenterXhuntIdentity,
  AuthCenterXhuntUser,
  EchohuntSocialListeningBoard,
  EchohuntSocialListeningBoardAccess,
  EchohuntSocialListeningAccessAuditLog,
  EchohuntSocialListeningJob,
  EchohuntSocialListeningPost,
  EchohuntSocialListeningSnapshot,
  EchohuntSocialListeningAccountSignal,
  EchohuntSocialListeningAlert,
  EchohuntSocialListeningKeyEvent,
} = require("../../../models/postgres-start");
const {
  ACCESS_STATUSES,
  BOARD_STATUSES,
  JOB_STATUSES,
  JOB_TYPES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} = require("../constants");
const { assertTwitterHandle, normalizeTwitterHandle, parseTweetUrl, buildTweetUrl } = require("../utils/twitter");
const { normalizeKeywords } = require("../utils/text-normalize");
const { resolveTwitterUserByHandle } = require("./data-source");
const { publicError } = require("./errors");
const { getHistoryRange } = require("./ingest-service");

function toJson(record) {
  return typeof record?.toJSON === "function" ? record.toJSON() : record;
}

function normalizePage(query = {}) {
  const page = Math.max(parseInt(query.page || "1", 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(query.pageSize || DEFAULT_PAGE_SIZE, 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

function getTwitterIdentityFromAuthCenter(authCenter) {
  const identity = (authCenter?.identities || []).find((item) => item.provider === "twitter");
  if (!identity) return null;
  return {
    twitterId: String(identity.providerSubject || identity.providerSubjectLower || "").trim(),
    twitterHandle: normalizeTwitterHandle(identity.username),
    displayName: identity.displayName || identity.username || null,
    avatar: identity.avatar || null,
  };
}

function serializeBoard(record, extra = {}) {
  const row = toJson(record) || {};
  return {
    id: row.id,
    officialTwitterId: row.officialTwitterId || null,
    officialHandle: row.officialHandle,
    projectName: row.projectName,
    projectDescription: row.projectDescription || null,
    projectAvatar: row.projectAvatar || null,
    verified: row.verified,
    followersCount: row.followersCount === null || row.followersCount === undefined ? null : Number(row.followersCount),
    globalRank: row.globalRank || null,
    cnRank: row.cnRank || null,
    brandColor: row.brandColor || null,
    status: row.status,
    coverageStartAt: row.coverageStartAt || null,
    processedThrough: row.processedThrough || null,
    lastSuccessAt: row.lastSuccessAt || null,
    lastFailureAt: row.lastFailureAt || null,
    lastFailureReason: row.lastFailureReason || null,
    metadata: row.metadata || {},
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    ...extra,
  };
}

function serializeAccess(record) {
  const row = toJson(record) || {};
  return {
    id: row.id,
    boardId: row.boardId,
    twitterId: row.twitterId || null,
    twitterHandle: row.twitterHandle,
    authCenterUserId: row.authCenterUserId || null,
    xhuntUserId: row.xhuntUserId || null,
    status: row.status,
    grantedByAdminId: row.grantedByAdminId || null,
    revokedByAdminId: row.revokedByAdminId || null,
    grantedAt: row.grantedAt || null,
    revokedAt: row.revokedAt || null,
    metadata: row.metadata || {},
  };
}

function serializeJob(record) {
  const row = toJson(record) || {};
  return {
    id: row.id,
    boardId: row.boardId,
    jobType: row.jobType,
    status: row.status,
    rangeStartAt: row.rangeStartAt || null,
    rangeEndAt: row.rangeEndAt || null,
    progress: row.progress || null,
    metadata: row.metadata || null,
    startedAt: row.startedAt || null,
    finishedAt: row.finishedAt || null,
    errorCode: row.errorCode || null,
    errorMessage: row.errorMessage || null,
    triggeredBy: row.triggeredBy || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
}

function serializePost(record) {
  const row = toJson(record) || {};
  const engagementCount = [row.likesCount, row.repostsCount, row.quotesCount, row.repliesCount]
    .map((v) => Number(v || 0))
    .reduce((a, b) => a + b, 0);
  return {
    id: row.id,
    tweetId: row.tweetId,
    tweetUrl: buildTweetUrl(row.authorHandle, row.tweetId),
    author: {
      twitterId: row.authorTwitterId,
      handle: row.authorHandle,
      name: row.authorName,
      avatar: row.authorAvatar,
      followersCount: row.authorFollowersCount === null || row.authorFollowersCount === undefined ? null : Number(row.authorFollowersCount),
      globalRank: row.authorGlobalRank || null,
      cnRank: row.authorCnRank || null,
      isCn: row.authorIsCn,
    },
    postCreatedAt: row.postCreatedAt,
    text: row.text,
    source: row.source,
    metrics: {
      views: Number(row.viewsCount || 0),
      likes: Number(row.likesCount || 0),
      reposts: Number(row.repostsCount || 0),
      quotes: Number(row.quotesCount || 0),
      replies: Number(row.repliesCount || 0),
      engagement: engagementCount,
    },
    sentiment: row.sentiment || "unknown",
    projectAttitudeScore: row.projectAttitudeScore === null || row.projectAttitudeScore === undefined ? null : Number(row.projectAttitudeScore),
    sentimentSummaryZh: row.sentimentSummaryZh || null,
    topics: row.topics || [],
    keywords: row.keywords || [],
    summaryZh: row.summaryZh || null,
    summaryEn: row.summaryEn || null,
    titleZh: row.titleZh || null,
    titleEn: row.titleEn || null,
    abstractZh: row.abstractZh || null,
    abstractEn: row.abstractEn || null,
    ai: {
      tagStatus: row.tagStatus || null,
      summaryStatus: row.summaryStatus || null,
      attitudeStatus: row.attitudeStatus || null,
      aiStatus: row.aiStatus || null,
      aiAnalyzedAt: row.aiAnalyzedAt || null,
      aiSource: row.aiSource || null,
    },
  };
}

async function writeAudit(payload, options = {}) {
  return EchohuntSocialListeningAccessAuditLog.create(payload, { transaction: options.transaction }).catch((error) => {
    console.warn("[SocialListening] 写审计日志失败:", error.message);
    return null;
  });
}

async function resolveMonitoredAccount(handle) {
  const account = await resolveTwitterUserByHandle(handle);
  if (!account) throw publicError("TWITTER_USER_NOT_FOUND", 404, "未找到该 X 账号，请确认 handle 是否正确。");
  return account;
}

function buildBoardPayload(input = {}, resolved = null, adminId = null) {
  const officialHandle = assertTwitterHandle(input.officialHandle || input.handle || resolved?.handleLower || resolved?.handle);
  const projectName = String(input.projectName || resolved?.name || officialHandle).trim().slice(0, 255);
  if (!projectName) throw publicError("PROJECT_NAME_REQUIRED", 400, "请填写项目名称。");
  const keywords = normalizeKeywords([
    officialHandle,
    projectName,
    ...(Array.isArray(input.keywords) ? input.keywords : []),
    ...(Array.isArray(input.aliases) ? input.aliases : []),
  ]);
  return {
    officialTwitterId: resolved?.twitterId || input.officialTwitterId || null,
    officialHandle,
    projectName,
    projectDescription: input.projectDescription || resolved?.description || null,
    projectAvatar: input.projectAvatar || resolved?.avatar || null,
    verified: resolved?.verified ?? input.verified ?? null,
    followersCount: resolved?.followersCount ?? input.followersCount ?? null,
    globalRank: resolved?.globalRank ?? input.globalRank ?? null,
    cnRank: resolved?.cnRank ?? input.cnRank ?? null,
    brandColor: input.brandColor || null,
    status: input.status || BOARD_STATUSES.INITIALIZING,
    createdByAdminId: adminId,
    updatedByAdminId: adminId,
    metadata: {
      ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
      keywords,
      aliases: normalizeKeywords(input.aliases || []),
      profileSnapshot: resolved?.raw || null,
      rankSource: resolved?.rankSource || null,
    },
  };
}

async function createMonitoredAccount(input = {}, adminId = null) {
  const handle = assertTwitterHandle(input.officialHandle || input.handle);
  const resolved = await resolveTwitterUserByHandle(handle).catch((error) => {
    if (error.status === 503 && input.allowUnresolved === true) return null;
    throw error;
  });
  const payload = buildBoardPayload({ ...input, officialHandle: handle }, resolved, adminId);

  return pgInstance.transaction(async (transaction) => {
    const existing = await EchohuntSocialListeningBoard.findOne({
      where: { officialHandle: handle, status: { [Op.ne]: BOARD_STATUSES.DELETED } },
      transaction,
      lock: true,
    });
    if (existing) return { board: existing, created: false, job: null };

    const board = await EchohuntSocialListeningBoard.create(payload, { transaction });
    const range = getHistoryRange("recent_7d");
    const job = await EchohuntSocialListeningJob.create({
      boardId: board.id,
      jobType: JOB_TYPES.HISTORY_BACKFILL,
      status: JOB_STATUSES.PENDING,
      rangeStartAt: range.startAt,
      rangeEndAt: range.endAt,
      triggeredBy: "admin",
      triggeredByAdminId: adminId,
      metadata: { stage: "recent_7d" },
    }, { transaction });
    await writeAudit({
      boardId: board.id,
      adminId,
      action: "board_create",
      targetTwitterHandle: handle,
      payload: { officialHandle: handle, projectName: payload.projectName, keywords: payload.metadata.keywords },
    }, { transaction });
    return { board, created: true, job };
  });
}

async function listMonitoredAccounts(query = {}) {
  const { page, pageSize, offset, limit } = normalizePage(query);
  const where = {};
  if (query.status) where.status = String(query.status);
  else where.status = { [Op.ne]: BOARD_STATUSES.DELETED };
  const q = String(query.q || "").trim();
  if (q) {
    where[Op.or] = [
      { officialHandle: { [Op.iLike]: `%${q.replace(/^@+/, "")}%` } },
      { projectName: { [Op.iLike]: `%${q}%` } },
    ];
  }
  const result = await EchohuntSocialListeningBoard.findAndCountAll({
    where,
    order: [["updatedAt", "DESC"]],
    offset,
    limit,
  });
  return { items: result.rows.map(serializeBoard), page, pageSize, total: result.count };
}

async function updateBoard(boardId, input = {}, adminId = null) {
  const board = await EchohuntSocialListeningBoard.findByPk(boardId);
  if (!board || board.status === BOARD_STATUSES.DELETED) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
  const metadata = board.metadata && typeof board.metadata === "object" ? board.metadata : {};
  const patch = {
    updatedByAdminId: adminId,
    metadata: {
      ...metadata,
      ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
    },
  };
  ["projectName", "projectDescription", "projectAvatar", "brandColor"].forEach((key) => {
    if (input[key] !== undefined) patch[key] = input[key] || null;
  });
  if (Array.isArray(input.keywords)) patch.metadata.keywords = normalizeKeywords(input.keywords);
  if (Array.isArray(input.aliases)) patch.metadata.aliases = normalizeKeywords(input.aliases);
  if (input.status && Object.values(BOARD_STATUSES).includes(input.status)) patch.status = input.status;
  await board.update(patch);
  await writeAudit({ boardId: board.id, adminId, action: "board_update", payload: patch });
  return board;
}

async function findAuthIdentityByHandle(handle) {
  return AuthCenterXhuntIdentity.findOne({
    where: { provider: "twitter", username: { [Op.iLike]: handle } },
    include: [{ model: AuthCenterXhuntUser, as: "user" }],
    order: [["updatedAt", "DESC"]],
  }).catch(() => null);
}

async function grantBoardAccess(boardId, input = {}, adminId = null) {
  const board = await EchohuntSocialListeningBoard.findByPk(boardId);
  if (!board || board.status === BOARD_STATUSES.DELETED) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
  const twitterHandle = assertTwitterHandle(input.twitterHandle || input.handle);
  const identity = await findAuthIdentityByHandle(twitterHandle);
  const payload = {
    boardId,
    twitterHandle,
    twitterId: input.twitterId || identity?.providerSubject || null,
    authCenterUserId: input.authCenterUserId || identity?.userId || null,
    xhuntUserId: input.xhuntUserId || identity?.user?.xhuntUserId || null,
    status: ACCESS_STATUSES.ACTIVE,
    grantedByAdminId: adminId,
    grantedAt: new Date(),
    revokedAt: null,
    revokedByAdminId: null,
    metadata: { source: "admin", matchedIdentityId: identity?.id || null },
  };

  return pgInstance.transaction(async (transaction) => {
    const existing = await EchohuntSocialListeningBoardAccess.findOne({
      where: { boardId, twitterHandle, status: ACCESS_STATUSES.ACTIVE },
      transaction,
      lock: true,
    });
    if (existing) return { access: existing, created: false };
    const access = await EchohuntSocialListeningBoardAccess.create(payload, { transaction });
    await writeAudit({
      boardId,
      accessId: access.id,
      adminId,
      action: "access_grant",
      targetTwitterHandle: twitterHandle,
      targetAuthCenterUserId: payload.authCenterUserId,
      payload: { twitterHandle, twitterId: payload.twitterId },
    }, { transaction });
    return { access, created: true };
  });
}

async function revokeBoardAccess(boardId, accessId, adminId = null) {
  const access = await EchohuntSocialListeningBoardAccess.findOne({ where: { id: accessId, boardId } });
  if (!access) throw publicError("ACCESS_NOT_FOUND", 404, "授权记录不存在。");
  await access.update({ status: ACCESS_STATUSES.REVOKED, revokedAt: new Date(), revokedByAdminId: adminId });
  await writeAudit({
    boardId,
    accessId: access.id,
    adminId,
    action: "access_revoke",
    targetTwitterHandle: access.twitterHandle,
    targetAuthCenterUserId: access.authCenterUserId,
  });
  return access;
}

function buildAccessWhere(authCenter) {
  const user = authCenter?.user;
  const twitter = getTwitterIdentityFromAuthCenter(authCenter);
  const or = [];
  if (user?.id) or.push({ authCenterUserId: user.id });
  if (twitter?.twitterId) or.push({ twitterId: twitter.twitterId });
  if (twitter?.twitterHandle) or.push({ twitterHandle: twitter.twitterHandle });
  if (!or.length) throw publicError("TWITTER_ID_REQUIRED", 400, "请先使用 X 登录 EchoHunt。");
  return { status: ACCESS_STATUSES.ACTIVE, [Op.or]: or };
}

async function listAccessibleBoards(authCenter) {
  const accesses = await EchohuntSocialListeningBoardAccess.findAll({
    where: buildAccessWhere(authCenter),
    include: [{ model: EchohuntSocialListeningBoard, as: "board", required: true }],
    order: [["updatedAt", "DESC"]],
  });
  const user = authCenter?.user;
  const twitter = getTwitterIdentityFromAuthCenter(authCenter);
  const boards = [];
  for (const access of accesses) {
    if (!access.authCenterUserId && user?.id) {
      access.update({
        authCenterUserId: user.id,
        twitterId: access.twitterId || twitter?.twitterId || null,
        xhuntUserId: user.xhuntUserId || null,
        metadata: { ...(access.metadata || {}), autoBoundAt: new Date().toISOString() },
      }).catch(() => null);
    }
    const board = access.board;
    if (!board || [BOARD_STATUSES.DELETED, BOARD_STATUSES.DELETING].includes(board.status)) continue;
    boards.push(serializeBoard(board, { accessId: access.id }));
  }
  return boards;
}

async function getAccessSummary(authCenter) {
  const boards = await listAccessibleBoards(authCenter);
  return {
    hasAccess: boards.length > 0,
    boardCount: boards.length,
    defaultBoardId: boards[0]?.id || null,
    boards: boards.slice(0, 20),
  };
}

async function assertBoardAccess(authCenter, boardId) {
  const board = await EchohuntSocialListeningBoard.findByPk(boardId);
  if (!board || [BOARD_STATUSES.DELETED, BOARD_STATUSES.DELETING].includes(board.status)) {
    throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
  }
  const access = await EchohuntSocialListeningBoardAccess.findOne({
    where: { boardId, ...buildAccessWhere(authCenter) },
  });
  if (!access) throw publicError("SOCIAL_LISTENING_FORBIDDEN", 403, "你没有访问该 Social Listening 看板的权限。");
  return { board, access };
}

async function getBoardDetail(boardId, authCenter = null) {
  const board = authCenter ? (await assertBoardAccess(authCenter, boardId)).board : await EchohuntSocialListeningBoard.findByPk(boardId);
  if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
  const [latestJob, accessCount, postCount] = await Promise.all([
    EchohuntSocialListeningJob.findOne({ where: { boardId }, order: [["createdAt", "DESC"]] }),
    EchohuntSocialListeningBoardAccess.count({ where: { boardId, status: ACCESS_STATUSES.ACTIVE } }),
    EchohuntSocialListeningPost.count({ where: { boardId } }),
  ]);
  return serializeBoard(board, { latestJob: serializeJob(latestJob), accessCount, postCount });
}

async function createManualRefreshJob(boardId, actor, redisClient = null) {
  const board = await EchohuntSocialListeningBoard.findByPk(boardId);
  if (!board || [BOARD_STATUSES.DELETED, BOARD_STATUSES.DELETING].includes(board.status)) {
    throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
  }
  const prefix = actor.type === "admin" ? `admin:${actor.adminId || "unknown"}` : `user:${actor.authCenterUserId || "unknown"}`;
  const cooldownSeconds = actor.type === "admin" ? 60 : 5 * 60;
  const cooldownKey = `echohunt:social-listening:refresh:${prefix}:${boardId}`;
  const boardCooldownKey = `echohunt:social-listening:refresh:board:${boardId}`;

  if (redisClient?.set) {
    const ok = await redisClient.set(cooldownKey, "1", { NX: true, EX: cooldownSeconds }).catch(() => "OK");
    const boardOk = await redisClient.set(boardCooldownKey, "1", { NX: true, EX: actor.type === "admin" ? 60 : 120 }).catch(() => "OK");
    if (ok === null || boardOk === null) {
      throw publicError("REFRESH_RATE_LIMITED", 429, "刷新太频繁，请稍后再试。", { retryAfter: cooldownSeconds });
    }
  }

  const running = await EchohuntSocialListeningJob.findOne({
    where: { boardId, status: JOB_STATUSES.RUNNING },
    order: [["updatedAt", "DESC"]],
  });
  if (running) return { job: running, reused: true };

  const job = await EchohuntSocialListeningJob.create({
    boardId,
    jobType: JOB_TYPES.MANUAL_REFRESH,
    status: JOB_STATUSES.PENDING,
    triggeredBy: actor.type,
    triggeredByAdminId: actor.adminId || null,
    triggeredByAuthCenterUserId: actor.authCenterUserId || null,
    metadata: { source: actor.type },
  });
  return { job, reused: false };
}

module.exports = {
  normalizePage,
  serializeBoard,
  serializeAccess,
  serializeJob,
  serializePost,
  writeAudit,
  resolveMonitoredAccount,
  createMonitoredAccount,
  listMonitoredAccounts,
  updateBoard,
  grantBoardAccess,
  revokeBoardAccess,
  listAccessibleBoards,
  getAccessSummary,
  assertBoardAccess,
  getBoardDetail,
  createManualRefreshJob,
  parseTweetUrl,
};
