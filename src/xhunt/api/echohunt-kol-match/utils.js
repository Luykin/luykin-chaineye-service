function getEnvPositiveInteger(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getEnvBoolean(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return defaultValue;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeString(value, maxLength = 500) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 30)
    .toLowerCase();
}

function normalizeTwitterUserId(value) {
  const normalized = String(value || "").trim();
  return /^\d{1,32}$/.test(normalized) ? normalized : "";
}

function normalizeMarket(value, fallback = "GLOBAL") {
  const raw = String(value || "").trim().toUpperCase();
  if (["CN", "ZH", "CHINESE", "中文", "中文区", "华语"].includes(raw)) return "CN";
  if (["GLOBAL", "EN", "ENGLISH", "OVERSEAS", "全球", "海外", "国际"].includes(raw)) return "GLOBAL";
  return fallback;
}

function normalizeDomain(value, fallback = "Web3") {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();
  if (lower === "ai" || lower.includes("人工智能") || lower.includes("aigc")) return "AI";
  if (lower === "web3" || lower === "crypto" || lower.includes("区块链") || lower.includes("加密")) return "Web3";
  return fallback;
}

function isSafeHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function safeArray(value, maxItems = 8, maxItemLength = 80) {
  const input = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      input
        .map((item) => normalizeString(item, maxItemLength))
        .filter(Boolean)
    )
  ).slice(0, maxItems);
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function shorten(text, maxLength = 160) {
  const clean = normalizeString(text, maxLength + 20);
  return clean.length > maxLength ? `${clean.slice(0, Math.max(1, maxLength - 1))}…` : clean;
}

module.exports = {
  clampInteger,
  getEnvBoolean,
  getEnvPositiveInteger,
  isSafeHttpUrl,
  normalizeDomain,
  normalizeHandle,
  normalizeMarket,
  normalizeString,
  normalizeTwitterUserId,
  numeric,
  safeArray,
  shorten,
  toIso,
};
