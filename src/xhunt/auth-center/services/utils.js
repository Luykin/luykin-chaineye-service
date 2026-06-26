const crypto = require("crypto");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function normalizeAccountName(value) {
  return String(value || "").trim();
}

function normalizeAccountNameLower(value) {
  return normalizeAccountName(value).toLowerCase();
}

function normalizeEvmAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function extractEvm40Address(input) {
  if (!input) return null;
  const match = String(input).match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0].toLowerCase() : null;
}

function shortAddress(address) {
  const lower = normalizeEvmAddress(address);
  if (!lower || lower.length < 12) return lower;
  return `${lower.slice(0, 6)}...${lower.slice(-4)}`;
}

function getIpHash(req) {
  const ip = req.headers["x-forwarded-for"] || req.ip || req.connection?.remoteAddress || "";
  return ip ? sha256(String(ip).split(",")[0].trim()) : null;
}

function getFingerprint(req) {
  return req?.securityContext?.fingerprint || req.headers["x-device-fingerprint"] || "";
}

module.exports = {
  sha256,
  randomToken,
  normalizeAccountName,
  normalizeAccountNameLower,
  normalizeEvmAddress,
  extractEvm40Address,
  shortAddress,
  getIpHash,
  getFingerprint,
};
