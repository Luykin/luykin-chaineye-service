const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildOtpAuthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpCode,
  verifyTotpCode,
} = require("../src/admin/admin-users/totp");

test("generates the RFC 6238 SHA-1 test vector", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(generateTotpCode(secret, 1), "287082");
  assert.equal(verifyTotpCode(secret, "287082", { timestamp: 59 * 1000, window: 0 }), 1);
});

test("accepts adjacent time steps and rejects malformed codes", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const timestamp = 1_700_000_000_000;
  const previousStep = Math.floor(timestamp / 1000 / 30) - 1;
  const previousCode = generateTotpCode(secret, previousStep);
  assert.equal(verifyTotpCode(secret, previousCode, { timestamp, window: 1 }), previousStep);
  assert.equal(verifyTotpCode(secret, "12345", { timestamp }), null);
});

test("encrypts secrets with authenticated encryption", () => {
  const encrypted = encryptTotpSecret("JBSWY3DPEHPK3PXP", "test-encryption-key");
  assert.notEqual(encrypted, "JBSWY3DPEHPK3PXP");
  assert.equal(decryptTotpSecret(encrypted, "test-encryption-key"), "JBSWY3DPEHPK3PXP");
  assert.throws(() => decryptTotpSecret(encrypted, "wrong-key"));
});

test("builds an Authenticator-compatible otpauth URI", () => {
  const uri = buildOtpAuthUri({ secret: "JBSWY3DPEHPK3PXP", accountName: "admin@example.com" });
  assert.match(uri, /^otpauth:\/\/totp\/XHunt%20Admin%3Aadmin%40example\.com\?/);
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
});
