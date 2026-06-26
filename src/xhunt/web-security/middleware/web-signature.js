const { AuthCenterXhuntClient } = require("../../../models/postgres-start");
const {
  WEB_SIGN_VERSION,
  getMode,
  getWebSignHeaders,
  getTimeWindowSeconds,
  sha256Hex,
  hmacSha256Hex,
  safeCompareHex,
  buildCanonicalPayload,
  derivePublicSigningKey,
  getClientSalt,
  normalizeAllowedOrigins,
  isOriginAllowed,
  reserveRequestId,
  incrementWebStats,
} = require("../services/web-signature");

function getPublicError(reason) {
  const messages = {
    WEB_SIGNATURE_REQUIRED: "缺少请求签名，请刷新页面后重试",
    WEB_SIGNATURE_VERSION_UNSUPPORTED: "签名版本不支持，请刷新页面后重试",
    WEB_SIGNATURE_EXPIRED: "请求已过期，请刷新页面后重试",
    WEB_SIGNATURE_REPLAYED: "请求已处理，请刷新后重试",
    WEB_SIGNATURE_BODY_HASH_MISMATCH: "请求内容校验失败，请刷新后重试",
    WEB_SIGNATURE_INVALID: "请求签名无效，请刷新页面后重试",
    WEB_SIGNATURE_CLIENT_INVALID: "接入应用无效，请联系管理员",
    WEB_SIGNATURE_ORIGIN_DENIED: "当前来源不允许访问认证中心",
    WEB_SIGNATURE_CONFIG_MISSING: "认证中心签名配置缺失",
  };
  return messages[reason] || "请求签名校验失败";
}

function attachContext(req, patch) {
  req.xhuntWeb = {
    source: "web",
    signVersion: WEB_SIGN_VERSION,
    clientKey: null,
    requestId: null,
    pageUrl: null,
    origin: null,
    sdkVersion: null,
    signMode: getMode(),
    signResult: "skipped",
    signFailReason: null,
    authCenterUserId: req.authCenter?.user?.id || null,
    xhuntUserId: req.authCenter?.user?.xhuntUserId || null,
    ...(req.xhuntWeb || {}),
    ...patch,
  };
  return req.xhuntWeb;
}

function logFailure(req, reason, extra = {}) {
  const signature = extra.signature || "";
  const expectedSignature = extra.expectedSignature || "";
  console.warn("[web-signature] failed", {
    mode: getMode(),
    reason,
    method: req.method,
    path: (req.baseUrl || "") + (req.path || ""),
    clientKey: req.xhuntWeb?.clientKey || extra.clientKey || null,
    requestId: req.xhuntWeb?.requestId || extra.requestId || null,
    origin: req.xhuntWeb?.origin || req.headers.origin || null,
    signaturePrefix: signature ? `${signature.slice(0, 8)}...` : null,
    expectedPrefix: expectedSignature ? `${expectedSignature.slice(0, 8)}...` : null,
  });
}

function fail(req, res, next, reason, status = 401, extra = {}) {
  const mode = getMode();
  attachContext(req, {
    signResult: mode === "off" ? "skipped" : "fail",
    signFailReason: reason,
    ...extra.context,
  });

  if (mode === "report") {
    logFailure(req, reason, extra);
    return next();
  }

  if (mode === "enforce") {
    logFailure(req, reason, extra);
    return res.status(status).json({ error: reason, message: getPublicError(reason) });
  }

  return next();
}

async function loadClient(clientKey) {
  if (!clientKey) return null;
  try {
    return await AuthCenterXhuntClient.findOne({ where: { clientKey } });
  } catch (error) {
    console.warn("[web-signature] load client failed:", error?.message || error);
    return null;
  }
}

