const crypto = require("crypto");
const { Op } = require("sequelize");
const {
  pgInstance,
  XHuntBinanceSquareBinding,
  XHuntBinanceSquareBindingChallenge,
  XHuntBinanceSquareBindingEvent,
} = require("../../models/postgres-start");
const apiClient = require("../../binance-square/scraper/api-client");
const postParser = require("../../binance-square/scraper/parsers/postParser");

const VERIFICATION_CODE_PREFIX = "EH";
const VERIFICATION_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const VERIFICATION_CODE_LENGTH = 6;
const CHALLENGE_TTL_MINUTES = Number(process.env.ECHOHUNT_BS_BINDING_CHALLENGE_TTL_MINUTES || 30);
const MAX_ATTEMPTS = Number(process.env.ECHOHUNT_BS_BINDING_MAX_ATTEMPTS || 5);
const MONTHLY_REBIND_LIMIT = Number(process.env.ECHOHUNT_BS_BINDING_MONTHLY_REBIND_LIMIT || 3);
const POST_TIME_SKEW_MS = 5 * 60 * 1000;

const BINDING_ERROR_MESSAGES = {
  TWITTER_ID_REQUIRED: {
    "zh-CN": "请先连接 X 账号后再绑定币安广场。",
    en: "Please connect your X account before binding Binance Square.",
  },
  INVALID_POST_URL: {
    "zh-CN": "请粘贴 Binance Square 帖子链接。",
    en: "Please paste a Binance Square post link.",
  },
  CHALLENGE_ID_REQUIRED: {
    "zh-CN": "验证码参数缺失，请重新生成。",
    en: "The verification request is missing. Please generate a new verification text.",
  },
  POST_URL_REQUIRED: {
    "zh-CN": "请粘贴币安广场帖子链接。",
    en: "Please paste the Binance Square post link.",
  },
  CHALLENGE_NOT_FOUND: {
    "zh-CN": "验证码不存在，请重新生成。",
    en: "The verification code was not found. Please generate a new one.",
  },
  CHALLENGE_NOT_PENDING: {
    "zh-CN": "验证码状态已失效，请重新生成。",
    en: "This verification code is no longer valid. Please generate a new one.",
  },
  CHALLENGE_EXPIRED: {
    "zh-CN": "验证码已过期，请重新生成。",
    en: "The verification code has expired. Please generate a new one.",
  },
  CHALLENGE_ATTEMPT_LIMIT_EXCEEDED: {
    "zh-CN": "验证次数过多，请重新生成验证码。",
    en: "Too many verification attempts. Please generate a new verification code.",
  },
  POST_FETCH_FAILED: {
    "zh-CN": "暂时无法读取该帖子，请稍后重试。",
    en: "We couldn't read this post right now. Please try again later.",
  },
  POST_PARSE_FAILED: {
    "zh-CN": "帖子解析失败，请稍后重试。",
    en: "We couldn't parse this post. Please try again later.",
  },
  VERIFICATION_CODE_NOT_FOUND: {
    "zh-CN": "暂时无法确认该帖子与本次验证请求匹配，请检查帖子内容后重试。",
    en: "We couldn't confirm that this post matches the current verification request. Please check the post content and try again.",
  },
  POST_TOO_OLD: {
    "zh-CN": "请使用生成验证码后发布的新帖子进行验证。",
    en: "Please verify with a new post published after the verification code was generated.",
  },
  BINANCE_AUTHOR_MISSING: {
    "zh-CN": "未能识别帖子作者，请稍后重试。",
    en: "We couldn't identify the post author. Please try again later.",
  },
  BINANCE_ACCOUNT_ALREADY_BOUND: {
    "zh-CN": "该币安广场账号已绑定其他 EchoHunt 用户。",
    en: "This Binance Square account is already bound to another EchoHunt user.",
  },
  MONTHLY_REBIND_LIMIT_EXCEEDED: {
    "zh-CN": "本月换绑次数已达上限。",
    en: "You have reached this month's rebind limit.",
  },
  RATE_LIMITED: {
    "zh-CN": "操作太频繁，请稍后再试。",
    en: "Too many requests. Please try again later.",
  },
};

function normalizeBindingLanguage(lang) {
  const raw = String(lang || "").trim().toLowerCase();
  if (raw.startsWith("en")) return "en";
  return "zh-CN";
}

function getBinanceSquareBindingErrorMessage(code, lang = "zh-CN") {
  const entry = BINDING_ERROR_MESSAGES[code];
  if (!entry) return null;
  return entry[normalizeBindingLanguage(lang)] || entry["zh-CN"] || entry.en || null;
}

