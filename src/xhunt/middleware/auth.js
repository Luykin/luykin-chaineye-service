// middleware/auth.js

const jwt = require("jsonwebtoken");
const { XHuntUserToken, XHuntUser } = require("../../models/postgres-start");

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

    // 指纹/设备识别验证
    if (!tokenRecord?.fingerprint) {
      // 指纹不匹配时，撤销当前用户的所有 token（强制重新登录）
      try {
        await XHuntUserToken.update(
          { isRevoked: true },
          {
            where: {
              userId: tokenRecord.userId,
              isRevoked: false,
            },
          }
        );
        console.log(
          `用户 ${tokenRecord.userId} 因指纹不匹配被强制退出，已撤销所有 token`
        );
      } catch (revokeError) {
        console.error("撤销用户 token 失败:", revokeError);
      }

      return res.status(419).json({ error: "DEVICE_MISMATCH_LOGOUT" });
    }

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
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return next(); // 无 token 直接放行
  }

  await verifyToken(token, req, res, next);
}

/**
 * 从查询参数读取 token 的认证中间件（用于 SSE，因为 EventSource 不支持自定义 headers）
 */
async function authenticateTokenFromQuery(req, res, next) {
  const token = req.query.token;

  if (!token) {
    return res.status(401).json({ error: "TOKEN_REQUIRED" });
  }

  await verifyToken(token, req, res, next);
}

/**
 * 可选从查询参数读取 token 的认证中间件（用于 SSE）
 */
async function authenticateTokenFromQueryOptional(req, res, next) {
  const token = req.query.token;

  if (!token) {
    return next(); // 无 token 直接放行
  }

  await verifyToken(token, req, res, next);
}

module.exports = {
  authenticateToken,
  authenticateTokenOptional,
  authenticateTokenFromQuery,
  authenticateTokenFromQueryOptional,
};
