const crypto = require("crypto");

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function safeHashEqual(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(String(left || "")) || !/^[a-f0-9]{64}$/i.test(String(right || ""))) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function loadCredentials() {
  const raw = String(process.env.XHUNT_VIP_SERVICE_CREDENTIALS || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed)
      ? parsed
      : Object.entries(parsed).map(([clientKey, value]) => ({ clientKey, ...value }));
    return rows.filter((row) =>
      row &&
      typeof row.clientKey === "string" &&
      /^[a-f0-9]{64}$/i.test(String(row.tokenHash || "")) &&
      Array.isArray(row.scopes)
    );
  } catch (error) {
    console.error("[vip-service-auth] XHUNT_VIP_SERVICE_CREDENTIALS is invalid JSON");
    return [];
  }
}

function sendAuthError(req, res, status, code, message) {
  res.locals.vipApiErrorCode = code;
  return res.status(status).json({ success: false, error: code, message });
}

function requireVipServiceAuth(req, res, next) {
  const clientKey = String(req.get("x-client-key") || "").trim();
  const requestId = String(req.get("x-request-id") || "").trim();
  const match = String(req.get("authorization") || "").trim().match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() || "";
  res.locals.vipApiClientKey = clientKey || null;
  res.locals.vipApiRequestId = requestId || null;

  if (!clientKey || !token || !requestId) {
    return sendAuthError(req, res, 401, "SERVICE_AUTH_REQUIRED", "X-Client-Key, Authorization Bearer token and X-Request-Id are required");
  }
  if (clientKey.length > 64 || requestId.length > 128) {
    return sendAuthError(req, res, 400, "INVALID_REQUEST", "client key or request id is too long");
  }

  const credentials = loadCredentials();
  if (!credentials.length) {
    return sendAuthError(req, res, 503, "SERVICE_AUTH_NOT_CONFIGURED", "VIP service credentials are not configured");
  }
  const suppliedHash = hashToken(token);
  const credential = credentials.find((row) =>
    row.clientKey === clientKey && safeHashEqual(suppliedHash, row.tokenHash)
  );
  if (!credential) {
    return sendAuthError(req, res, 401, "SERVICE_AUTH_INVALID", "service credential is invalid");
  }

  req.vipServiceClient = {
    clientKey,
    requestId,
    scopes: new Set(credential.scopes),
  };
  return next();
}

function requireVipScope(scope) {
  return (req, res, next) => {
    if (!req.vipServiceClient?.scopes?.has(scope)) {
      return sendAuthError(req, res, 403, "SERVICE_SCOPE_REQUIRED", `scope ${scope} is required`);
    }
    return next();
  };
}

module.exports = {
  hashToken,
  requireVipServiceAuth,
  requireVipScope,
};