function bindingError(code, status = 400, message = null) {
  const err = new Error(code);
  err.status = status;
  err.publicMessages = BINDING_ERROR_MESSAGES[code] || null;
  err.publicMessage = message || getBinanceSquareBindingErrorMessage(code, "zh-CN") || code;
  return err;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function serializeBinding(record, monthly = null) {
  if (!record) return null;
  const row = typeof record.toJSON === "function" ? record.toJSON() : record;
  return {
    id: row.id,
    twitterId: row.twitterId,
    twitterUsername: row.twitterUsername || null,
    binanceSquareUid: row.binanceSquareUid,
    binanceUsername: row.binanceUsername,
    binanceDisplayName: row.binanceDisplayName || null,
    binanceAvatar: row.binanceAvatar || null,
    verificationPostId: row.verificationPostId,
    verificationPostUrl: row.verificationPostUrl,
    verifiedAt: row.verifiedAt,
    status: row.status,
    monthlyRebindUsed: monthly?.used ?? undefined,
    monthlyRebindLimit: monthly?.limit ?? undefined,
  };
}

function serializeChallenge(record) {
  if (!record) return null;
  const row = typeof record.toJSON === "function" ? record.toJSON() : record;
  return {
    challengeId: row.id,
    verificationCode: row.verificationCode,
    verificationText: row.verificationText,
    expiresAt: row.expiresAt,
    attemptCount: row.attemptCount || 0,
    maxAttempts: MAX_ATTEMPTS,
  };
}

function generateVerificationCode() {
  const bytes = crypto.randomBytes(VERIFICATION_CODE_LENGTH);
  let suffix = "";
  for (let i = 0; i < VERIFICATION_CODE_LENGTH; i += 1) {
    suffix += VERIFICATION_ALPHABET[bytes[i] % VERIFICATION_ALPHABET.length];
  }
  return `${VERIFICATION_CODE_PREFIX}-${suffix}`;
}

function buildVerificationText(code) {
  return `Verifying my Binance Square account via EchoHunt: ${code}`;
}

function normalizeUrlInput(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^(www\.)?binance\.com\//i.test(text)) return `https://${text}`;
  return text;
}

function isBinanceSquarePostUrl(input) {
  const text = normalizeUrlInput(input);
  if (!text) return false;

  try {
    const url = new URL(text);
    const hostname = url.hostname.toLowerCase();
    const isBinanceHost = hostname === "binance.com" || hostname.endsWith(".binance.com");
    if (!isBinanceHost) return false;

    const parts = url.pathname.split("/").filter(Boolean).map((part) => part.toLowerCase());
    const squareIndex = parts.indexOf("square");
    const postIndex = parts.indexOf("post");
    return squareIndex >= 0 && postIndex > squareIndex;
  } catch (_) {
    return false;
  }
}

function extractBinanceSquarePostId(input) {
  const text = normalizeUrlInput(input);
  if (!text) return null;
  if (/^\d{6,}$/.test(text)) return text;

  const candidates = [text];
  try {
    candidates.push(decodeURIComponent(text));
  } catch (_) {}

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const parts = url.pathname.split("/").filter(Boolean);
      const postIndex = parts.findIndex((part) => part.toLowerCase() === "post");
      if (postIndex >= 0) {
        const postSegment = parts[postIndex + 1] || "";
        const postId = extractBinanceSquarePostId(postSegment);
        if (postId) return postId;
      }
      const fallback = `${url.pathname} ${url.search} ${url.hash}`.match(/\d{6,}/g);
      if (fallback?.length) return fallback[fallback.length - 1];
    } catch (_) {
      const fallback = candidate.match(/\d{6,}/g);
      if (fallback?.length) return fallback[fallback.length - 1];
    }
  }
  return null;
}

function getPostTime(content) {
  const value = content?.firstReleaseTime || content?.latestReleaseTime || content?.createTime || null;
  if (!value) return null;
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getMonthlyWindowShanghai(now = new Date()) {
  const shanghaiNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = shanghaiNow.getUTCFullYear();
  const month = shanghaiNow.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - 8 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - 8 * 60 * 60 * 1000);
  return { start, end };
}

async function getMonthlyRebindUsage(twitterId, options = {}) {
  const { start, end } = getMonthlyWindowShanghai(options.now || new Date());
  const used = await XHuntBinanceSquareBindingEvent.count({
    where: {
      twitterId,
      eventType: "rebind",
      createdAt: { [Op.gte]: start, [Op.lt]: end },
    },
    transaction: options.transaction,
  });
  return { used, limit: MONTHLY_REBIND_LIMIT, windowStart: start, windowEnd: end };
}

