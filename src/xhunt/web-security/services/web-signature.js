const crypto = require("crypto");

const WEB_SIGN_VERSION = "w1";
const HEADER_PREFIX = "x-xhunt-web-";
const DEFAULT_TIME_WINDOW_SECONDS = 300;
const DEFAULT_REQUEST_ID_TTL_SECONDS = 600;
const REQUEST_ID_PREFIX = "websign:reqid:";
const localRequestIds = new Map();
let lastLocalPruneAt = 0;

function sha256Hex(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hmacSha256Hex(key, payload) {
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}

function safeCompareHex(a, b) {
  const left = String(a || "").toLowerCase();
  const right = String(b || "").toLowerCase();
  if (!left || !right || left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
  } catch (_) {
    return false;
  }
}

function getHeader(req, name) {
  return String(req.headers[name.toLowerCase()] || "").trim();
}

function getWebSignHeaders(req) {
  return {
    signVersion: getHeader(req, `${HEADER_PREFIX}sign-version`),
    clientKey: getHeader(req, `${HEADER_PREFIX}client-key`),
    requestId: getHeader(req, `${HEADER_PREFIX}request-id`),
    timestampRaw: getHeader(req, `${HEADER_PREFIX}timestamp`),
    bodySha256: getHeader(req, `${HEADER_PREFIX}body-sha256`),
    signature: getHeader(req, `${HEADER_PREFIX}signature`),
    sdkVersion: getHeader(req, `${HEADER_PREFIX}sdk-version`),
    pageUrl: getHeader(req, `${HEADER_PREFIX}page-url`),
    origin: getHeader(req, `${HEADER_PREFIX}origin`) || String(req.headers.origin || ""),
  };
}

function getMode() {
  const mode = String(process.env.XHUNT_WEB_SIGN_MODE || "off").trim().toLowerCase();
  return ["off", "report", "enforce"].includes(mode) ? mode : "off";
}

function getTimeWindowSeconds() {
  const parsed = parseInt(process.env.XHUNT_WEB_SIGN_TIME_WINDOW_SECONDS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIME_WINDOW_SECONDS;
}

function getRequestIdTtlSeconds() {
  const parsed = parseInt(process.env.XHUNT_WEB_SIGN_REQUEST_ID_TTL_SECONDS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUEST_ID_TTL_SECONDS;
}

function normalizePathWithQuery(req) {
  const path = (req.baseUrl || "") + (req.path || "");
  const entries = [];
  for (const [key, value] of Object.entries(req.query || {})) {
    const normalizedKey = String(key);
    if (normalizedKey.toLowerCase().startsWith(HEADER_PREFIX)) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => entries.push([normalizedKey, String(item)]));
    } else if (value !== undefined) {
      entries.push([normalizedKey, String(value)]);
    }
  }
  entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  if (!entries.length) return path || "/";
  const search = new URLSearchParams();
  entries.forEach(([key, value]) => search.append(key, value));
  return `${path || "/"}?${search.toString()}`;
}

function getAuthorizationTokenHash(req) {
  const header = String(req.headers.authorization || "").trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? sha256Hex(match[1]) : "";
}

function buildCanonicalPayload(req, headers) {
  return [
    req.method.toUpperCase(),
    normalizePathWithQuery(req),
    headers.timestampRaw,
    headers.requestId,
    headers.clientKey,
    headers.origin || "",
    headers.bodySha256,
    getAuthorizationTokenHash(req),
  ].join("\n");
}

function derivePublicSigningKey(clientKey, publicSalt) {
  return sha256Hex(`${clientKey}:${publicSalt}:xhunt-web-w1`);
}

function getClientSalt(client) {
  return client?.webPublicSignSalt || process.env.XHUNT_WEB_PUBLIC_SIGN_SALT || "";
}

function normalizeAllowedOrigins(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return [];
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin || !allowedOrigins.length) return true;
  return allowedOrigins.includes(origin);
}

function pruneLocalRequestIds(ttlMs) {
  const now = Date.now();
  if (now - lastLocalPruneAt < 60_000 && localRequestIds.size < 100_000) return;
  lastLocalPruneAt = now;
  for (const [key, ts] of localRequestIds) {
    if (now - ts > ttlMs) localRequestIds.delete(key);
  }
  while (localRequestIds.size > 100_000) {
    const first = localRequestIds.keys().next().value;
    if (!first) break;
    localRequestIds.delete(first);
  }
}

async function reserveRequestId(redisClient, clientKey, requestId) {
  const ttlSeconds = getRequestIdTtlSeconds();
  const key = `${REQUEST_ID_PREFIX}${clientKey}:${requestId}`;
  if (redisClient?.set) {
    try {
      const result = await redisClient.set(key, "1", { NX: true, EX: ttlSeconds });
      return result !== null;
    } catch (error) {
      console.warn("[web-signature] Redis requestId reserve failed:", error?.message || error);
    }
  }

  const ttlMs = ttlSeconds * 1000;
  pruneLocalRequestIds(ttlMs);
  const now = Date.now();
  const existedAt = localRequestIds.get(key);
  if (existedAt && now - existedAt < ttlMs) return false;
  localRequestIds.set(key, now);
  return true;
}

async function incrementWebStats(redisClient, context, req, res) {
  if (!redisClient?.multi || !context || context.source !== "web") return;
  const now = new Date();
  const minutes = Math.floor(now.getUTCMinutes() / 5) * 5;
  const windowDate = new Date(now);
  windowDate.setUTCMinutes(minutes, 0, 0);
  const windowKey = windowDate.toISOString();
  const status = res.statusCode;
  const statusGroup = `status_${Math.floor(status / 100)}xx`;
  const path = (req.baseUrl || "") + (req.path || "") || "/";
  const clientKey = context.clientKey || "unknown";
  const signResult = context.signResult || "unknown";
  const signatureField = signResult === "fail" ? `fail:${context.signFailReason || "unknown"}` : signResult;

  try {
    const multi = redisClient.multi();
    const ttl = 3 * 24 * 60 * 60;
    multi.hIncrBy(`web_request_stats:${windowKey}`, "total", 1);
    multi.hIncrBy(`web_request_stats:${windowKey}`, statusGroup, 1);
    multi.hIncrBy(`web_request_stats:${windowKey}`, `signed_${signResult}`, 1);
    multi.expire(`web_request_stats:${windowKey}`, ttl);

    multi.hIncrBy(`web_url_stats:${windowKey}`, path, 1);
    multi.expire(`web_url_stats:${windowKey}`, ttl);

    multi.hIncrBy(`web_client_stats:${windowKey}`, clientKey, 1);
    multi.expire(`web_client_stats:${windowKey}`, ttl);

    multi.hIncrBy(`web_signature_stats:${windowKey}`, signatureField, 1);
    multi.expire(`web_signature_stats:${windowKey}`, ttl);
    await multi.exec();
  } catch (error) {
    console.warn("[web-signature] web stats write failed:", error?.message || error);
  }
}

module.exports = {
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
};
