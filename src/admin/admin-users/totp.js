const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} = require("crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input) {
  const normalized = String(input || "").toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const output = [];

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Authenticator 密钥格式无效");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

function generateTotpSecret() {
  return encodeBase32(randomBytes(20));
}

function getTotpStep(timestamp = Date.now()) {
  return Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
}

function generateTotpCode(secret, step = getTotpStep()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
}

function verifyTotpCode(secret, suppliedCode, { timestamp = Date.now(), window = 1 } = {}) {
  const code = String(suppliedCode || "").trim();
  if (!/^\d{6}$/.test(code)) return null;
  const codeBuffer = Buffer.from(code);
  const currentStep = getTotpStep(timestamp);
  const offsets = [0];
  for (let index = 1; index <= window; index += 1) offsets.push(-index, index);

  for (const offset of offsets) {
    const step = currentStep + offset;
    const expected = Buffer.from(generateTotpCode(secret, step));
    if (expected.length === codeBuffer.length && timingSafeEqual(expected, codeBuffer)) return step;
  }
  return null;
}

function deriveEncryptionKey(secret) {
  const value = String(secret || "").trim();
  if (!value) throw new Error("缺少 ADMIN_TOTP_ENCRYPTION_KEY 或 ADMIN_JWT_SECRET");
  return createHash("sha256").update(value).digest();
}

function encryptTotpSecret(secret, encryptionSecret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveEncryptionKey(encryptionSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

function decryptTotpSecret(payload, encryptionSecret) {
  const [version, ivValue, tagValue, ciphertextValue] = String(payload || "").split(":");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Authenticator 密钥数据无效");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveEncryptionKey(encryptionSecret),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function buildOtpAuthUri({ secret, accountName, issuer = "XHunt Admin" }) {
  const label = `${issuer}:${accountName}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

module.exports = {
  TOTP_PERIOD_SECONDS,
  buildOtpAuthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpCode,
  generateTotpSecret,
  getTotpStep,
  verifyTotpCode,
};