async function getBindingStatus(twitterIdentity) {
  if (!twitterIdentity?.twitterId) throw bindingError("TWITTER_ID_REQUIRED", 400, "请先连接 Twitter 账号后再绑定 Binance Square。");
  const [binding, monthly] = await Promise.all([
    XHuntBinanceSquareBinding.findOne({
      where: { twitterId: twitterIdentity.twitterId, status: "active" },
      order: [["verifiedAt", "DESC"]],
    }),
    getMonthlyRebindUsage(twitterIdentity.twitterId),
  ]);

  return {
    bound: !!binding,
    binding: binding ? serializeBinding(binding, monthly) : null,
    monthlyRebindUsed: monthly.used,
    monthlyRebindLimit: monthly.limit,
  };
}

async function createBindingChallenge(twitterIdentity) {
  if (!twitterIdentity?.twitterId) throw bindingError("TWITTER_ID_REQUIRED", 400, "请先连接 Twitter 账号后再绑定 Binance Square。");

  const now = new Date();
  const existing = await XHuntBinanceSquareBindingChallenge.findOne({
    where: {
      twitterId: twitterIdentity.twitterId,
      status: "pending",
      expiresAt: { [Op.gt]: now },
    },
    order: [["createdAt", "DESC"]],
  });
  if (existing) {
    const monthly = await getMonthlyRebindUsage(twitterIdentity.twitterId);
    return {
      ...serializeChallenge(existing),
      monthlyRebindUsed: monthly.used,
      monthlyRebindLimit: monthly.limit,
    };
  }

  let code = generateVerificationCode();
  for (let i = 0; i < 5; i += 1) {
    const count = await XHuntBinanceSquareBindingChallenge.count({ where: { verificationCode: code } });
    if (count === 0) break;
    code = generateVerificationCode();
  }

  const challenge = await XHuntBinanceSquareBindingChallenge.create({
    twitterId: twitterIdentity.twitterId,
    twitterUsername: twitterIdentity.username || null,
    xhuntUserId: twitterIdentity.xhuntUserId || null,
    authCenterUserId: twitterIdentity.authCenterUserId || null,
    verificationCode: code,
    verificationText: buildVerificationText(code),
    status: "pending",
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MINUTES * 60 * 1000),
  });

  const monthly = await getMonthlyRebindUsage(twitterIdentity.twitterId);
  return {
    ...serializeChallenge(challenge),
    monthlyRebindUsed: monthly.used,
    monthlyRebindLimit: monthly.limit,
  };
}

async function updateChallengeFailure(challenge, code, message, extras = {}) {
  if (!challenge) return;
  const nextStatus = code === "CHALLENGE_EXPIRED" ? "expired" : challenge.attemptCount + 1 >= MAX_ATTEMPTS ? "failed" : challenge.status;
  await challenge.update({
    status: nextStatus,
    lastErrorCode: code,
    lastErrorMessage: message,
    ...extras,
  }).catch(() => {});
}

function buildAuthorFromContent(content, profile = null) {
  return {
    binanceSquareUid: profile?.squareUid || content?.squareUid || null,
    binanceUsername: profile?.username || content?.username || null,
    binanceDisplayName: profile?.displayName || content?.displayName || content?.username || null,
    binanceAvatar: profile?.avatar || content?.avatar || null,
    rawAuthorData: profile || {
      squareUid: content?.squareUid || null,
      username: content?.username || null,
      displayName: content?.displayName || null,
      avatar: content?.avatar || null,
      authorVerificationType: content?.authorVerificationType || null,
      roleCode: content?.roleCode || null,
    },
  };
}

function normalizePostDetailPayload(detail) {
  if (!detail || typeof detail !== "object") return null;
  if (detail.id) return detail;
  if (detail.content?.id) return detail.content;
  if (detail.post?.id) return detail.post;
  if (detail.data?.id) return detail.data;
  return detail;
}

