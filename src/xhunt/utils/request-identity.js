const DEAD_FINGERPRINT = "deadbeefdeadbeefdeadbeefdeadbeef";
const IP_RATE_LIMIT_FINGERPRINT = "0fa18b367456abdea6060e931e4902b4";

function normalizeIdentityValue(value) {
  return String(value || "").trim();
}

function isDeadFingerprint(fingerprint) {
  return normalizeIdentityValue(fingerprint).toLowerCase() === DEAD_FINGERPRINT;
}

function getHeader(req, name) {
  return req?.headers?.[name];
}

function getQuery(req, dashName, camelName) {
  return req?.query?.[dashName] || req?.query?.[camelName];
}

function getRawFingerprint(req, { allowQueryParams = false } = {}) {
  return normalizeIdentityValue(
    req?.securityContext?.fingerprint ||
      req?.securityContext?.rawFingerprint ||
      getHeader(req, "x-device-fingerprint") ||
      (allowQueryParams ? getQuery(req, "x-device-fingerprint", "deviceFingerprint") || getQuery(req, "x_device_fingerprint", "device_fingerprint") : "")
  );
}

function getRealFingerprint(req, options = {}) {
  const fingerprint = getRawFingerprint(req, options);
  if (!fingerprint) return "";
  if (isDeadFingerprint(fingerprint)) return "";
  return fingerprint;
}

function getRequestTwitterId(req, { allowQueryParams = false } = {}) {
  return normalizeIdentityValue(
    req?.user?.twitterId ||
      req?.securityContext?.twId ||
      req?.securityContext?.twitterId ||
      getHeader(req, "x-tw-id") ||
      (allowQueryParams ? getQuery(req, "x-tw-id", "twId") || getQuery(req, "x_tw_id", "tw_id") : "")
  );
}

function getEffectiveIdentity(req, options = {}) {
  const twitterId = getRequestTwitterId(req, options);
  if (twitterId) {
    return {
      type: "twitterId",
      value: twitterId,
      key: `tw:${twitterId}`,
      source: req?.user?.twitterId ? "auth" : "header",
    };
  }

  const realFingerprint = getRealFingerprint(req, options);
  if (realFingerprint) {
    return {
      type: "fingerprint",
      value: realFingerprint,
      key: `fp:${realFingerprint}`,
      source: "fingerprint",
    };
  }

  return {
    type: "anonymous",
    value: "",
    key: "",
    source: "none",
  };
}

function getRateLimitIdentity(req, options = {}) {
  // fingerprintLimiter runs before signature validation on most routes.
  // Preserve the historical fixed-fingerprint behavior: this placeholder is
  // shared by many clients, so limit by IP instead of putting everyone in one
  // fingerprint bucket.
  const rawFingerprint = getRawFingerprint(req, options);
  if (rawFingerprint.toLowerCase() === IP_RATE_LIMIT_FINGERPRINT) {
    return `ip:${req?.ip || "unknown"}`;
  }

  // Prefer a real fingerprint here; only fall back to tw-id when the client is
  // using the deadbeef placeholder/no fingerprint. Otherwise a caller could vary
  // unsigned x-tw-id values to bypass the fingerprint limiter.
  const realFingerprint = getRealFingerprint(req, options);
  if (realFingerprint) return `fp:${realFingerprint}`;

  const twitterId = getRequestTwitterId(req, options);
  if (twitterId) return `tw:${twitterId}`;

  return `ip:${req?.ip || "unknown"}`;
}

function attachIdentityToSecurityContext(req, securityContext = {}, options = {}) {
  const rawFingerprint = normalizeIdentityValue(securityContext.fingerprint || securityContext.rawFingerprint || getRawFingerprint(req, options));
  const twId = normalizeIdentityValue(securityContext.twId || getRequestTwitterId(req, options));
  const tempContext = {
    ...securityContext,
    fingerprint: rawFingerprint,
    rawFingerprint,
    twId: twId || null,
    twitterId: twId || null,
  };
  const tempReq = { ...req, securityContext: tempContext };
  const realFingerprint = getRealFingerprint(tempReq, options);
  const effectiveIdentity = getEffectiveIdentity(tempReq, options);
  return {
    ...tempContext,
    realFingerprint: realFingerprint || null,
    effectiveIdentity,
  };
}

module.exports = {
  DEAD_FINGERPRINT,
  IP_RATE_LIMIT_FINGERPRINT,
  normalizeIdentityValue,
  isDeadFingerprint,
  getRawFingerprint,
  getRealFingerprint,
  getRequestTwitterId,
  getEffectiveIdentity,
  getRateLimitIdentity,
  attachIdentityToSecurityContext,
};
