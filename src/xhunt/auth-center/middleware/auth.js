const jwt = require("jsonwebtoken");
const {
  AuthCenterXhuntSession,
  AuthCenterXhuntUser,
  AuthCenterXhuntIdentity,
} = require("../../../models/postgres-start");
const { buildPublicUser } = require("../services/display-name");

const AUTH_CENTER_VERIFIED_FLAG = Symbol.for("xhunt.auth.center.verified");

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required for auth center");
  }
  return process.env.JWT_SECRET;
}

async function verifyAuthCenterToken(token) {
  const decoded = jwt.verify(token, getJwtSecret());
  const session = await AuthCenterXhuntSession.findOne({
    where: {
      id: decoded.sid,
      revokedAt: null,
    },
    include: [{ model: AuthCenterXhuntUser, as: "user" }],
  });

  if (!session || session.expiresAt <= new Date()) {
    const err = new Error("TOKEN_EXPIRED");
    err.status = 419;
    throw err;
  }

  if (!session.user || session.user.status !== "active") {
    const err = new Error("USER_DISABLED");
    err.status = 403;
    throw err;
  }

  if (session.accessTokenJti && decoded.jti && session.accessTokenJti !== decoded.jti) {
    const err = new Error("TOKEN_REPLACED");
    err.status = 419;
    throw err;
  }

  const identities = await AuthCenterXhuntIdentity.findAll({
    where: { userId: session.userId },
    order: [["createdAt", "ASC"]],
  });

  return {
    decoded,
    session,
    user: session.user,
    identities,
    publicUser: buildPublicUser(session.user, identities),
  };
}

function authenticateAuthCenterToken(options = {}) {
  const { optional = false } = options;

  return async (req, res, next) => {
    if (req[AUTH_CENTER_VERIFIED_FLAG]) {
      return next();
    }

    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      if (optional) return next();
      return res.status(401).json({ error: "TOKEN_REQUIRED" });
    }

    try {
      const result = await verifyAuthCenterToken(token);
      req.authCenter = result;
      req.user = result.user;
      if (req.xhuntWeb) {
        req.xhuntWeb.authCenterUserId = result.user?.id || null;
        req.xhuntWeb.xhuntUserId = result.user?.xhuntUserId || null;
      }
      req[AUTH_CENTER_VERIFIED_FLAG] = true;
      next();
    } catch (error) {
      if (optional) return next();
      if (error.name === "JsonWebTokenError") {
        return res.status(419).json({ error: "TOKEN_INVALID" });
      }
      if (error.name === "TokenExpiredError") {
        return res.status(419).json({ error: "TOKEN_EXPIRED" });
      }
      return res.status(error.status || 500).json({
        error: error.message || "AUTH_CENTER_AUTH_FAILED",
      });
    }
  };
}

module.exports = {
  authenticateAuthCenterToken,
  verifyAuthCenterToken,
};
