// middleware/web-auth.js - Web 用户认证中间件

const jwt = require("jsonwebtoken");
const {
  XHuntWebUserToken,
  XHuntWebUser,
} = require("../../models/postgres-start");

const WEB_AUTH_VERIFIED_FLAG = Symbol.for("xhunt.web.auth.verified");

/**
 * 验证 Token 并获取用户信息
 * @param {string} token - JWT Token
 * @returns {Promise<{user: Object, tokenRecord: Object, decoded: Object}>}
 */
async function verifyWebToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  const tokenRecord = await XHuntWebUserToken.findOne({
    where: {
      id: decoded.tokenId,
      isRevoked: false,
    },
    include: [
      {
        model: XHuntWebUser,
        as: "user",
      },
    ],
  });

  if (!tokenRecord) {
    throw new Error("TOKEN_NOT_FOUND");
  }

  if (tokenRecord.tokenExpiry <= new Date()) {
    throw new Error("TOKEN_EXPIRED");
  }

  // 验证 Token 中的 siteSource 与记录一致
  if (decoded.siteSource && decoded.siteSource !== tokenRecord.siteSource) {
    throw new Error("TOKEN_SITE_MISMATCH");
  }

  return { user: tokenRecord.user, tokenRecord, decoded };
}

/**
 * Web 用户认证中间件
 * 从 Header 读取 Token，验证站点来源
 * @param {Object} options - 配置选项
 * @param {boolean} options.requireSiteMatch - 是否要求验证 siteSource 参数匹配，默认 true
 */
function authenticateWebToken(options = {}) {
  const { requireSiteMatch = true } = options;

  return async (req, res, next) => {
    // 已认证则直接放行
    if (req[WEB_AUTH_VERIFIED_FLAG]) {
      return next();
    }

    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "TOKEN_REQUIRED" });
    }

    try {
      const { user, tokenRecord, decoded } = await verifyWebToken(token);

      // 如果需要验证站点匹配，检查 query/body 中的 siteSource
      if (requireSiteMatch) {
        const requestedSite =
          req.query.siteSource || req.body?.siteSource || req.headers["x-site-source"];

        if (requestedSite && decoded.siteSource !== requestedSite) {
          return res.status(403).json({
            error: "TOKEN_SITE_MISMATCH",
            message: "该 Token 不属于当前站点",
            tokenSite: decoded.siteSource,
            requestedSite,
          });
        }
      }

      // 更新最后使用时间（异步，不阻塞）
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

      if (!tokenRecord.lastUsed || tokenRecord.lastUsed < fiveMinutesAgo) {
        setImmediate(() => {
          tokenRecord.update({ lastUsed: now }).catch((error) => {
            console.error("Failed to update web token lastUsed:", error);
          });
        });
      }

      // 挂载用户信息
      req.user = user;
      req.tokenRecord = tokenRecord;
      req.tokenPayload = decoded;
      req[WEB_AUTH_VERIFIED_FLAG] = true;

      next();
    } catch (error) {
      if (error.message === "TOKEN_NOT_FOUND") {
        return res.status(419).json({ error: "TOKEN_INVALID" });
      }
      if (error.message === "TOKEN_EXPIRED") {
        return res.status(419).json({ error: "TOKEN_EXPIRED" });
      }
      if (error.message === "TOKEN_SITE_MISMATCH") {
        return res.status(403).json({
          error: "TOKEN_SITE_MISMATCH",
          message: "Token 站点信息不匹配",
        });
      }
      if (error.name === "JsonWebTokenError") {
        return res.status(419).json({ error: "TOKEN_INVALID" });
      }
      if (error.name === "TokenExpiredError") {
        return res.status(419).json({ error: "TOKEN_EXPIRED" });
      }
      console.error("Web auth middleware error:", error);
      res.status(500).json({ error: "认证失败" });
    }
  };
}

/**
 * 可选 Web 用户认证中间件
 * 带 token 就解析，没带就 pass
 */
async function authenticateWebTokenOptional(req, res, next) {
  if (req[WEB_AUTH_VERIFIED_FLAG]) {
    return next();
  }

  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return next();
  }

  try {
    const { user, tokenRecord, decoded } = await verifyWebToken(token);

    req.user = user;
    req.tokenRecord = tokenRecord;
    req.tokenPayload = decoded;
    req[WEB_AUTH_VERIFIED_FLAG] = true;

    next();
  } catch (error) {
    // 可选认证，失败也放行
    next();
  }
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
  let cleaned = token.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned;
}

/**
 * 从查询参数读取 token 的认证中间件（用于 SSE）
 */
async function authenticateWebTokenFromQuery(req, res, next) {
  if (req[WEB_AUTH_VERIFIED_FLAG]) {
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

  try {
    const { user, tokenRecord, decoded } = await verifyWebToken(token);

    // 验证站点匹配
    const requestedSite = req.query.siteSource;
    if (requestedSite && decoded.siteSource !== requestedSite) {
      return res.status(403).json({
        error: "TOKEN_SITE_MISMATCH",
        message: "该 Token 不属于当前站点",
      });
    }

    req.user = user;
    req.tokenRecord = tokenRecord;
    req.tokenPayload = decoded;
    req[WEB_AUTH_VERIFIED_FLAG] = true;

    next();
  } catch (error) {
    if (error.message === "TOKEN_NOT_FOUND") {
      return res.status(419).json({ error: "TOKEN_INVALID" });
    }
    if (error.message === "TOKEN_EXPIRED") {
      return res.status(419).json({ error: "TOKEN_EXPIRED" });
    }
    if (error.message === "TOKEN_SITE_MISMATCH") {
      return res.status(403).json({ error: "TOKEN_SITE_MISMATCH" });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(419).json({ error: "TOKEN_INVALID" });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(419).json({ error: "TOKEN_EXPIRED" });
    }
    console.error("Web auth from query error:", error);
    res.status(500).json({ error: "认证失败" });
  }
}

module.exports = {
  authenticateWebToken,
  authenticateWebTokenOptional,
  authenticateWebTokenFromQuery,
  verifyWebToken,
};