function webSignatureMiddleware() {
  return async (req, res, next) => {
    const mode = getMode();
    if (mode === "off") {
      attachContext(req, { signMode: mode, signResult: "skipped", signFailReason: "mode_off" });
      res.on("finish", () => incrementWebStats(req.redisClient, req.xhuntWeb, req, res));
      return next();
    }

    const headers = getWebSignHeaders(req);
    attachContext(req, {
      signMode: mode,
      signVersion: headers.signVersion || WEB_SIGN_VERSION,
      clientKey: headers.clientKey || null,
      requestId: headers.requestId || null,
      pageUrl: headers.pageUrl || null,
      origin: headers.origin || null,
      sdkVersion: headers.sdkVersion || null,
      signResult: "fail",
    });
    res.on("finish", () => incrementWebStats(req.redisClient, req.xhuntWeb, req, res));

    if (!headers.signVersion || !headers.clientKey || !headers.requestId || !headers.timestampRaw || !headers.bodySha256 || !headers.signature) {
      return fail(req, res, next, "WEB_SIGNATURE_REQUIRED", 401, { context: { clientKey: headers.clientKey, requestId: headers.requestId } });
    }

    if (headers.signVersion !== WEB_SIGN_VERSION) {
      return fail(req, res, next, "WEB_SIGNATURE_VERSION_UNSUPPORTED", 400, { context: { clientKey: headers.clientKey, requestId: headers.requestId } });
    }

    const timestamp = Number(headers.timestampRaw);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > getTimeWindowSeconds() * 1000) {
      return fail(req, res, next, "WEB_SIGNATURE_EXPIRED", 401, { context: { clientKey: headers.clientKey, requestId: headers.requestId } });
    }

    const rawBody = req.rawBody || "";
    const actualBodyHash = sha256Hex(rawBody);
    if (headers.bodySha256.toLowerCase() !== actualBodyHash) {
      return fail(req, res, next, "WEB_SIGNATURE_BODY_HASH_MISMATCH", 401, {
        context: { clientKey: headers.clientKey, requestId: headers.requestId },
        signature: headers.signature,
      });
    }

    const client = await loadClient(headers.clientKey);
    if (client && client.isActive === false) {
      return fail(req, res, next, "WEB_SIGNATURE_CLIENT_INVALID", 401, { context: { clientKey: headers.clientKey, requestId: headers.requestId } });
    }

    const allowedOrigins = normalizeAllowedOrigins(client?.allowedOrigins);
    const enforceOrigin = false;
    if (enforceOrigin && !isOriginAllowed(headers.origin, allowedOrigins)) {
      return fail(req, res, next, "WEB_SIGNATURE_ORIGIN_DENIED", 403, { context: { clientKey: headers.clientKey, requestId: headers.requestId } });
    }

    const publicSalt = getClientSalt(client);
    if (!publicSalt) {
      return fail(req, res, next, "WEB_SIGNATURE_CONFIG_MISSING", 500, { context: { clientKey: headers.clientKey, requestId: headers.requestId } });
    }

    const signingKey = derivePublicSigningKey(headers.clientKey, publicSalt);
    const canonicalPayload = buildCanonicalPayload(req, headers);
    const expectedSignature = hmacSha256Hex(signingKey, canonicalPayload);
    if (!safeCompareHex(headers.signature, expectedSignature)) {
      return fail(req, res, next, "WEB_SIGNATURE_INVALID", 401, {
        context: { clientKey: headers.clientKey, requestId: headers.requestId },
        signature: headers.signature,
        expectedSignature,
      });
    }

    const reserved = await reserveRequestId(req.redisClient, headers.clientKey, headers.requestId);
    if (!reserved) {
      return fail(req, res, next, "WEB_SIGNATURE_REPLAYED", 409, { context: { clientKey: headers.clientKey, requestId: headers.requestId } });
    }

    attachContext(req, {
      signResult: "pass",
      signFailReason: null,
      clientKey: headers.clientKey,
      requestId: headers.requestId,
      sdkVersion: headers.sdkVersion || null,
      pageUrl: headers.pageUrl || null,
      origin: headers.origin || null,
    });
    return next();
  };
}

module.exports = { webSignatureMiddleware };
