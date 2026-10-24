const express = require("express");
const base64url = require("base64url");
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const {
  XhuntAdminAuditLog,
  XhuntAdminManager,
  XhuntAdminWebAuthnCredential,
} = require("../../models/postgres-start");
const { adminAuth, requireRole, JWT_SECRET } = require("../middleware/adminAuth");
const {
  filterWebAuthnCredentialsForRp,
  getWebAuthnRequestConfig,
} = require("../utils/webauthnConfig");
const {
  buildOtpAuthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotpCode,
} = require("./totp");

const router = express.Router();
const ADMIN_USERS_REAUTH_TTL_SECONDS = Math.max(
  60,
  parseInt(process.env.ADMIN_USERS_REAUTH_TTL_SECONDS || "600", 10) || 600,
);
const TOTP_SETUP_TTL_SECONDS = 600;
const TOTP_MAX_FAILURES = 5;
const TOTP_FAILURE_WINDOW_SECONDS = 300;
const TOTP_ENCRYPTION_SECRET = process.env.ADMIN_TOTP_ENCRYPTION_KEY || JWT_SECRET;
const ADMIN_TOTP_VERIFICATION_SCOPES = [
  "account-settings",
  "admin-users",
  "db-admin",
  "server-command",
  "log-search",
  "nacos-admin",
];

function getWebAuthnVerifiedKey(adminId) {
  return `admin:admin-users:webauthn:verified:${adminId}`;
}

function getWebAuthnChallengeKey(adminId) {
  return `admin:admin-users:webauthn:challenge:${adminId}`;
}

function getTotpVerifiedKey(adminId, scope = "admin-users") {
  return `admin:${scope}:totp:verified:${adminId}`;
}

function getTotpSetupKey(adminId, scope = "admin-users") {
  return `admin:${scope}:totp:setup:${adminId}`;
}

function getTotpFailureKey(adminId, scope = "admin-users") {
  return `admin:${scope}:totp:failures:${adminId}`;
}

function buildAuthenticatorFromCredential(row) {
  return {
    credentialID: base64url.toBuffer(row.credentialId),
    credentialPublicKey: base64url.toBuffer(row.publicKey),
    counter: Number(row.counter || 0),
  };
}

function getCredentialKeyFromAssertion(assertion) {
  if (typeof assertion?.id === "string") return assertion.id;
  if (typeof assertion?.rawId === "string") return assertion.rawId;
  return null;
}

async function getRedisFlagWithTtl(redisClient, key, fallbackTtlSeconds = ADMIN_USERS_REAUTH_TTL_SECONDS) {
  const value = await redisClient.get(key);
  if (value !== "1") return { verified: false, ttlSeconds: 0 };
  if (typeof redisClient.ttl !== "function") {
    return { verified: true, ttlSeconds: fallbackTtlSeconds };
  }
  const ttlSeconds = Math.max(0, await redisClient.ttl(key));
  return { verified: ttlSeconds > 0, ttlSeconds };
}

async function getCurrentRpCredentials(req, adminId) {
  const webAuthnConfig = getWebAuthnRequestConfig(req);
  const credentials = filterWebAuthnCredentialsForRp(
    await XhuntAdminWebAuthnCredential.findAll({ where: { adminId } }),
    webAuthnConfig.rpID,
  );
  return { credentials, webAuthnConfig };
}

async function getAdminUsersSecurityStatus(req, admin) {
  const [{ credentials }, webAuthnState, totpState] = await Promise.all([
    getCurrentRpCredentials(req, admin.id),
    getRedisFlagWithTtl(req.redisClient, getWebAuthnVerifiedKey(admin.id)),
    getRedisFlagWithTtl(req.redisClient, getTotpVerifiedKey(admin.id)),
  ]);
  const totpEnrolled = !!admin.totpSecretEncrypted && !!admin.totpEnabledAt;
  return {
    webauthn: {
      enrolled: credentials.length > 0,
      verified: credentials.length > 0 && webAuthnState.verified,
      ttlSeconds: webAuthnState.ttlSeconds,
    },
    totp: {
      enrolled: totpEnrolled,
      verified: totpEnrolled && totpState.verified,
      ttlSeconds: totpState.ttlSeconds,
    },
    verified: credentials.length > 0
      && webAuthnState.verified
      && totpEnrolled
      && totpState.verified,
    expiresInSeconds: ADMIN_USERS_REAUTH_TTL_SECONDS,
  };
}

