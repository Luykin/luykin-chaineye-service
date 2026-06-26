const jwt = require("jsonwebtoken");
const { randomToken, sha256, getFingerprint, getIpHash } = require("./utils");

function getAccessTokenTtlSeconds() {
  const raw = process.env.AUTH_CENTER_ACCESS_TOKEN_TTL_SECONDS;
  const parsed = raw ? parseInt(raw, 10) : null;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * 60;
}

function getRefreshTokenTtlDays() {
  const raw = process.env.AUTH_CENTER_REFRESH_TOKEN_TTL_DAYS;
  const parsed = raw ? parseInt(raw, 10) : null;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function getIssuer() {
  return process.env.AUTH_CENTER_ISSUER || "xhunt-auth-center";
}

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required for auth center");
  }
  return process.env.JWT_SECRET;
}

async function createSessionAndToken({ models, user, client = null, clientKey = null, req, transaction }) {
  const { AuthCenterXhuntSession, AuthCenterXhuntIdentity } = models;
  const refreshToken = randomToken(48);
  const refreshTokenHash = sha256(refreshToken);
  const accessTokenJti = randomToken(16);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getRefreshTokenTtlDays() * 24 * 60 * 60 * 1000);
  const accessTokenExpiresAt = new Date(now.getTime() + getAccessTokenTtlSeconds() * 1000);
  const identities = await AuthCenterXhuntIdentity.findAll({
    where: { userId: user.id },
    transaction,
  });
  const providers = identities.map((item) => item.provider);

  const session = await AuthCenterXhuntSession.create(
    {
      userId: user.id,
      clientId: client?.id || null,
      clientKey: client?.clientKey || clientKey || null,
      refreshTokenHash,
      accessTokenJti,
      fingerprint: getFingerprint(req),
      userAgent: req.headers["user-agent"] || null,
      ipHash: getIpHash(req),
      lastUsedAt: now,
      expiresAt,
    },
    { transaction }
  );

  const accessToken = jwt.sign(
    {
      sub: user.id,
      sid: session.id,
      jti: accessTokenJti,
      aud: client?.clientKey || clientKey || undefined,
      iss: getIssuer(),
      xhuntUserId: user.xhuntUserId || null,
      providers,
    },
    getJwtSecret(),
    { expiresIn: getAccessTokenTtlSeconds() }
  );

  return {
    session,
    token: {
      accessToken,
      refreshToken,
      expiresAt: accessTokenExpiresAt.getTime(),
      tokenType: "Bearer",
    },
  };
}

async function refreshSessionToken({ models, refreshToken, req }) {
  const { AuthCenterXhuntSession, AuthCenterXhuntUser, AuthCenterXhuntIdentity } = models;
  const refreshTokenHash = sha256(refreshToken);
  const session = await AuthCenterXhuntSession.findOne({
    where: { refreshTokenHash, revokedAt: null },
    include: [{ model: AuthCenterXhuntUser, as: "user" }],
  });

  if (!session || session.expiresAt <= new Date()) {
    const err = new Error("REFRESH_TOKEN_INVALID");
    err.status = 419;
    throw err;
  }

  if (!session.user || session.user.status !== "active") {
    const err = new Error("USER_DISABLED");
    err.status = 403;
    throw err;
  }

  const newRefreshToken = randomToken(48);
  const accessTokenJti = randomToken(16);
  const accessTokenExpiresAt = new Date(Date.now() + getAccessTokenTtlSeconds() * 1000);
  const identities = await AuthCenterXhuntIdentity.findAll({ where: { userId: session.userId } });
  const providers = identities.map((item) => item.provider);

  await session.update({
    refreshTokenHash: sha256(newRefreshToken),
    accessTokenJti,
    lastUsedAt: new Date(),
    fingerprint: getFingerprint(req) || session.fingerprint,
    userAgent: req.headers["user-agent"] || session.userAgent,
    ipHash: getIpHash(req) || session.ipHash,
  });

  const accessToken = jwt.sign(
    {
      sub: session.userId,
      sid: session.id,
      jti: accessTokenJti,
      aud: session.clientKey || undefined,
      iss: getIssuer(),
      xhuntUserId: session.user.xhuntUserId || null,
      providers,
    },
    getJwtSecret(),
    { expiresIn: getAccessTokenTtlSeconds() }
  );

  return {
    user: session.user,
    identities,
    token: {
      accessToken,
      refreshToken: newRefreshToken,
      expiresAt: accessTokenExpiresAt.getTime(),
      tokenType: "Bearer",
    },
  };
}

module.exports = {
  createSessionAndToken,
  refreshSessionToken,
  getIssuer,
};
