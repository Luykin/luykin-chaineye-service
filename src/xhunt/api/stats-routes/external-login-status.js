const express = require("express");
const crypto = require("crypto");
const { Op, fn, col, where } = require("sequelize");
const {
  DailyActiveUser,
  XHuntUser,
  CollectorClientToken,
} = require("../../../models/postgres-start");

const router = express.Router();

const DEFAULT_MAX_BATCH_SIZE = 500;

function getProvidedSecret(req) {
  const authorization = String(req.get("authorization") || "").trim();
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return String(req.get("x-collector-client-token") || "").trim();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function requireExternalStatsSecret(req, res, next) {
  const providedSecret = getProvidedSecret(req);
  if (!providedSecret) {
    return res.status(401).json({
      success: false,
      error: "UNAUTHORIZED",
      message: "缺少客户端 token",
    });
  }

  try {
    const row = await CollectorClientToken.findOne({
      where: {
        tokenHash: hashToken(providedSecret),
        isActive: true,
      },
    });

    if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
        message: "客户端 token 不正确或已过期",
      });
    }

    row.lastUsedAt = new Date();
    row.save().catch((error) => {
      console.warn("[external-login-status] 更新 token lastUsedAt 失败:", error.message);
    });

    req.collectorClient = {
      id: String(row.id),
      name: row.name,
      tokenPrefix: row.tokenPrefix,
    };

    next();
  } catch (error) {
    console.error("[external-login-status] token 校验失败:", error);
    return res.status(500).json({
      success: false,
      error: "TOKEN_VALIDATE_FAILED",
      message: "客户端 token 校验失败",
    });
  }
}

function normalizeIdentifier(value) {
  let normalized = String(value || "").trim();
  if (!normalized) return "";

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized);
      const pathParts = url.pathname.split("/").filter(Boolean);
      if (
        /(?:^|\.)x\.com$/i.test(url.hostname) ||
        /(?:^|\.)twitter\.com$/i.test(url.hostname)
      ) {
        normalized = pathParts[0] || normalized;
      }
    } catch (_) {
      // 保留原值，按普通 identifier 处理。
    }
  }

  return normalized.replace(/^@+/, "").trim();
}

function normalizeTwitterId(value) {
  return String(value || "").trim().replace(/^tw:/i, "").trim();
}

function normalizeUsername(value) {
  const username = normalizeIdentifier(value).replace(/^username:/i, "").trim();
  if (/^fp:/i.test(username)) return "";
  return username;
}

function isLikelyTwitterId(value) {
  return /^[1-9]\d{4,24}$/.test(String(value || "").trim());
}

function buildLookupEntry(rawInput, index) {
  const entry = {
    index,
    input: rawInput,
    identifier: "",
    username: "",
    usernameLower: "",
    twitterId: "",
    candidateKeys: new Set(),
  };

  if (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) {
    const twitterId = normalizeTwitterId(rawInput.twitterId || rawInput.twId || "");
    const username = normalizeUsername(rawInput.username || rawInput.screenName || "");
    const identifier = normalizeIdentifier(
      rawInput.identifier || rawInput.userId || rawInput.id || ""
    );

    entry.identifier = identifier || username || twitterId;
    entry.username = username;
    entry.twitterId = twitterId;

    if (!entry.twitterId && identifier && /^tw:/i.test(String(identifier))) {
      entry.twitterId = normalizeTwitterId(identifier);
    } else if (!entry.twitterId && isLikelyTwitterId(identifier)) {
      entry.twitterId = identifier;
    }

    if (
      !entry.username &&
      identifier &&
      !/^tw:/i.test(String(identifier)) &&
      !isLikelyTwitterId(identifier)
    ) {
      entry.username = normalizeUsername(identifier);
    }
  } else {
    const identifier = normalizeIdentifier(rawInput);
    entry.identifier = identifier;
    if (/^tw:/i.test(String(rawInput || "").trim())) {
      entry.twitterId = normalizeTwitterId(rawInput);
    } else if (isLikelyTwitterId(identifier)) {
      entry.twitterId = identifier;
    } else {
      entry.username = normalizeUsername(identifier);
    }
  }

  if (entry.twitterId) {
    entry.candidateKeys.add(`tw:${entry.twitterId}`);
  }

  if (entry.username) {
    entry.usernameLower = entry.username.toLowerCase();
    entry.candidateKeys.add(entry.username);
  }

  if (entry.identifier && !/^fp:/i.test(entry.identifier)) {
    entry.candidateKeys.add(entry.identifier);
  }

  return entry;
}

function collectLookupInputs(req) {
  const body = req.body || {};
  const inputs = [];

  if (Array.isArray(body.identifiers)) inputs.push(...body.identifiers);
  if (Array.isArray(body.users)) inputs.push(...body.users);
  if (Array.isArray(body.usernames)) {
    inputs.push(...body.usernames.map((username) => ({ username })));
  }
  if (Array.isArray(body.twitterIds)) {
    inputs.push(...body.twitterIds.map((twitterId) => ({ twitterId })));
  }

  if (
    body.identifier ||
    body.userId ||
    body.username ||
    body.twitterId ||
    body.twId
  ) {
    inputs.push({
      identifier: body.identifier || body.userId,
      username: body.username,
      twitterId: body.twitterId || body.twId,
    });
  }

  return inputs;
}

