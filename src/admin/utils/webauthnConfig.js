const DEFAULT_WEBAUTHN_RP_IDS = [
  "kb.cryptohunt.ai",
  "kb.xhunt.ai",
  "localhost",
];

function normalizeHost(value) {
  const host = String(value || "").trim().toLowerCase();
  if (!host) return "";
  return host.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0].replace(/^\.+/, "");
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch (_) {
    return "";
  }
}

function getOriginHost(origin) {
  try {
    return normalizeHost(new URL(origin).hostname);
  } catch (_) {
    return "";
  }
}

function splitEnvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAllowedRpIds() {
  return Array.from(
    new Set(
      [
        ...DEFAULT_WEBAUTHN_RP_IDS,
        process.env.WEBAUTHN_RP_ID,
        process.env.ADMIN_COOKIE_DOMAIN,
        ...splitEnvList(process.env.WEBAUTHN_ALLOWED_RP_IDS),
      ]
        .map(normalizeHost)
        .filter(Boolean),
    ),
  ).sort((a, b) => b.length - a.length);
}

function getFallbackRpId() {
  return normalizeHost(process.env.WEBAUTHN_RP_ID || process.env.ADMIN_COOKIE_DOMAIN) || "localhost";
}

function isRpIdValidForHost(rpId, host) {
  const normalizedRpId = normalizeHost(rpId);
  const normalizedHost = normalizeHost(host);
  if (!normalizedRpId || !normalizedHost) return false;
  if (normalizedRpId === "localhost") return normalizedHost === "localhost" || normalizedHost === "127.0.0.1";
  return normalizedHost === normalizedRpId || normalizedHost.endsWith(`.${normalizedRpId}`);
}

function getRequestHost(req) {
  const forwardedHost = String(req?.headers?.["x-forwarded-host"] || "").split(",")[0];
  return normalizeHost(forwardedHost || req?.headers?.host || req?.hostname || "");
}

function getRequestOrigin(req) {
  return normalizeOrigin(req?.headers?.origin || "");
}

function getRequestOriginHost(req) {
  const origin = getRequestOrigin(req);
  return origin ? getOriginHost(origin) : "";
}

function getRequestRefererHost(req) {
  const referer = String(req?.headers?.referer || req?.headers?.referrer || "").trim();
  if (!referer) return "";
  return getOriginHost(referer);
}

function resolveWebAuthnRpId(req) {
  const host = getRequestOriginHost(req) || getRequestRefererHost(req) || getRequestHost(req);
  const matched = getAllowedRpIds().find((rpId) => isRpIdValidForHost(rpId, host));
  return matched || getFallbackRpId();
}

function resolveWebAuthnOrigin(req, rpId = resolveWebAuthnRpId(req)) {
  const requestOrigin = getRequestOrigin(req);
  if (requestOrigin && isRpIdValidForHost(rpId, getOriginHost(requestOrigin))) {
    return requestOrigin;
  }

  const envOrigins = [
    process.env.WEBAUTHN_ORIGIN,
    ...splitEnvList(process.env.WEBAUTHN_ALLOWED_ORIGINS),
  ]
    .map(normalizeOrigin)
    .filter(Boolean);
  const matchedEnvOrigin = envOrigins.find((origin) => isRpIdValidForHost(rpId, getOriginHost(origin)));
  if (matchedEnvOrigin) return matchedEnvOrigin;

  const host = getRequestHost(req);
  if (host && isRpIdValidForHost(rpId, host)) {
    const proto = String(req?.headers?.["x-forwarded-proto"] || req?.protocol || "https").split(",")[0];
    return `${host === "localhost" || host === "127.0.0.1" ? proto || "http" : "https"}://${host}`;
  }

  return `https://${rpId}`;
}

function getWebAuthnRequestConfig(req) {
  const rpID = resolveWebAuthnRpId(req);
  return {
    rpID,
    origin: resolveWebAuthnOrigin(req, rpID),
  };
}

function isLegacyCredentialRpId(rpID) {
  const normalized = normalizeHost(rpID);
  return new Set(
    [
      process.env.WEBAUTHN_RP_ID,
      process.env.ADMIN_COOKIE_DOMAIN,
      "kb.cryptohunt.ai",
      "localhost",
    ]
      .map(normalizeHost)
      .filter(Boolean),
  ).has(normalized);
}

function isWebAuthnCredentialForRp(credential, rpID) {
  const credentialRpId = normalizeHost(credential?.rpId);
  const normalizedRpId = normalizeHost(rpID);
  if (credentialRpId) return credentialRpId === normalizedRpId;
  // 老数据没有 rpId 字段，按历史主域 kb.cryptohunt.ai 兼容，避免它们在 kb.xhunt.ai 上错误触发二次验证。
  return isLegacyCredentialRpId(normalizedRpId);
}

function filterWebAuthnCredentialsForRp(credentials, rpID) {
  return (Array.isArray(credentials) ? credentials : []).filter((credential) =>
    isWebAuthnCredentialForRp(credential, rpID),
  );
}

module.exports = {
  getWebAuthnRequestConfig,
  resolveWebAuthnRpId,
  resolveWebAuthnOrigin,
  filterWebAuthnCredentialsForRp,
  isWebAuthnCredentialForRp,
};
