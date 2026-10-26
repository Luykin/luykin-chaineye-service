const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TOTP_SCOPES,
  buildKnownTemporaryAuthKeys,
  describeTotpState,
  parseArgs,
  validateTarget,
} = require("../scripts/recover-super-admin-totp");

test("builds temporary auth keys for every TOTP scope and WebAuthn state", () => {
  const keys = buildKnownTemporaryAuthKeys(42);
  assert.equal(keys.length, TOTP_SCOPES.length * 3 + 2);
  assert.ok(keys.includes("admin:account-settings:totp:verified:42"));
  assert.ok(keys.includes("admin:nacos-admin:totp:failures:42"));
  assert.ok(keys.includes("admin:admin-users:webauthn:verified:42"));
});

test("apply mode requires an exact email confirmation and audit details", () => {
  assert.throws(() => parseArgs([
    "--env-file", ".env-pro",
    "--email", "root@example.com",
    "--check",
    "--apply",
  ]), /不能同时使用/);

  assert.throws(() => parseArgs([
    "--env-file", ".env-pro",
    "--email", "root@example.com",
    "--apply",
  ]), /--operator/);

  assert.throws(() => parseArgs([
    "--env-file", ".env-pro",
    "--email", "root@example.com",
    "--operator", "on-call",
    "--reason", "lost authenticator",
    "--confirm-email", "other@example.com",
    "--apply",
  ]), /--confirm-email/);

  const options = parseArgs([
    "--env-file", ".env-pro",
    "--email", "ROOT@example.com",
    "--operator", "on-call",
    "--reason", "lost authenticator",
    "--confirm-email", "root@example.com",
    "--apply",
  ]);
  assert.equal(options.email, "root@example.com");
  assert.equal(options.mode, "apply");
});

test("detects partial TOTP data and refuses non-super targets", () => {
  assert.deepEqual(describeTotpState({
    totpSecretEncrypted: "encrypted",
    totpEnabledAt: null,
    totpLastUsedStep: null,
  }), {
    enrolled: false,
    hasAnyData: true,
    fieldsPresent: { secret: true, enabledAt: false, lastUsedStep: false },
  });

  assert.throws(() => validateTarget([{
    id: 7,
    email: "admin@example.com",
    role: "admin",
  }], "admin@example.com"), /不是超级管理员/);
});