async function getAdminTotpStatus(req, admin, scope = "admin-users", expiresInSeconds = ADMIN_USERS_REAUTH_TTL_SECONDS) {
  const state = await getRedisFlagWithTtl(
    req.redisClient,
    getTotpVerifiedKey(admin.id, scope),
    expiresInSeconds,
  );
  const enrolled = !!admin.totpSecretEncrypted && !!admin.totpEnabledAt;
  return {
    enrolled,
    verified: enrolled && state.verified,
    ttlSeconds: state.ttlSeconds,
    expiresInSeconds,
  };
}

async function writeAudit(req, action, success, message = null) {
  try {
    await XhuntAdminAuditLog.create({
      adminId: req.adminUser?.id || null,
      email: req.adminUser?.email || null,
      action,
      route: req.originalUrl || req.path,
      method: req.method,
      ip: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      success,
      message,
    });
  } catch (_) {}
}

async function requireRecentWebAuthn(req, res, next) {
  try {
    const state = await getRedisFlagWithTtl(req.redisClient, getWebAuthnVerifiedKey(req.adminUser.id));
    if (!state.verified) {
      return res.status(403).json({
        success: false,
        code: "ADMIN_USERS_WEBAUTHN_REQUIRED",
        error: "请先完成生物识别验证",
      });
    }
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, error: "检查生物识别状态失败" });
  }
}

async function getTotpFailureCount(req, adminId, scope = "admin-users") {
  return Math.max(0, parseInt(await req.redisClient.get(getTotpFailureKey(adminId, scope)) || "0", 10) || 0);
}

async function recordTotpFailure(req, adminId, scope = "admin-users") {
  const key = getTotpFailureKey(adminId, scope);
  const count = await req.redisClient.incr(key);
  if (count === 1) await req.redisClient.expire(key, TOTP_FAILURE_WINDOW_SECONDS);
  return count;
}

async function assertTotpAttemptsAvailable(req, res, scope = "admin-users") {
  const count = await getTotpFailureCount(req, req.adminUser.id, scope);
  if (count < TOTP_MAX_FAILURES) return true;
  res.status(429).json({
    success: false,
    code: "ADMIN_USERS_TOTP_RATE_LIMITED",
    error: "Authenticator 验证失败次数过多，请 5 分钟后重试",
  });
  return false;
}

async function verifyAndConsumeTotp(
  adminId,
  code,
  encryptedSecretOverride = null,
  { allowReplace = false } = {},
) {
  return XhuntAdminManager.sequelize.transaction(async (transaction) => {
    const admin = await XhuntAdminManager.findByPk(adminId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!admin) return { ok: false, reason: "NOT_FOUND" };
    const replacing = !!(
      encryptedSecretOverride && admin.totpSecretEncrypted && admin.totpEnabledAt
    );
    if (replacing && !allowReplace) {
      return { ok: false, reason: "ALREADY_ENROLLED" };
    }
    const encryptedSecret = encryptedSecretOverride || admin.totpSecretEncrypted;
    if (!encryptedSecret) return { ok: false, reason: "NOT_ENROLLED" };
    const secret = decryptTotpSecret(encryptedSecret, TOTP_ENCRYPTION_SECRET);
    const step = verifyTotpCode(secret, code, { window: 1 });
    if (step === null) return { ok: false, reason: "INVALID" };

    const lastUsedStep = (encryptedSecretOverride || admin.totpLastUsedStep == null)
      ? null
      : Number(admin.totpLastUsedStep);
    if (lastUsedStep !== null && step <= lastUsedStep) return { ok: false, reason: "REPLAYED" };

    admin.totpLastUsedStep = step;
    if (encryptedSecretOverride) {
      admin.totpSecretEncrypted = encryptedSecretOverride;
      admin.totpEnabledAt = new Date();
    }
    await admin.save({ transaction });
    return { ok: true, step, replaced: replacing };
  });
}

