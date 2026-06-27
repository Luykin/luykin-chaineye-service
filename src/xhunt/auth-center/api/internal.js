const express = require("express");
const { body, validationResult } = require("express-validator");
const { verifyAuthCenterToken } = require("../middleware/auth");

const router = express.Router();

function extractBearerToken(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) return match[1].trim();
  return String(req.body?.token || "").trim();
}

function sendTokenError(res, error) {
  if (error.name === "JsonWebTokenError") {
    return res.status(419).json({ valid: false, error: "TOKEN_INVALID" });
  }
  if (error.name === "TokenExpiredError") {
    return res.status(419).json({ valid: false, error: "TOKEN_EXPIRED" });
  }
  return res.status(error.status || 500).json({
    valid: false,
    error: error.message || "AUTH_CENTER_TOKEN_INTROSPECT_FAILED",
  });
}

router.post(
  "/token/introspect",
  [body("token").optional().isString().trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ valid: false, error: "INVALID_REQUEST", details: errors.array() });
    }

    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ valid: false, error: "TOKEN_REQUIRED" });
    }

    try {
      const result = await verifyAuthCenterToken(token);
      return res.json({
        valid: true,
        user: result.publicUser,
        token: {
          subject: result.decoded.sub || null,
          sessionId: result.decoded.sid || null,
          jti: result.decoded.jti || null,
          audience: result.decoded.aud || null,
          issuer: result.decoded.iss || null,
          issuedAt: result.decoded.iat ? result.decoded.iat * 1000 : null,
          expiresAt: result.decoded.exp ? result.decoded.exp * 1000 : null,
        },
        session: {
          id: result.session.id,
          clientKey: result.session.clientKey || null,
          expiresAt: result.session.expiresAt,
          lastUsedAt: result.session.lastUsedAt || null,
        },
      });
    } catch (error) {
      return sendTokenError(res, error);
    }
  }
);

module.exports = router;
