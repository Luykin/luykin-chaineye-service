// middleware/auth.js

const jwt = require("jsonwebtoken");
const { XHuntUserToken, XHuntUser } = require("../../models/postgres-start");
const AUTH_VERIFIED_FLAG = Symbol.for("xhunt.auth.verified");

function enforceV2TwitterIdConsistency(req, res) {
  const securityContext = req.securityContext;
  if (securityContext?.signatureVersion !== "v2") {
    return true;
  }

  const signedTwId = String(securityContext.twId || "").trim();
  const tokenTwId = String(req.user?.twitterId || "").trim();

  // 历史用户数据可能存在 twitterId 为空，初期只记录不阻断，避免误伤。
  if (!tokenTwId) {
    console.warn("[Auth] v2 token twitterId missing, skip strict match:", {
      userId: req.user?.id,
      signedTwId,
    });
    return true;
  }

  if (signedTwId && signedTwId !== tokenTwId) {
    console.error("[Auth] v2 twitterId mismatch:", {
      signedTwId,
      tokenTwId,
      userId: req.user?.id,
    });
    res.status(403).json({ error: "TWITTER_ID_MISMATCH" });
    return false;
  }

  return true;
}

/**
 * 核心认证逻辑（提取为私有函数）
 */
async function verifyToken(token, req, res, next) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const tokenRecord = await XHuntUserToken.findOne({
      where: {
        id: decoded.tokenId,
        isRevoked: false,
      },
      include: [
        {
          model: XHuntUser,
          as: "user",
        },
      ],
    });

    if (!tokenRecord || tokenRecord.tokenExpiry <= new Date()) {
      return res.status(419).json({ error: "TOKEN_EXPIRED" });
    }

    // 新版 v2 客户端不再上传 x-device-fingerprint，登录时创建的 token
    // fingerprint 可能为空。token 真实性已经由 JWT + token 记录状态 + v2 签名链路保证，
    // 因此不能再把 tokenRecord.fingerprint 为空视为设备不匹配，否则登录后 /me 等接口会
    // 立即返回 DEVICE_MISMATCH_LOGOUT。

    // 更新最后使用时间（异步更新不影响流程）
    // 🆕 优化：只有距离上次更新超过5分钟才更新 lastUsed
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    if (!tokenRecord.lastUsed || tokenRecord.lastUsed < fiveMinutesAgo) {
      // 异步更新，不阻塞请求流程
      setImmediate(() => {
        tokenRecord.update({ lastUsed: now }).catch((error) => {
          console.error("Failed to update token lastUsed:", error);
        });
      });
    }

    // 挂载用户信息到请求对象
    req.user = tokenRecord.user;
    req.tokenRecord = tokenRecord;

    if (!enforceV2TwitterIdConsistency(req, res)) {
      return;
    }

    // 幂等标记：本次请求已完成认证
    req[AUTH_VERIFIED_FLAG] = true;

    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(419).json({ error: "TOKEN_INVALID" });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(419).json({ error: "TOKEN_EXPIRED" });
    }
    console.error("Auth middleware error:", error);
    res.status(500).json({ error: "认证失败" });
  }
}

/**
 * 强制登录中间件
 */
async function authenticateToken(req, res, next) {
  // 已认证则直接放行（避免重复执行）
  if (req[AUTH_VERIFIED_FLAG]) {
    return next();
  }
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "TOKEN_REQUIRED" });
  }

  await verifyToken(token, req, res, next);
}

/**
 * 可选登录中间件（带 token 就解析，没带就 pass）
 */
async function authenticateTokenOptional(req, res, next) {
  // 已认证则直接放行（避免重复执行）
  if (req[AUTH_VERIFIED_FLAG]) {
    return next();
  }
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return next(); // 无 token 直接放行
  }

  await verifyToken(token, req, res, next);
}

/**
 * 清理 token（去掉两端的引号和空格）
 * @param {string} token - 原始 token
 * @returns {string} 清理后的 token
 */
function cleanToken(token) {
  if (!token || typeof token !== "string") {
    return token;
  }
  // 去掉两端空格
  let cleaned = token.trim();
  // 去掉两端的引号（单引号或双引号）
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned;
}

/**
 * 从查询参数读取 token 的认证中间件（用于 SSE，因为 EventSource 不支持自定义 headers）
 */
async function authenticateTokenFromQuery(req, res, next) {
  // 已认证则直接放行（避免重复执行）
  if (req[AUTH_VERIFIED_FLAG]) {
    return next();
  }
  const rawToken = req.query.token;

  if (!rawToken) {
    return res.status(401).json({ error: "TOKEN_REQUIRED" });
  }

  const token = cleanToken(rawToken);

  if (!token) {
    return res.status(401).json({ error: "TOKEN_REQUIRED" });
  }

  await verifyToken(token, req, res, next);
}

/**
 * 可选从查询参数读取 token 的认证中间件（用于 SSE）
 */
async function authenticateTokenFromQueryOptional(req, res, next) {
  // 已认证则直接放行（避免重复执行）
  if (req[AUTH_VERIFIED_FLAG]) {
    return next();
  }
  const rawToken = req.query.token;

  if (!rawToken) {
    return next(); // 无 token 直接放行
  }

  const token = cleanToken(rawToken);

  if (!token) {
    return next(); // 清理后为空，也直接放行
  }

  await verifyToken(token, req, res, next);
}

module.exports = {
  authenticateToken,
  authenticateTokenOptional,
  authenticateTokenFromQuery,
  authenticateTokenFromQueryOptional,
};