function createTotpSecurityError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function beginAdminTotpSetup(
  req,
  admin,
  scope = "admin-users",
  { allowReplace = false } = {},
) {
  if (!allowReplace && admin.totpSecretEncrypted && admin.totpEnabledAt) {
    throw createTotpSecurityError(409, "TOTP_ALREADY_ENROLLED", "当前账号已绑定 Authenticator");
  }
  const secret = generateTotpSecret();
  const encryptedSecret = encryptTotpSecret(secret, TOTP_ENCRYPTION_SECRET);
  const otpauthUri = buildOtpAuthUri({ secret, accountName: admin.email });
  await req.redisClient.set(getTotpSetupKey(admin.id, scope), encryptedSecret, { EX: TOTP_SETUP_TTL_SECONDS });
  return { secret, otpauthUri, expiresInSeconds: TOTP_SETUP_TTL_SECONDS };
}

async function ensureTotpAttemptsAvailable(req, adminId, scope) {
  const count = await getTotpFailureCount(req, adminId, scope);
  if (count >= TOTP_MAX_FAILURES) {
    throw createTotpSecurityError(
      429,
      "TOTP_RATE_LIMITED",
      "Authenticator 验证失败次数过多，请 5 分钟后重试",
    );
  }
}

async function finishAdminTotpSetup(
  req,
  admin,
  code,
  scope = "admin-users",
  expiresInSeconds = ADMIN_USERS_REAUTH_TTL_SECONDS,
  { allowReplace = false } = {},
) {
  await ensureTotpAttemptsAvailable(req, admin.id, scope);
  const encryptedSecret = await req.redisClient.get(getTotpSetupKey(admin.id, scope));
  if (!encryptedSecret) {
    throw createTotpSecurityError(400, "TOTP_SETUP_EXPIRED", "绑定信息已过期，请重新生成");
  }
  const result = await verifyAndConsumeTotp(admin.id, code, encryptedSecret, { allowReplace });
  if (!result.ok) {
    await recordTotpFailure(req, admin.id, scope);
    throw createTotpSecurityError(401, result.reason, "Authenticator 验证码无效或已使用");
  }
  if (result.replaced) {
    await Promise.all(
      ADMIN_TOTP_VERIFICATION_SCOPES
        .filter((verificationScope) => verificationScope !== scope)
        .map((verificationScope) => (
          req.redisClient.del(getTotpVerifiedKey(admin.id, verificationScope))
        )),
    );
  }
  await Promise.all([
    req.redisClient.del(getTotpSetupKey(admin.id, scope)),
    req.redisClient.del(getTotpFailureKey(admin.id, scope)),
    req.redisClient.set(getTotpVerifiedKey(admin.id, scope), "1", { EX: expiresInSeconds }),
  ]);
  await admin.reload();
  return { enrolled: true, verified: true, replaced: result.replaced, expiresInSeconds };
}

async function verifyAdminTotp(
  req,
  admin,
  code,
  scope = "admin-users",
  expiresInSeconds = ADMIN_USERS_REAUTH_TTL_SECONDS,
) {
  if (!admin.totpSecretEncrypted || !admin.totpEnabledAt) {
    throw createTotpSecurityError(403, "TOTP_NOT_ENROLLED", "请先绑定 Authenticator");
  }
  await ensureTotpAttemptsAvailable(req, admin.id, scope);
  const result = await verifyAndConsumeTotp(admin.id, code);
  if (!result.ok) {
    await recordTotpFailure(req, admin.id, scope);
    throw createTotpSecurityError(401, result.reason, "Authenticator 验证码无效或已使用");
  }
  await Promise.all([
    req.redisClient.del(getTotpFailureKey(admin.id, scope)),
    req.redisClient.set(getTotpVerifiedKey(admin.id, scope), "1", { EX: expiresInSeconds }),
  ]);
  return { verified: true, expiresInSeconds };
}

router.use(adminAuth, requireRole("super"));
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/status", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const status = await getAdminUsersSecurityStatus(req, req.adminUser);
    return res.json({ success: true, data: status });
  } catch (error) {
    return res.status(500).json({ success: false, error: "加载管理员列表安全状态失败" });
  }
});

