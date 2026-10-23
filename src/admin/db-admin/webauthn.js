const base64url = require("base64url");
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { XhuntAdminWebAuthnCredential } = require("../../models/postgres-start");
const {
  getWebAuthnRequestConfig,
  filterWebAuthnCredentialsForRp,
} = require("../utils/webauthnConfig");
const { getAdminTotpStatus } = require("../admin-users/security");

// DB Admin 是直接操作 PostgreSQL 的高危入口：所有账号必须完成近期 WebAuthn；
// 超级管理员还必须完成 Authenticator。TTL 默认和备份恢复一致：10 分钟。
const DB_ADMIN_REAUTH_TTL_SECONDS = Math.max(
  60,
  parseInt(process.env.ADMIN_DB_ADMIN_WEBAUTHN_TTL_SECONDS || "600", 10) || 600
);
const DB_ADMIN_TOTP_SCOPE = "db-admin";

function getDbAdminReauthKey(adminId) {
  return `admin:webauthn:reauth:db-admin:${adminId}`;
}

function getDbAdminChallengeKey(adminId) {
  return `webauthn:db-admin:challenge:${adminId}`;
}

function getCredentialKeyFromAssertion(assertion) {
  if (typeof assertion?.id === "string") return assertion.id;
  if (typeof assertion?.rawId === "string") return assertion.rawId;
  return null;
}

function buildAuthenticatorFromCredential(row) {
  return {
    credentialID: base64url.toBuffer(row.credentialId),
    credentialPublicKey: base64url.toBuffer(row.publicKey),
    counter: Number(row.counter || 0),
  };
}

async function getDbAdminWebAuthnStatus(req, admin) {
  const webAuthnConfig = getWebAuthnRequestConfig(req);
  const credentials = filterWebAuthnCredentialsForRp(
    await XhuntAdminWebAuthnCredential.findAll({ where: { adminId: admin.id } }),
    webAuthnConfig.rpID,
  );
  const totpRequired = admin.role === "super";
  const totp = totpRequired
    ? await getAdminTotpStatus(req, admin, DB_ADMIN_TOTP_SCOPE, DB_ADMIN_REAUTH_TTL_SECONDS)
    : null;
  if (credentials.length <= 0) return {
    enrolled: false,
    verified: false,
    ttlSeconds: 0,
    expiresInSeconds: DB_ADMIN_REAUTH_TTL_SECONDS,
    totpRequired,
    totp,
    accessVerified: false,
  };

  const key = getDbAdminReauthKey(admin.id);
  const verified = await req.redisClient.get(key);
  let ttlSeconds = 0;
  if (verified === "1" && typeof req.redisClient.ttl === "function") {
    try {
      ttlSeconds = Math.max(0, await req.redisClient.ttl(key));
    } catch (_) {
      ttlSeconds = 0;
    }
  }

  const webauthnVerified = verified === "1";
  return {
    enrolled: true,
    verified: webauthnVerified,
    ttlSeconds,
    expiresInSeconds: DB_ADMIN_REAUTH_TTL_SECONDS,
    totpRequired,
    totp,
    accessVerified: webauthnVerified && (!totpRequired || !!totp?.verified),
  };
}

async function createDbAdminWebAuthnOptions(req, admin) {
  const webAuthnConfig = getWebAuthnRequestConfig(req);
  const creds = filterWebAuthnCredentialsForRp(
    await XhuntAdminWebAuthnCredential.findAll({ where: { adminId: admin.id } }),
    webAuthnConfig.rpID,
  );
  if (!creds.length) {
    const error = new Error("DB Admin 需要先录入指纹 / Face ID / 通行密钥");
    error.statusCode = 403;
    error.code = "WEBAUTHN_NOT_ENROLLED";
    throw error;
  }

  const allowCredentials = creds.map((credential) => ({
    id: base64url.toBuffer(credential.credentialId),
    type: "public-key",
  }));
  const options = await generateAuthenticationOptions({
    rpID: webAuthnConfig.rpID,
    userVerification: "required",
    allowCredentials,
  });

  await req.redisClient.set(getDbAdminChallengeKey(admin.id), options.challenge, { EX: 300 });
  return options;
}