async function enrichCandidateKeys(entries) {
  const twitterIds = [
    ...new Set(entries.map((entry) => entry.twitterId).filter(Boolean)),
  ];
  const usernameLowers = [
    ...new Set(entries.map((entry) => entry.usernameLower).filter(Boolean)),
  ];

  const userWhere = [];
  if (twitterIds.length > 0) {
    userWhere.push({ twitterId: { [Op.in]: twitterIds } });
  }
  if (usernameLowers.length > 0) {
    userWhere.push(where(fn("LOWER", col("username")), { [Op.in]: usernameLowers }));
  }

  if (userWhere.length === 0) return;

  const users = await XHuntUser.findAll({
    attributes: ["twitterId", "username"],
    where: { [Op.or]: userWhere },
    raw: true,
  });

  const usersByTwitterId = new Map();
  const usersByUsernameLower = new Map();
  for (const user of users) {
    const twitterId = String(user.twitterId || "").trim();
    const username = String(user.username || "").trim();
    if (twitterId) usersByTwitterId.set(twitterId, user);
    if (username) usersByUsernameLower.set(username.toLowerCase(), user);
  }

  for (const entry of entries) {
    const relatedUsers = [
      entry.twitterId ? usersByTwitterId.get(entry.twitterId) : null,
      entry.usernameLower ? usersByUsernameLower.get(entry.usernameLower) : null,
    ].filter(Boolean);

    for (const user of relatedUsers) {
      const twitterId = String(user.twitterId || "").trim();
      const username = String(user.username || "").trim();
      if (twitterId) entry.candidateKeys.add(`tw:${twitterId}`);
      if (username) entry.candidateKeys.add(username);
    }
  }
}

async function queryLoginStatus(rawInputs) {
  const maxBatchSize = parseInt(
    process.env.XHUNT_LOGIN_STATUS_MAX_BATCH_SIZE || String(DEFAULT_MAX_BATCH_SIZE),
    10
  );
  const safeMaxBatchSize =
    Number.isFinite(maxBatchSize) && maxBatchSize > 0
      ? maxBatchSize
      : DEFAULT_MAX_BATCH_SIZE;

  if (!Array.isArray(rawInputs) || rawInputs.length === 0) {
    const error = new Error("缺少查询参数：请传 identifier/username/twitterId 或 identifiers/users 数组");
    error.status = 400;
    error.code = "MISSING_LOOKUP_INPUT";
    throw error;
  }

  if (rawInputs.length > safeMaxBatchSize) {
    const error = new Error(`批量查询最多支持 ${safeMaxBatchSize} 个用户`);
    error.status = 400;
    error.code = "BATCH_TOO_LARGE";
    throw error;
  }

  const entries = rawInputs.map((input, index) => buildLookupEntry(input, index));
  const validEntries = entries.filter(
    (entry) => entry.identifier || entry.username || entry.twitterId
  );

  if (validEntries.length === 0) {
    const error = new Error("没有有效的查询对象");
    error.status = 400;
    error.code = "EMPTY_LOOKUP_INPUT";
    throw error;
  }

  await enrichCandidateKeys(validEntries);

  const allCandidateKeys = [
    ...new Set(
      validEntries.flatMap((entry) =>
        Array.from(entry.candidateKeys).map((key) => String(key || "").trim()).filter(Boolean)
      )
    ),
  ];

  const activeByKey = new Map();
  if (allCandidateKeys.length > 0) {
    const rows = await DailyActiveUser.findAll({
      attributes: [
        "userId",
        [fn("MIN", col("date")), "firstActiveDate"],
        [fn("MAX", col("date")), "lastActiveDate"],
      ],
      where: { userId: { [Op.in]: allCandidateKeys } },
      group: ["userId"],
      raw: true,
    });
    for (const row of rows) {
      if (row.userId) {
        activeByKey.set(String(row.userId), {
          firstActiveDate: row.firstActiveDate || null,
          lastActiveDate: row.lastActiveDate || null,
        });
      }
    }
  }

  return entries.map((entry) => {
    const matchedActiveRecords = Array.from(entry.candidateKeys)
      .map((key) => activeByKey.get(String(key)))
      .filter(Boolean);
    const hasLoggedInXhunt = matchedActiveRecords.length > 0;
    const firstActiveDate = matchedActiveRecords
      .map((record) => record.firstActiveDate)
      .filter(Boolean)
      .sort()[0] || null;
    const lastActiveDate = matchedActiveRecords
      .map((record) => record.lastActiveDate)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;

    return {
      index: entry.index,
      input: entry.input,
      identifier: entry.identifier || entry.username || entry.twitterId || "",
      username: entry.username || null,
      twitterId: entry.twitterId || null,
      hasLoggedInXhunt,
      firstActiveDate,
      lastActiveDate,
      error: entry.identifier || entry.username || entry.twitterId ? null : "EMPTY_IDENTIFIER",
    };
  });
}

async function handleLoginStatusRequest(req, res) {
  try {
    const inputs = collectLookupInputs(req);
    const results = await queryLoginStatus(inputs);

    return res.json({
      success: true,
      data: {
        count: results.length,
        result: results.length === 1 ? results[0] : null,
        results,
      },
    });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      console.error("[external-login-status] 查询失败:", error);
    }
    return res.status(status).json({
      success: false,
      error: error.code || "LOGIN_STATUS_QUERY_FAILED",
      message: error.message || "查询 XHunt 登录状态失败",
    });
  }
}

/**
 * 外部查询用户是否曾经登录/活跃过 XHunt。
 *
 * Header:
 *   x-collector-client-token: ${CollectorClientToken 明文 token}
 *   // 或 Authorization: Bearer ${CollectorClientToken 明文 token}
 *
 * Token 复用管理后台 Tampermonkey token 管理生成的 CollectorClientToken。
 *
 * POST /api/xhunt/stats/external/login-status
 * body:
 *   { "identifier": "username_or_twitter_id" }
 *   { "identifiers": ["username", "1234567890"] }
 *   { "users": [{ "username": "alice" }, { "twitterId": "1234567890" }] }
 */
router.post(
  "/external/login-status",
  requireExternalStatsSecret,
  handleLoginStatusRequest
);

module.exports = router;
