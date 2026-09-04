const { Op, fn, col } = require("sequelize");
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
  ACCOUNT_SIGNAL_TYPES,
  ALERT_TYPES,
  BOARD_STATUSES,
  JOB_STATUSES,
  JOB_TYPES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} = require("../constants");
const { assertTwitterHandle, normalizeTwitterHandle, parseTweetUrl, buildTweetUrl } = require("../utils/twitter");
const { normalizeKeywords } = require("../utils/text-normalize");
const { resolveTwitterUserByHandle, pickRank } = require("./data-source");
const { publicError } = require("./errors");
const { getHistoryRange } = require("./ingest-service");
const { getSocialListeningRuntimeConfig } = require("./runtime-config");
const { enableSocialListeningScheduler } = require("./scheduler");

function toJson(record) {
  return typeof record?.toJSON === "function" ? record.toJSON() : record;
}

function normalizePage(query = {}) {
  const page = Math.max(parseInt(query.page || "1", 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(query.pageSize || DEFAULT_PAGE_SIZE, 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

function buildBoardCountMap(rows = []) {
  return rows.reduce((map, item) => {
    const row = toJson(item) || {};
    const boardId = row.boardId || row.board_id || row["boardId"];
    if (boardId) map.set(boardId, Number(row.count || 0));
    return map;
  }, new Map());
}

async function loadBoardListStats(boardIds = []) {
  if (!boardIds.length) {
    return {
      accessCountByBoard: new Map(),
      postCountByBoard: new Map(),
      latestJobByBoard: new Map(),
    };
  }

  const boardWhere = { boardId: { [Op.in]: boardIds } };
  const [accessCountRows, postCountRows, jobs] = await Promise.all([
    EchohuntSocialListeningBoardAccess.findAll({
      attributes: ["boardId", [fn("COUNT", col("id")), "count"]],
      where: { ...boardWhere, status: ACCESS_STATUSES.ACTIVE },
      group: ["boardId"],
      raw: true,
    }),
    EchohuntSocialListeningPost.findAll({
      attributes: ["boardId", [fn("COUNT", col("id")), "count"]],
      where: boardWhere,
      group: ["boardId"],
      raw: true,
    }),
    EchohuntSocialListeningJob.findAll({
      where: boardWhere,
      order: [["boardId", "ASC"], ["createdAt", "DESC"]],
    }),
  ]);

  const latestJobByBoard = new Map();
  for (const job of jobs) {
    if (job.boardId && !latestJobByBoard.has(job.boardId)) {
      latestJobByBoard.set(job.boardId, job);
    }
  }

  return {
    accessCountByBoard: buildBoardCountMap(accessCountRows),
    postCountByBoard: buildBoardCountMap(postCountRows),
    latestJobByBoard,
  };
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

function pickAvatarUrl(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickProfileAvatar(profile = {}) {
  if (!profile || typeof profile !== "object") return null;
  return pickAvatarUrl(
    profile.profile_image_url,
    profile.profile_image_url_https,
    profile.profileImageUrl,
    profile.profileImageUrlHttps,
    profile.avatar,
    profile.avatar_url,
    profile.avatarUrl,
    profile.image,
    profile.image_url,
    profile.imageUrl
  );
}

function getBoardAvatar(row = {}) {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const profileSnapshot = metadata.profileSnapshot && typeof metadata.profileSnapshot === "object" ? metadata.profileSnapshot : {};
  const profile = profileSnapshot.profile && typeof profileSnapshot.profile === "object" ? profileSnapshot.profile : {};
  return pickAvatarUrl(
    row.projectAvatar,
    metadata.projectAvatar,
    metadata.avatar,
    profileSnapshot.avatar,
    pickProfileAvatar(profile)
  );
}

async function ensureBoardAvatar(board) {
  const row = toJson(board) || {};
  if (getBoardAvatar(row) || !row.officialHandle) return board;

  const account = await resolveTwitterUserByHandle(row.officialHandle).catch(() => null);
  if (!account?.avatar) return board;

  if (typeof board.update === "function") {
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    await board.update({
      projectAvatar: account.avatar,
      metadata: {
        ...metadata,
        profileSnapshot: metadata.profileSnapshot || account.raw || null,
      },
    }).catch(() => null);
    return board;
  }

  row.projectAvatar = account.avatar;
  return row;
}

function serializeBoard(record, extra = {}) {
  const row = toJson(record) || {};
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const boardRank = pickRank(metadata.profileSnapshot || {});
  const avatar = getBoardAvatar(row);
  return {
    id: row.id,
    officialTwitterId: row.officialTwitterId || null,
    officialHandle: row.officialHandle,
    projectName: row.projectName,
    projectDescription: row.projectDescription || null,
    projectAvatar: avatar,
    avatar,
    avatarUrl: avatar,
    profileImageUrl: avatar,
    verified: row.verified,
    followersCount: row.followersCount === null || row.followersCount === undefined ? null : Number(row.followersCount),
    globalRank: boardRank.globalRank ?? row.globalRank ?? null,
    cnRank: boardRank.cnRank ?? row.cnRank ?? null,
    brandColor: row.brandColor || null,
    status: row.status,
    coverageStartAt: row.coverageStartAt || null,
    processedThrough: row.processedThrough || null,
    lastSuccessAt: row.lastSuccessAt || null,
    lastFailureAt: row.lastFailureAt || null,
    lastFailureReason: row.lastFailureReason || null,
    createdByAdminId: row.createdByAdminId || null,
    updatedByAdminId: row.updatedByAdminId || null,
    metadata,
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

function getPostDisplayRank(post = {}) {
  const rank = pickRank(post.rawAuthor || {});
  return {
    globalRank: rank.globalRank ?? post.authorGlobalRank ?? null,
    cnRank: rank.cnRank ?? post.authorCnRank ?? null,
  };
}

function serializePost(record) {
  const row = toJson(record) || {};
  const authorAvatar = pickAvatarUrl(row.authorAvatar, pickProfileAvatar(row.rawAuthor?.profile));
  const authorRank = getPostDisplayRank(row);
  const engagementCount = [row.likesCount, row.repostsCount, row.quotesCount, row.repliesCount]
    .map((v) => Number(v || 0))
    .reduce((a, b) => a + b, 0);
  return {
    id: row.id,
    tweetId: row.tweetId,
    tweetUrl: buildTweetUrl(row.authorHandle, row.tweetId),
    authorTwitterId: row.authorTwitterId,
    authorHandle: row.authorHandle,
    authorName: row.authorName,
    authorAvatar,
    author: {
      twitterId: row.authorTwitterId,
      handle: row.authorHandle,
      name: row.authorName,
      avatar: authorAvatar,
      avatarUrl: authorAvatar,
      profileImageUrl: authorAvatar,
      followersCount: row.authorFollowersCount === null || row.authorFollowersCount === undefined ? null : Number(row.authorFollowersCount),
      globalRank: authorRank.globalRank ?? row.authorGlobalRank ?? null,
      cnRank: authorRank.cnRank ?? row.authorCnRank ?? null,
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
      aiError: row.aiError || null,
    },
  };
}

function getSignalDisplayName(row = {}) {
  return row.name || row.handle || row.twitterId || "Key account";
}

function describeAccountSignalEn(row = {}) {
  const name = getSignalDisplayName(row);
  if (row.signalType === ACCOUNT_SIGNAL_TYPES.ACCOUNT_FOLLOWED_PROJECT) return `${name} followed this monitored project.`;
  if (row.signalType === ACCOUNT_SIGNAL_TYPES.PROJECT_FOLLOWED_ACCOUNT) return `This monitored project followed ${name}.`;
  if (row.signalType === ACCOUNT_SIGNAL_TYPES.ACCOUNT_UNFOLLOWED_PROJECT) return `${name} unfollowed this monitored project.`;
  if (row.signalType === ACCOUNT_SIGNAL_TYPES.PROJECT_UNFOLLOWED_ACCOUNT) return `This monitored project unfollowed ${name}.`;
  return `${name} mentioned this monitored project.`;
}

function serializeAccountSignal(record) {
  const row = toJson(record) || {};
  const avatar = pickAvatarUrl(row.avatar, row.avatarUrl, row.profileImageUrl);
  return {
    ...row,
    avatar,
    avatarUrl: avatar,
    profileImageUrl: avatar,
    summaryEn: row.summaryEn || describeAccountSignalEn(row),
  };
}

function formatAlertPercent(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0.0%";
  return `${(num * 100).toFixed(1)}%`;
}

function buildAlertI18nFallback(alert = {}) {
  const currentValue = alert.currentValue && typeof alert.currentValue === "object" ? alert.currentValue : {};
  const baselineValue = alert.baselineValue && typeof alert.baselineValue === "object" ? alert.baselineValue : {};
  if (alert.alertType === ALERT_TYPES.INFLUENTIAL_MENTION) {
    const author = currentValue.authorName || currentValue.authorHandle || currentValue.authorTwitterId || "An influential account";
    return {
      titleEn: "Influential account mention",
      messageEn: `${author} mentioned this monitored project.`,
    };
  }
  if (alert.alertType === ALERT_TYPES.NEGATIVE_CONTENT) {
    const count = currentValue.negativeCount ?? currentValue.count ?? alert.sampleSize ?? 0;
    const authorCount = currentValue.authorCount ?? 1;
    return {
      titleEn: alert.titleZh === "集中负面内容风险" ? "Concentrated negative content risk" : "Negative content risk",
      messageEn: `${count} negative discussions from ${authorCount} account${Number(authorCount) === 1 ? "" : "s"} were detected in the selected range.`,
    };
  }
  if (alert.alertType === ALERT_TYPES.VOLUME_SPIKE) {
    const count = currentValue.count ?? alert.sampleSize ?? 0;
    const average = baselineValue.average;
    return {
      titleEn: "Discussion volume spike",
      messageEn: average
        ? `Effective discussion volume reached ${count}, above the historical same-hour baseline of ${Number(average).toFixed(1)}.`
        : `Effective discussion volume reached ${count}, above the historical baseline.`,
    };
  }
  if (alert.alertType === ALERT_TYPES.NEGATIVE_SHARE_SPIKE) {
    const currentRatio = currentValue.ratio;
    const baselineRatio = baselineValue.ratio;
    return {
      titleEn: "Negative sentiment share spike",
      messageEn: `Negative sentiment share rose to ${formatAlertPercent(currentRatio)}${baselineRatio === undefined || baselineRatio === null ? "." : `, above the historical baseline of ${formatAlertPercent(baselineRatio)}.`}`,
    };
  }
  return {
    titleEn: alert.titleEn || alert.titleZh || "Social Listening alert",
    messageEn: alert.messageEn || alert.messageZh || "",
  };
}

function serializeAlert(record, options = {}) {
  const row = toJson(record) || {};
  const fallback = buildAlertI18nFallback(row);
  const titleZh = row.titleZh || row.titleEn || fallback.titleEn || "";
  const messageZh = row.messageZh || row.messageEn || fallback.messageEn || "";
  const titleEn = row.titleEn || fallback.titleEn || titleZh;
  const messageEn = row.messageEn || fallback.messageEn || messageZh;
  const lang = String(options.lang || "").toLowerCase();
  const useZh = lang.startsWith("zh");
  return {
    ...row,
    titleZh,
    titleEn,
    messageZh,
    messageEn,
    title: useZh ? titleZh : titleEn,
    message: useZh ? messageZh : messageEn,
  };
}

async function enrichSignalAvatars(records = []) {
  const rows = records.map((record) => toJson(record) || {});
  const handles = Array.from(new Set(rows
    .map((row) => normalizeTwitterHandle(row.handle))
    .filter(Boolean)));
  if (!handles.length) return rows;

  const accountByHandle = new Map();
  await Promise.all(handles.map(async (handle) => {
    const account = await resolveTwitterUserByHandle(handle).catch(() => null);
    if (account) accountByHandle.set(handle, account);
  }));
  if (!accountByHandle.size) return rows;

  return rows.map((row) => {
    const handle = normalizeTwitterHandle(row.handle);
    const account = handle ? accountByHandle.get(handle) : null;
    if (!account) return row;
    return {
      ...row,
      avatar: row.avatar || account.avatar,
      name: row.name || account.name,
      followersCount: row.followersCount ?? account.followersCount,
      globalRank: account.globalRank ?? row.globalRank,
      cnRank: account.cnRank ?? row.cnRank,
    };
  });
}

async function enrichInfluentialAlertRanks(records = [], defaultBoardId = null) {
  const rows = records.map((record) => toJson(record) || {}).filter(Boolean);
  const influentialAlerts = rows.filter((alert) => alert.alertType === "influential_mention");
  const tweetIds = Array.from(new Set(influentialAlerts
    .flatMap((alert) => Array.isArray(alert.evidenceTweetIds) ? alert.evidenceTweetIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean)));
  const boardIds = Array.from(new Set(influentialAlerts
    .map((alert) => String(alert.boardId || defaultBoardId || "").trim())
    .filter(Boolean)));
  if (!tweetIds.length || !boardIds.length) return rows;

  const posts = await EchohuntSocialListeningPost.findAll({
    where: { boardId: { [Op.in]: boardIds }, tweetId: { [Op.in]: tweetIds } },
    attributes: ["boardId", "tweetId", "authorGlobalRank", "authorCnRank", "rawAuthor"],
    raw: true,
  }).catch(() => []);
  const rankByKey = new Map(posts.map((post) => [`${post.boardId}:${post.tweetId}`, getPostDisplayRank(post)]));

  return rows.map((alert) => {
    if (alert.alertType !== "influential_mention") return alert;
    const boardId = String(alert.boardId || defaultBoardId || "").trim();
    const evidenceTweetIds = Array.isArray(alert.evidenceTweetIds) ? alert.evidenceTweetIds : [];
    const rank = evidenceTweetIds.map((id) => rankByKey.get(`${boardId}:${String(id)}`)).find(Boolean);
    if (!rank) return alert;
    return {
      ...alert,
      currentValue: {
        ...(alert.currentValue || {}),
        globalRank: rank.globalRank ?? alert.currentValue?.globalRank ?? null,
        cnRank: rank.cnRank ?? alert.currentValue?.cnRank ?? null,
      },
    };
  });
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
  const inputMetadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
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
    status: BOARD_STATUSES.PAUSED,
    createdByAdminId: adminId,
    updatedByAdminId: adminId,
    metadata: {
      ...inputMetadata,
      keywords,
      aliases: normalizeKeywords(input.aliases || []),
      recallExcludeKeywords: normalizeKeywords(inputMetadata.recallExcludeKeywords || input.recallExcludeKeywords || []),
      wordCloudExcludeKeywords: normalizeKeywords(inputMetadata.wordCloudExcludeKeywords || input.wordCloudExcludeKeywords || []),
      aiRuntime: {
        contentEnabled: false,
        projectAttitudeEnabled: false,
      },
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
    const identityWhere = [{ officialHandle: handle }];
    if (payload.officialTwitterId) identityWhere.push({ officialTwitterId: String(payload.officialTwitterId) });
    const existing = await EchohuntSocialListeningBoard.findOne({
      where: {
        status: { [Op.ne]: BOARD_STATUSES.DELETED },
        [Op.or]: identityWhere,
      },
      transaction,
      lock: true,
    });
    if (existing) return { board: existing, created: false, job: null };

    const board = await EchohuntSocialListeningBoard.create(payload, { transaction });
    await writeAudit({
      boardId: board.id,
      adminId,
      action: "board_create",
      targetTwitterHandle: handle,
      payload: {
        officialHandle: handle,
        projectName: payload.projectName,
        keywords: payload.metadata.keywords,
        status: payload.status,
        schedulerState: "paused_by_default",
      },
    }, { transaction });
    return { board, created: true, job: null };
  });
}

function shouldRunInitialBackfill(board) {
  return !board.coverageStartAt && !board.processedThrough && !board.lastSuccessAt;
}

async function createInitialBackfillJob(board, adminId = null) {
  const range = await getHistoryRange("recent_7d");
  return EchohuntSocialListeningJob.create({
    boardId: board.id,
    jobType: JOB_TYPES.HISTORY_BACKFILL,
    status: JOB_STATUSES.PENDING,
    rangeStartAt: range.startAt,
    rangeEndAt: range.endAt,
    triggeredBy: "admin",
    triggeredByAdminId: adminId,
    metadata: { stage: "recent_7d", source: "admin_resume" },
  });
}

async function resumeBoard(boardId, adminId = null, redisClient = null) {
  const board = await EchohuntSocialListeningBoard.findByPk(boardId);
  if (!board || [BOARD_STATUSES.DELETED, BOARD_STATUSES.DELETING].includes(board.status)) {
    throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
  }

  const runningOrPending = await EchohuntSocialListeningJob.findOne({
    where: { boardId, status: { [Op.in]: [JOB_STATUSES.PENDING, JOB_STATUSES.RUNNING] } },
    order: [["createdAt", "DESC"]],
  });

  const firstActivation = shouldRunInitialBackfill(board);
  await board.update({
    status: firstActivation ? BOARD_STATUSES.INITIALIZING : BOARD_STATUSES.MONITORING,
    updatedByAdminId: adminId,
  });

  let job = runningOrPending;
  let reused = Boolean(runningOrPending);
  if (!job) {
    if (firstActivation) {
      job = await createInitialBackfillJob(board, adminId);
    } else {
      const refresh = await createManualRefreshJob(board.id, { type: "admin", adminId }, redisClient);
      job = refresh.job;
      reused = refresh.reused;
    }
  }

  await enableSocialListeningScheduler(redisClient, { type: "admin", adminId }).catch((error) => {
    console.warn("[SocialListening] 开启调度器状态失败:", error.message);
    return null;
  });

  await writeAudit({ boardId: board.id, adminId, action: "board_resume", payload: { firstActivation } });
  return { board: await EchohuntSocialListeningBoard.findByPk(board.id), job, reused, firstActivation };
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
  const boardIds = result.rows.map((row) => row.id).filter(Boolean);
  const { accessCountByBoard, postCountByBoard, latestJobByBoard } = await loadBoardListStats(boardIds);
  return {
    items: result.rows.map((row) => {
      const latestJob = latestJobByBoard.get(row.id);
      return serializeBoard(row, {
        accessCount: accessCountByBoard.get(row.id) || 0,
        postCount: postCountByBoard.get(row.id) || 0,
        latestJob: latestJob ? serializeJob(latestJob) : null,
      });
    }),
    page,
    pageSize,
    total: result.count,
  };
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
  const inputMetadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  if (Array.isArray(inputMetadata.wordCloudExcludeKeywords) || Array.isArray(input.wordCloudExcludeKeywords)) {
    patch.metadata.wordCloudExcludeKeywords = normalizeKeywords(inputMetadata.wordCloudExcludeKeywords || input.wordCloudExcludeKeywords || []);
  }
  if (Array.isArray(inputMetadata.recallExcludeKeywords) || Array.isArray(input.recallExcludeKeywords)) {
    patch.metadata.recallExcludeKeywords = normalizeKeywords(inputMetadata.recallExcludeKeywords || input.recallExcludeKeywords || []);
  }
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
    boards.push(serializeBoard(await ensureBoardAvatar(board), { accessId: access.id }));
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
  let board = authCenter ? (await assertBoardAccess(authCenter, boardId)).board : await EchohuntSocialListeningBoard.findByPk(boardId);
  if (!board) throw publicError("BOARD_NOT_FOUND", 404, "看板不存在。");
  board = await ensureBoardAvatar(board);
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
  if (board.status === BOARD_STATUSES.PAUSED) {
    throw publicError("BOARD_PAUSED", 409, "看板已暂停，请先在管理后台恢复监控。");
  }
  const runtimeConfig = await getSocialListeningRuntimeConfig();
  const refreshConfig = runtimeConfig.refresh || {};
  const prefix = actor.type === "admin" ? `admin:${actor.adminId || "unknown"}` : `user:${actor.authCenterUserId || "unknown"}`;
  const cooldownSeconds = actor.type === "admin" ? refreshConfig.adminCooldownSeconds : refreshConfig.userCooldownSeconds;
  const cooldownKey = `echohunt:social-listening:refresh:${prefix}:${boardId}`;
  const boardCooldownKey = `echohunt:social-listening:refresh:board:${boardId}`;

  if (redisClient?.set) {
    const ok = cooldownSeconds > 0
      ? await redisClient.set(cooldownKey, "1", { NX: true, EX: cooldownSeconds }).catch(() => "OK")
      : "OK";
    const boardCooldownSeconds = actor.type === "admin" ? refreshConfig.adminBoardCooldownSeconds : refreshConfig.userBoardCooldownSeconds;
    const boardOk = boardCooldownSeconds > 0
      ? await redisClient.set(boardCooldownKey, "1", { NX: true, EX: boardCooldownSeconds }).catch(() => "OK")
      : "OK";
    if (ok === null || boardOk === null) {
      throw publicError("REFRESH_RATE_LIMITED", 429, "刷新太频繁，请稍后再试。", { retryAfter: cooldownSeconds });
    }
  }

  const running = await EchohuntSocialListeningJob.findOne({
    where: { boardId, status: { [Op.in]: [JOB_STATUSES.PENDING, JOB_STATUSES.RUNNING] } },
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
  serializeAccountSignal,
  serializeAlert,
  getPostDisplayRank,
  enrichSignalAvatars,
  enrichInfluentialAlertRanks,
  writeAudit,
  resolveMonitoredAccount,
  createMonitoredAccount,
  resumeBoard,
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