async function verifyDbAdminWebAuthn(req, admin, assertion) {
  if (!assertion) {
    const error = new Error("缺少验证结果");
    error.statusCode = 400;
    throw error;
  }

  const challengeKey = getDbAdminChallengeKey(admin.id);
  const expectedChallenge = await req.redisClient.get(challengeKey);
  if (!expectedChallenge) {
    const error = new Error("认证超时，请重新验证");
    error.statusCode = 400;
    throw error;
  }

  const webAuthnConfig = getWebAuthnRequestConfig(req);
  const creds = filterWebAuthnCredentialsForRp(
    await XhuntAdminWebAuthnCredential.findAll({ where: { adminId: admin.id } }),
    webAuthnConfig.rpID,
  );
  if (!creds.length) {
    const error = new Error("DB Admin 需要先录入指纹 / Face ID / 通行密钥");
    error.statusCode = 403;
    error.code = "WEBAUTHN_NOT_ENROLLED";
    throw error;
  }

  const credentialLookup = new Map(creds.map((credential) => [credential.credentialId, credential]));
  const credKey = getCredentialKeyFromAssertion(assertion);
  const credential = credKey ? credentialLookup.get(credKey) : null;
  if (!credential) {
    const error = new Error("未识别的生物识别凭证");
    error.statusCode = 401;
    throw error;
  }

  const verification = await verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge,
    expectedOrigin: webAuthnConfig.origin,
    expectedRPID: webAuthnConfig.rpID,
    authenticator: buildAuthenticatorFromCredential(credential),
    requireUserVerification: true,
  });

  const { verified, authenticationInfo } = verification;
  if (!verified || !authenticationInfo) {
    const error = new Error("验证失败");
    error.statusCode = 401;
    throw error;
  }

  credential.counter = Number(authenticationInfo.newCounter || authenticationInfo.counter || 0);
  credential.lastUsedAt = new Date();
  await credential.save();

  await req.redisClient.del(challengeKey);
  await req.redisClient.set(getDbAdminReauthKey(admin.id), "1", { EX: DB_ADMIN_REAUTH_TTL_SECONDS });

  return {
    verified: true,
    expiresInSeconds: DB_ADMIN_REAUTH_TTL_SECONDS,
  };
}

function createDbAdminSecurityError(statusCode, code, message, detail = message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.detail = detail;
  return error;
}

async function assertDbAdminRecentWebAuthn(req) {
  const admin = req.adminUser;
  if (!admin?.id) throw createDbAdminSecurityError(401, "UNAUTHORIZED", "请先登录");
  const status = await getDbAdminWebAuthnStatus(req, admin);
  if (!status.enrolled) {
    throw createDbAdminSecurityError(
      403,
      "WEBAUTHN_NOT_ENROLLED",
      "需要先录入生物识别",
      "DB Admin 必须先在当前管理员账号录入指纹 / Face ID / 通行密钥",
    );
  }
  if (!status.verified) {
    throw createDbAdminSecurityError(
      403,
      "WEBAUTHN_REAUTH_REQUIRED",
      "需要生物识别二次验证",
      "请先完成指纹 / Face ID / 通行密钥验证后再进入数据表管理",
    );
  }
}

function sendDbAdminSecurityError(res, error, fallbackMessage) {
  if (!error.statusCode || error.statusCode >= 500) console.error("[db-admin security] check failed:", error);
  return res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || fallbackMessage,
    code: error.code,
    message: error.detail,
  });
}

async function requireDbAdminRecentWebAuthn(req, res, next) {
  try {
    res.set("Cache-Control", "no-store");
    await assertDbAdminRecentWebAuthn(req);
    return next();
  } catch (error) {
    return sendDbAdminSecurityError(res, error, "DB Admin 指纹认证检查失败");
  }
}

async function requireDbAdminWebAuthn(req, res, next) {
  try {
    res.set("Cache-Control", "no-store");
    await assertDbAdminRecentWebAuthn(req);
    if (req.adminUser?.role !== "super") return next();
    const status = await getAdminTotpStatus(
      req,
      req.adminUser,
      DB_ADMIN_TOTP_SCOPE,
      DB_ADMIN_REAUTH_TTL_SECONDS,
    );
    if (!status.enrolled) {
      throw createDbAdminSecurityError(
        403,
        "TOTP_NOT_ENROLLED",
        "需要先绑定 Authenticator",
        "超级管理员进入 DB Admin 前必须先绑定 Authenticator",
      );
    }
    if (!status.verified) {
      throw createDbAdminSecurityError(
        403,
        "TOTP_REAUTH_REQUIRED",
        "需要 Authenticator 二次验证",
        "请先完成 Authenticator 验证后再进入数据表管理",
      );
    }
    return next();
  } catch (error) {
    return sendDbAdminSecurityError(res, error, "DB Admin 安全认证检查失败");
  }
}

module.exports = {
  DB_ADMIN_REAUTH_TTL_SECONDS,
  DB_ADMIN_TOTP_SCOPE,
  getDbAdminWebAuthnStatus,
  createDbAdminWebAuthnOptions,
  verifyDbAdminWebAuthn,
  requireDbAdminRecentWebAuthn,
  requireDbAdminWebAuthn,
};
