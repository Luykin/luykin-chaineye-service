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

// DB Admin 是直接改 PostgreSQL 的高危入口；必须完成一次近期 WebAuthn 二次认证。
// TTL 默认和备份恢复一致：10 分钟。过期后前端会重新弹指纹 / Face ID / 通行密钥。
const DB_ADMIN_REAUTH_TTL_SECONDS = Math.max(
  60,
  parseInt(process.env.ADMIN_DB_ADMIN_WEBAUTHN_TTL_SECONDS || "600", 10) || 600
);

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
  if (credentials.length <= 0) {
    return {
      enrolled: false,
      verified: false,
      ttlSeconds: 0,
      expiresInSeconds: DB_ADMIN_REAUTH_TTL_SECONDS,
    };
  }

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

  return {
    enrolled: true,
    verified: verified === "1",
    ttlSeconds,
    expiresInSeconds: DB_ADMIN_REAUTH_TTL_SECONDS,
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

async function requireDbAdminWebAuthn(req, res, next) {
  try {
    res.set("Cache-Control", "no-store");
    const admin = req.adminUser;
    if (!admin?.id) {
      return res.status(401).json({ success: false, error: "UNAUTHORIZED", message: "请先登录" });
    }

    const status = await getDbAdminWebAuthnStatus(req, admin);
    if (!status.enrolled) {
      return res.status(403).json({
        success: false,
        error: "需要先录入生物识别",
        code: "WEBAUTHN_NOT_ENROLLED",
        message: "DB Admin 必须先在当前管理员账号录入指纹 / Face ID / 通行密钥",
      });
    }

    if (!status.verified) {
      return res.status(403).json({
        success: false,
        error: "需要生物识别二次验证",
        code: "WEBAUTHN_REAUTH_REQUIRED",
        message: "请先完成指纹 / Face ID / 通行密钥验证后再进入数据表管理",
      });
    }

    return next();
  } catch (error) {
    console.error("[db-admin webauthn] check failed:", error);
    return res.status(500).json({ success: false, error: "DB Admin 指纹认证检查失败" });
  }
}

module.exports = {
  DB_ADMIN_REAUTH_TTL_SECONDS,
  getDbAdminWebAuthnStatus,
  createDbAdminWebAuthnOptions,
  verifyDbAdminWebAuthn,
  requireDbAdminWebAuthn,
};