async function verifyBindingPost(twitterIdentity, { challengeId, postUrl }) {
  if (!twitterIdentity?.twitterId) throw bindingError("TWITTER_ID_REQUIRED", 400, "请先连接 Twitter 账号后再绑定 Binance Square。");
  if (!isBinanceSquarePostUrl(postUrl)) throw bindingError("INVALID_POST_URL", 400, "请粘贴 Binance Square 帖子链接。");
  const postId = extractBinanceSquarePostId(postUrl);
  if (!postId) throw bindingError("INVALID_POST_URL", 400, "帖子链接格式不正确。");

  const challenge = await XHuntBinanceSquareBindingChallenge.findOne({
    where: {
      id: challengeId,
      twitterId: twitterIdentity.twitterId,
    },
  });
  if (!challenge) throw bindingError("CHALLENGE_NOT_FOUND", 404, "验证码不存在，请重新生成。");
  if (challenge.status !== "pending") throw bindingError("CHALLENGE_NOT_PENDING", 400, "验证码状态已失效，请重新生成。");
  if (challenge.expiresAt <= new Date()) {
    await updateChallengeFailure(challenge, "CHALLENGE_EXPIRED", "验证码已过期，请重新生成。", { lastPostUrl: postUrl, lastPostId: postId });
    throw bindingError("CHALLENGE_EXPIRED", 400, "验证码已过期，请重新生成。");
  }
  if ((challenge.attemptCount || 0) >= MAX_ATTEMPTS) {
    throw bindingError("CHALLENGE_ATTEMPT_LIMIT_EXCEEDED", 429, "验证次数过多，请重新生成验证码。");
  }

  await challenge.increment("attemptCount");
  await challenge.update({ lastAttemptAt: new Date(), lastPostUrl: postUrl, lastPostId: postId });
  await challenge.reload();

  let content = null;
  let parsedPost = null;
  let author = null;
  try {
    const detail = await apiClient.fetchPostDetail(postId);
    content = normalizePostDetailPayload(detail);
    if (!content?.id) throw bindingError("POST_FETCH_FAILED", 502, "暂时无法读取该帖子，请稍后重试。");

    parsedPost = postParser.parsePostContent(content);
    if (!parsedPost?.postId) throw bindingError("POST_PARSE_FAILED", 502, "帖子解析失败，请稍后重试。");

    const postText = normalizeText([parsedPost.title, parsedPost.contentText, content?.bodyTextOnly].filter(Boolean).join(" "));
    if (!postText.toUpperCase().includes(String(challenge.verificationCode).toUpperCase())) {
      throw bindingError("VERIFICATION_CODE_NOT_FOUND", 400, "暂时无法确认该帖子与本次验证请求匹配，请检查帖子内容后重试。");
    }

    const postTime = getPostTime(content);
    if (postTime && postTime.getTime() < new Date(challenge.createdAt).getTime() - POST_TIME_SKEW_MS) {
      throw bindingError("POST_TOO_OLD", 400, "请使用生成验证码后发布的新帖子进行验证。");
    }

    let profile = null;
    if (content.username) {
      profile = await apiClient.fetchUserProfile(content.username).catch((error) => {
        console.warn(`[BinanceSquareBinding] fetch profile failed username=${content.username}:`, error.message);
        return null;
      });
    }
    author = buildAuthorFromContent(content, profile);
    if (!author.binanceSquareUid || !author.binanceUsername) {
      throw bindingError("BINANCE_AUTHOR_MISSING", 502, "未能识别帖子作者，请稍后重试。");
    }
  } catch (error) {
    const code = error.message || "POST_FETCH_FAILED";
    await updateChallengeFailure(challenge, code, error.publicMessage || error.message, { lastPostUrl: postUrl, lastPostId: postId });
    if (error.status) throw error;
    throw bindingError("POST_FETCH_FAILED", 502, "暂时无法读取该帖子，请稍后重试。");
  }

  const result = await pgInstance.transaction(async (transaction) => {
    const currentBinding = await XHuntBinanceSquareBinding.findOne({
      where: { twitterId: twitterIdentity.twitterId, status: "active" },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    const latestHistoricalBinding = await XHuntBinanceSquareBinding.findOne({
      where: { twitterId: twitterIdentity.twitterId },
      order: [["verifiedAt", "DESC"]],
      transaction,
    });
    const occupiedBinding = await XHuntBinanceSquareBinding.findOne({
      where: {
        binanceSquareUid: author.binanceSquareUid,
        status: "active",
        twitterId: { [Op.ne]: twitterIdentity.twitterId },
      },
      transaction,
    });
    const monthly = await getMonthlyRebindUsage(twitterIdentity.twitterId, { transaction });

    if (occupiedBinding) {
      throw bindingError("BINANCE_ACCOUNT_ALREADY_BOUND", 409, "该 Binance Square 账号已绑定其他 EchoHunt 用户。");
    }

    if (currentBinding && currentBinding.binanceSquareUid === author.binanceSquareUid) {
      await currentBinding.update(
        {
          twitterUsername: twitterIdentity.username || currentBinding.twitterUsername,
          xhuntUserId: twitterIdentity.xhuntUserId || currentBinding.xhuntUserId,
          authCenterUserId: twitterIdentity.authCenterUserId || currentBinding.authCenterUserId,
          binanceUsername: author.binanceUsername,
          binanceDisplayName: author.binanceDisplayName,
          binanceAvatar: author.binanceAvatar,
          verificationPostId: String(postId),
          verificationPostUrl: content.webLink || parsedPost.sourceUrl || postUrl,
          verificationCode: challenge.verificationCode,
          rawAuthorData: author.rawAuthorData,
          rawPostData: content,
        },
        { transaction }
      );
      await challenge.update({ status: "verified", verifiedAt: new Date(), lastErrorCode: null, lastErrorMessage: null }, { transaction });
      return { binding: currentBinding, monthly, idempotent: true };
    }

    const hasHistoricalBinding = !!latestHistoricalBinding;
    const eventType = hasHistoricalBinding ? "rebind" : "bind";
    if (eventType === "rebind" && monthly.used >= MONTHLY_REBIND_LIMIT) {
      throw bindingError("MONTHLY_REBIND_LIMIT_EXCEEDED", 429, "本月换绑次数已达上限。");
    }

    if (currentBinding) {
      await currentBinding.update({ status: "revoked", revokedAt: new Date() }, { transaction });
    }

    const binding = await XHuntBinanceSquareBinding.create(
      {
        twitterId: twitterIdentity.twitterId,
        twitterUsername: twitterIdentity.username || null,
        xhuntUserId: twitterIdentity.xhuntUserId || null,
        authCenterUserId: twitterIdentity.authCenterUserId || null,
        binanceSquareUid: author.binanceSquareUid,
        binanceUsername: author.binanceUsername,
        binanceDisplayName: author.binanceDisplayName,
        binanceAvatar: author.binanceAvatar,
        verificationPostId: String(postId),
        verificationPostUrl: content.webLink || parsedPost.sourceUrl || postUrl,
        verificationCode: challenge.verificationCode,
        verifiedAt: new Date(),
        status: "active",
        rawAuthorData: author.rawAuthorData,
        rawPostData: content,
      },
      { transaction }
    );

    await challenge.update({ status: "verified", verifiedAt: new Date(), lastErrorCode: null, lastErrorMessage: null }, { transaction });
    await XHuntBinanceSquareBindingEvent.create(
      {
        twitterId: twitterIdentity.twitterId,
        eventType,
        fromBinanceSquareUid: currentBinding?.binanceSquareUid || latestHistoricalBinding?.binanceSquareUid || null,
        toBinanceSquareUid: author.binanceSquareUid,
        bindingId: binding.id,
        challengeId: challenge.id,
        metadata: {
          postId: String(postId),
          binanceUsername: author.binanceUsername,
          twitterUsername: twitterIdentity.username || null,
        },
      },
      { transaction }
    );

    return {
      binding,
      monthly: eventType === "rebind" ? { ...monthly, used: monthly.used + 1 } : monthly,
      eventType,
      idempotent: false,
    };
  });

  return {
    bound: true,
    binding: serializeBinding(result.binding, result.monthly),
    eventType: result.eventType || null,
    idempotent: !!result.idempotent,
  };
}

async function revokeBinding(twitterIdentity) {
  if (!twitterIdentity?.twitterId) throw bindingError("TWITTER_ID_REQUIRED", 400, "请先连接 Twitter 账号后再绑定 Binance Square。");
  const result = await pgInstance.transaction(async (transaction) => {
    const binding = await XHuntBinanceSquareBinding.findOne({
      where: { twitterId: twitterIdentity.twitterId, status: "active" },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!binding) return { revoked: false, binding: null };
    await binding.update({ status: "revoked", revokedAt: new Date() }, { transaction });
    await XHuntBinanceSquareBindingEvent.create(
      {
        twitterId: twitterIdentity.twitterId,
        eventType: "unbind",
        fromBinanceSquareUid: binding.binanceSquareUid,
        toBinanceSquareUid: null,
        bindingId: binding.id,
        metadata: { binanceUsername: binding.binanceUsername },
      },
      { transaction }
    );
    return { revoked: true, binding };
  });
  const monthly = await getMonthlyRebindUsage(twitterIdentity.twitterId);
  return {
    revoked: result.revoked,
    binding: result.binding ? serializeBinding(result.binding, monthly) : null,
    monthlyRebindUsed: monthly.used,
    monthlyRebindLimit: monthly.limit,
  };
}

module.exports = {
  createBindingChallenge,
  getBindingStatus,
  verifyBindingPost,
  revokeBinding,
  extractBinanceSquarePostId,
  getMonthlyRebindUsage,
  getBinanceSquareBindingErrorMessage,
  BINDING_ERROR_MESSAGES,
  MONTHLY_REBIND_LIMIT,
};