router.get("/webauthn/options", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const { credentials, webAuthnConfig } = await getCurrentRpCredentials(req, req.adminUser.id);
    if (!credentials.length) {
      return res.status(403).json({
        success: false,
        code: "WEBAUTHN_NOT_ENROLLED",
        error: "请先绑定指纹 / Face ID / 通行密钥",
      });
    }
    const options = await generateAuthenticationOptions({
      rpID: webAuthnConfig.rpID,
      userVerification: "required",
      allowCredentials: credentials.map((credential) => ({
        id: base64url.toBuffer(credential.credentialId),
        type: "public-key",
      })),
    });
    await req.redisClient.set(getWebAuthnChallengeKey(req.adminUser.id), options.challenge, { EX: 300 });
    return res.json({ success: true, options });
  } catch (error) {
    return res.status(500).json({ success: false, error: "生成生物识别验证参数失败" });
  }
});

router.post("/webauthn/verify", express.json(), async (req, res) => {
  try {
    const assertion = req.body?.assertion;
    if (!assertion) return res.status(400).json({ success: false, error: "缺少生物识别验证结果" });
    const challengeKey = getWebAuthnChallengeKey(req.adminUser.id);
    const expectedChallenge = await req.redisClient.get(challengeKey);
    if (!expectedChallenge) return res.status(400).json({ success: false, error: "生物识别验证已超时，请重试" });

    const { credentials, webAuthnConfig } = await getCurrentRpCredentials(req, req.adminUser.id);
    const credentialLookup = new Map(credentials.map((credential) => [credential.credentialId, credential]));
    const credential = credentialLookup.get(getCredentialKeyFromAssertion(assertion));
    if (!credential) return res.status(401).json({ success: false, error: "未识别的生物识别凭证" });

    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge,
      expectedOrigin: webAuthnConfig.origin,
      expectedRPID: webAuthnConfig.rpID,
      authenticator: buildAuthenticatorFromCredential(credential),
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.authenticationInfo) {
      await writeAudit(req, "admin-users-webauthn-reauth", false, "verification failed");
      return res.status(401).json({ success: false, error: "生物识别验证失败" });
    }

    credential.counter = Number(verification.authenticationInfo.newCounter || verification.authenticationInfo.counter || 0);
    credential.lastUsedAt = new Date();
    await credential.save();
    await req.redisClient.del(challengeKey);
    await req.redisClient.set(getWebAuthnVerifiedKey(req.adminUser.id), "1", { EX: ADMIN_USERS_REAUTH_TTL_SECONDS });
    await writeAudit(req, "admin-users-webauthn-reauth", true);
    return res.json({ success: true, data: { verified: true, expiresInSeconds: ADMIN_USERS_REAUTH_TTL_SECONDS } });
  } catch (error) {
    await writeAudit(req, "admin-users-webauthn-reauth", false, error.message);
    return res.status(401).json({ success: false, error: "生物识别验证失败" });
  }
});

router.post("/totp/setup", requireRecentWebAuthn, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    if (req.adminUser.totpSecretEncrypted && req.adminUser.totpEnabledAt) {
      return res.status(409).json({ success: false, error: "当前账号已绑定 Authenticator" });
    }
    const secret = generateTotpSecret();
    const encryptedSecret = encryptTotpSecret(secret, TOTP_ENCRYPTION_SECRET);
    const otpauthUri = buildOtpAuthUri({ secret, accountName: req.adminUser.email });
    await req.redisClient.set(getTotpSetupKey(req.adminUser.id), encryptedSecret, { EX: TOTP_SETUP_TTL_SECONDS });
    return res.json({
      success: true,
      data: { secret, otpauthUri, expiresInSeconds: TOTP_SETUP_TTL_SECONDS },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: "生成 Authenticator 绑定信息失败" });
  }
});

router.post("/totp/setup/verify", requireRecentWebAuthn, express.json(), async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    if (!(await assertTotpAttemptsAvailable(req, res))) return;
    const encryptedSecret = await req.redisClient.get(getTotpSetupKey(req.adminUser.id));
    if (!encryptedSecret) return res.status(400).json({ success: false, error: "绑定信息已过期，请重新生成" });
    const result = await verifyAndConsumeTotp(req.adminUser.id, req.body?.code, encryptedSecret);
    if (!result.ok) {
      await recordTotpFailure(req, req.adminUser.id);
      await writeAudit(req, "admin-users-totp-enroll", false, result.reason);
      return res.status(401).json({ success: false, error: "Authenticator 验证码无效或已使用" });
    }
    await Promise.all([
      req.redisClient.del(getTotpSetupKey(req.adminUser.id)),
      req.redisClient.del(getTotpFailureKey(req.adminUser.id)),
      req.redisClient.set(getTotpVerifiedKey(req.adminUser.id), "1", { EX: ADMIN_USERS_REAUTH_TTL_SECONDS }),
    ]);
    await req.adminUser.reload();
    await writeAudit(req, "admin-users-totp-enroll", true);
    return res.json({ success: true, data: { enrolled: true, verified: true, expiresInSeconds: ADMIN_USERS_REAUTH_TTL_SECONDS } });
  } catch (error) {
    await writeAudit(req, "admin-users-totp-enroll", false, error.message);
    return res.status(500).json({ success: false, error: "绑定 Authenticator 失败" });
  }
});

router.post("/totp/verify", requireRecentWebAuthn, express.json(), async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    if (!req.adminUser.totpSecretEncrypted || !req.adminUser.totpEnabledAt) {
      return res.status(403).json({ success: false, code: "TOTP_NOT_ENROLLED", error: "请先绑定 Authenticator" });
    }
    if (!(await assertTotpAttemptsAvailable(req, res))) return;
    const result = await verifyAndConsumeTotp(req.adminUser.id, req.body?.code);
    if (!result.ok) {
      await recordTotpFailure(req, req.adminUser.id);
      await writeAudit(req, "admin-users-totp-reauth", false, result.reason);
      return res.status(401).json({ success: false, error: "Authenticator 验证码无效或已使用" });
    }
    await Promise.all([
      req.redisClient.del(getTotpFailureKey(req.adminUser.id)),
      req.redisClient.set(getTotpVerifiedKey(req.adminUser.id), "1", { EX: ADMIN_USERS_REAUTH_TTL_SECONDS }),
    ]);
    await writeAudit(req, "admin-users-totp-reauth", true);
    return res.json({ success: true, data: { verified: true, expiresInSeconds: ADMIN_USERS_REAUTH_TTL_SECONDS } });
  } catch (error) {
    await writeAudit(req, "admin-users-totp-reauth", false, error.message);
    return res.status(500).json({ success: false, error: "Authenticator 验证失败" });
  }
});

async function requireAdminUsersSecurity(req, res, next) {
  try {
    res.set("Cache-Control", "no-store");
    if (req.adminUser?.role !== "super") {
      return res.status(403).json({ success: false, code: "SUPER_ADMIN_REQUIRED", error: "仅超级管理员可访问管理员列表" });
    }
    const status = await getAdminUsersSecurityStatus(req, req.adminUser);
    if (!status.webauthn.enrolled) {
      return res.status(403).json({ success: false, code: "WEBAUTHN_NOT_ENROLLED", error: "请先绑定生物识别" });
    }
    if (!status.webauthn.verified) {
      return res.status(403).json({ success: false, code: "ADMIN_USERS_WEBAUTHN_REQUIRED", error: "请先完成生物识别验证" });
    }
    if (!status.totp.enrolled) {
      return res.status(403).json({ success: false, code: "TOTP_NOT_ENROLLED", error: "请先绑定 Authenticator" });
    }
    if (!status.totp.verified) {
      return res.status(403).json({ success: false, code: "ADMIN_USERS_TOTP_REQUIRED", error: "请先完成 Authenticator 验证" });
    }
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, error: "检查管理员列表安全认证失败" });
  }
}

module.exports = {
  adminUsersSecurityRouter: router,
  beginAdminTotpSetup,
  finishAdminTotpSetup,
  getAdminTotpStatus,
  getAdminUsersSecurityStatus,
  requireAdminUsersSecurity,
  verifyAdminTotp,
};
