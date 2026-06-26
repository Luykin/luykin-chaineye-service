const express = require("express");
const axios = require("axios");
const { body, query, param } = require("express-validator");
const { validateRequest } = require("../../middleware/validate-request");
const {
  pgInstance,
  AuthCenterXhuntUser,
  AuthCenterXhuntIdentity,
  AuthCenterXhuntPasswordCredential,
  AuthCenterXhuntClient,
  AuthCenterXhuntSession,
  AuthCenterXhuntAuditLog,
  XHuntUser,
} = require("../../../models/postgres-start");
const { authenticateAuthCenterToken } = require("../middleware/auth");
const { buildPublicUser } = require("../services/display-name");
const {
  PROVIDERS,
  findActiveClient,
  registerWithPassword,
  loginWithPassword,
  upsertOAuthIdentityLogin,
  bindPasswordIdentity,
  bindOAuthIdentityToUser,
  unbindIdentity,
  buildWalletProfile,
  createAuditLog,
} = require("../services/auth");
const { createSessionAndToken, refreshSessionToken } = require("../services/token");
const { randomToken, sha256, extractEvm40Address, getFingerprint } = require("../services/utils");
const {
  generateTwitterAuthUrl,
  getTwitterTokens,
  getTwitterUserInfo,
} = require("../../services/twitter-web");

const router = express.Router();

const models = {
  AuthCenterXhuntUser,
  AuthCenterXhuntIdentity,
  AuthCenterXhuntPasswordCredential,
  AuthCenterXhuntClient,
  AuthCenterXhuntSession,
  AuthCenterXhuntAuditLog,
  XHuntUser,
};

function sendError(res, error, fallback = "AUTH_CENTER_ERROR") {
  const status = error.status || 500;
  return res.status(status).json({
    error: error.message || fallback,
    message: error.publicMessage || undefined,
  });
}

async function buildLoginResponse(req, { user, identities, isNewUser, clientKey, transaction }) {
  const client = await findActiveClient(models, clientKey);
  const { token } = await createSessionAndToken({
    models,
    user,
    client,
    clientKey,
    req,
    transaction,
  });

  return {
    token,
    user: buildPublicUser(user, identities),
    isNewUser: !!isNewUser,
  };
}

function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || process.env.AUTH_CENTER_GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    const err = new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
    err.status = 500;
    throw err;
  }
  return { clientId, clientSecret, redirectUri };
}

function getWalletNonceKey(address) {
  const evm40 = extractEvm40Address(address);
  return `auth_center_wallet_nonce:${evm40 || String(address || "").trim().toLowerCase()}`;
}

async function fetchGoogleProfileByCode(code) {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig();
  const tokenRes = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 }
  );
  const accessToken = tokenRes.data.access_token;
  const refreshToken = tokenRes.data.refresh_token;
  const expiresIn = tokenRes.data.expires_in;
  const profileRes = await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000,
  });
  const googleUser = profileRes.data;

  return {
    providerSubject: googleUser.sub,
    providerSubjectLower: googleUser.sub,
    username: googleUser.email,
    displayName: googleUser.name,
    email: googleUser.email,
    emailVerified: !!googleUser.email_verified,
    avatar: googleUser.picture,
    accessToken,
    refreshToken,
    tokenExpiry: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
  };
}

router.post(
  "/password/register",
  [
    body("accountName").isString().trim().notEmpty(),
    body("password").isString().notEmpty(),
    body("clientKey").optional().isString().trim(),
    validateRequest,
  ],
  async (req, res) => {
    const { accountName, password, clientKey } = req.body;
    const transaction = await pgInstance.transaction();
    try {
      const result = await registerWithPassword(models, { accountName, password }, transaction);
      await createAuditLog(models, req, {
        userId: result.user.id,
        clientKey,
        eventType: "login_success",
        provider: PROVIDERS.PASSWORD,
        success: true,
        reason: "password_register",
      });
      const responsePayload = await buildLoginResponse(req, { ...result, clientKey, transaction });
      await transaction.commit();
      return res.json(responsePayload);
    } catch (error) {
      await transaction.rollback();
      await createAuditLog(models, req, {
        clientKey,
        eventType: "login_failed",
        provider: PROVIDERS.PASSWORD,
        success: false,
        reason: error.message,
      });
      return sendError(res, error, "PASSWORD_REGISTER_FAILED");
    }
  }
);

router.post(
  "/password/login",
  [
    body("accountName").isString().trim().notEmpty(),
    body("password").isString().notEmpty(),
    body("clientKey").optional().isString().trim(),
    validateRequest,
  ],
  async (req, res) => {
    const { accountName, password, clientKey } = req.body;
    const transaction = await pgInstance.transaction();
    try {
      const result = await loginWithPassword(models, { accountName, password }, transaction);
      await createAuditLog(models, req, {
        userId: result.user.id,
        clientKey,
        eventType: "login_success",
        provider: PROVIDERS.PASSWORD,
        success: true,
      });
      const responsePayload = await buildLoginResponse(req, { ...result, clientKey, transaction });
      await transaction.commit();
      return res.json(responsePayload);
    } catch (error) {
      await transaction.rollback();
      await createAuditLog(models, req, {
        clientKey,
        eventType: "login_failed",
        provider: PROVIDERS.PASSWORD,
        success: false,
        reason: error.message,
      });
      return sendError(res, error, "PASSWORD_LOGIN_FAILED");
    }
  }
);

router.get("/me", authenticateAuthCenterToken(), async (req, res) => {
  res.set("Cache-Control", "private, max-age=120");
  return res.json(req.authCenter.publicUser);
});

router.post(
  "/token/refresh",
  [body("refreshToken").isString().trim().notEmpty(), validateRequest],
  async (req, res) => {
    try {
      const result = await refreshSessionToken({
        models,
        refreshToken: req.body.refreshToken,
        req,
      });
      return res.json({
        token: result.token,
        user: buildPublicUser(result.user, result.identities),
      });
    } catch (error) {
      return sendError(res, error, "TOKEN_REFRESH_FAILED");
    }
  }
);

router.post("/logout", authenticateAuthCenterToken(), async (req, res) => {
  try {
    await req.authCenter.session.update({
      revokedAt: new Date(),
      revokeReason: "logout",
    });
    await createAuditLog(models, req, {
      userId: req.authCenter.user.id,
      clientKey: req.authCenter.session.clientKey,
      eventType: "logout",
      success: true,
    });
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, error, "LOGOUT_FAILED");
  }
});

router.post("/logout-all", authenticateAuthCenterToken(), async (req, res) => {
  try {
    await AuthCenterXhuntSession.update(
      {
        revokedAt: new Date(),
        revokeReason: "logout_all",
      },
      {
        where: {
          userId: req.authCenter.user.id,
          revokedAt: null,
        },
      }
    );
    await createAuditLog(models, req, {
      userId: req.authCenter.user.id,
      clientKey: req.authCenter.session.clientKey,
      eventType: "logout_all",
      success: true,
    });
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, error, "LOGOUT_ALL_FAILED");
  }
});

router.get(
  "/wallet/nonce",
  [query("address").isString().trim().notEmpty(), query("clientKey").optional().isString().trim(), validateRequest],
  async (req, res) => {
    try {
      const address = extractEvm40Address(req.query.address);
      if (!address) {
        return res.status(400).json({ error: "INVALID_EVM_ADDRESS" });
      }
      const nonce = randomToken(16);
      const issuedAt = new Date().toISOString();
      const domain = req.headers.origin || req.headers.host || "xhunt-auth-center";
      const clientKey = req.query.clientKey || "xhunt-web";
      const message = [
        `${domain} wants you to sign in with your Ethereum account:`,
        address,
        "",
        "Sign in to XHunt Auth Center. No transaction or gas fee.",
        "",
        `URI: ${domain}`,
        "Version: 1",
        "Chain ID: 1",
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
        `Client Key: ${clientKey}`,
      ].join("\n");

      await req.redisClient.setEx(
        getWalletNonceKey(address),
        5 * 60,
        JSON.stringify({ address, nonce, message, clientKey, issuedAt })
      );

      return res.json({ address, nonce, message, expiresIn: 300 });
    } catch (error) {
      return sendError(res, error, "WALLET_NONCE_FAILED");
    }
  }
);

router.post(
  "/wallet/verify",
  [
    body("address").isString().trim().notEmpty(),
    body("signature").isString().trim().notEmpty(),
    body("message").optional().isString(),
    body("clientKey").optional().isString().trim(),
    validateRequest,
  ],
  async (req, res) => {
    const transaction = await pgInstance.transaction();
    try {
      const address = extractEvm40Address(req.body.address);
      if (!address) {
        const err = new Error("INVALID_EVM_ADDRESS");
        err.status = 400;
        throw err;
      }
      const raw = await req.redisClient.get(getWalletNonceKey(address));
      const cached = raw ? JSON.parse(raw) : null;
      if (!cached) {
        const err = new Error("CHALLENGE_NOT_FOUND_OR_EXPIRED");
        err.status = 400;
        throw err;
      }
      if (req.body.message && req.body.message !== cached.message) {
        const err = new Error("MESSAGE_MISMATCH");
        err.status = 400;
        throw err;
      }
      const { utils } = require("ethers");
      const recovered = utils.verifyMessage(cached.message, req.body.signature);
      if (!recovered || recovered.toLowerCase() !== address) {
        const err = new Error("ADDRESS_MISMATCH");
        err.status = 400;
        throw err;
      }
      await req.redisClient.del(getWalletNonceKey(address));

      const result = await upsertOAuthIdentityLogin(
        models,
        PROVIDERS.EVM,
        buildWalletProfile(address),
        transaction
      );
      await createAuditLog(models, req, {
        userId: result.user.id,
        clientKey: req.body.clientKey || cached.clientKey,
        eventType: "login_success",
        provider: PROVIDERS.EVM,
        success: true,
      });
      const responsePayload = await buildLoginResponse(req, {
        ...result,
        clientKey: req.body.clientKey || cached.clientKey,
        transaction,
      });
      await transaction.commit();
      return res.json(responsePayload);
    } catch (error) {
      await transaction.rollback();
      await createAuditLog(models, req, {
        clientKey: req.body.clientKey,
        eventType: "login_failed",
        provider: PROVIDERS.EVM,
        success: false,
        reason: error.message,
      });
      return sendError(res, error, "WALLET_LOGIN_FAILED");
    }
  }
);

router.post(
  "/twitter/url",
  [body("clientKey").optional().isString().trim(), validateRequest],
  async (req, res) => {
    try {
      const clientKey = req.body.clientKey || "xhunt-web";
      const url = await generateTwitterAuthUrl(async (state, codeVerifier) => {
        await req.redisClient.setEx(
          `auth_center_twitter_oauth_state:${state}`,
          8 * 60,
          JSON.stringify({ codeVerifier, clientKey, createdAt: Date.now() })
        );
      }, clientKey);
      return res.json({ url, clientKey });
    } catch (error) {
      return sendError(res, error, "TWITTER_AUTH_URL_FAILED");
    }
  }
);

router.post(
  "/twitter/callback",
  [body("code").isString().trim().notEmpty(), body("state").isString().trim().notEmpty(), validateRequest],
  async (req, res) => {
    const transaction = await pgInstance.transaction();
    try {
      const cacheKey = `auth_center_twitter_oauth_state:${req.body.state}`;
      const raw = await req.redisClient.get(cacheKey);
      const cached = raw ? JSON.parse(raw) : null;
      if (!cached?.codeVerifier) {
        const err = new Error("INVALID_OR_EXPIRED_STATE");
        err.status = 400;
        throw err;
      }
      await req.redisClient.del(cacheKey);

      const { accessToken, refreshToken, expiresIn } = await getTwitterTokens(
        req.body.code,
        cached.codeVerifier
      );
      const twitterUser = await getTwitterUserInfo(accessToken);
      const result = await upsertOAuthIdentityLogin(
        models,
        PROVIDERS.TWITTER,
        {
          providerSubject: twitterUser.id,
          providerSubjectLower: twitterUser.id,
          username: twitterUser.username,
          displayName: twitterUser.name,
          avatar: twitterUser.profile_image_url,
          accessToken,
          refreshToken,
          tokenExpiry: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        },
        transaction
      );
      await createAuditLog(models, req, {
        userId: result.user.id,
        clientKey: cached.clientKey,
        eventType: "login_success",
        provider: PROVIDERS.TWITTER,
        success: true,
      });
      const responsePayload = await buildLoginResponse(req, { ...result, clientKey: cached.clientKey, transaction });
      await transaction.commit();
      return res.json(responsePayload);
    } catch (error) {
      await transaction.rollback();
      await createAuditLog(models, req, {
        eventType: "login_failed",
        provider: PROVIDERS.TWITTER,
        success: false,
        reason: error.message,
      });
      return sendError(res, error, "TWITTER_LOGIN_FAILED");
    }
  }
);

router.post(
  "/google/url",
  [body("clientKey").optional().isString().trim(), validateRequest],
  async (req, res) => {
    try {
      const { clientId, redirectUri } = getGoogleConfig();
      const state = randomToken(24);
      const clientKey = req.body.clientKey || "xhunt-web";
      await req.redisClient.setEx(
        `auth_center_google_oauth_state:${state}`,
        8 * 60,
        JSON.stringify({ clientKey, createdAt: Date.now() })
      );
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        access_type: "offline",
        prompt: "consent",
      });
      return res.json({
        url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
        clientKey,
      });
    } catch (error) {
      return sendError(res, error, "GOOGLE_AUTH_URL_FAILED");
    }
  }
);

router.post(
  "/google/callback",
  [body("code").isString().trim().notEmpty(), body("state").isString().trim().notEmpty(), validateRequest],
  async (req, res) => {
    const transaction = await pgInstance.transaction();
    try {
      const cacheKey = `auth_center_google_oauth_state:${req.body.state}`;
      const raw = await req.redisClient.get(cacheKey);
      const cached = raw ? JSON.parse(raw) : null;
      if (!cached) {
        const err = new Error("INVALID_OR_EXPIRED_STATE");
        err.status = 400;
        throw err;
      }
      await req.redisClient.del(cacheKey);

      const result = await upsertOAuthIdentityLogin(
        models,
        PROVIDERS.GOOGLE,
        await fetchGoogleProfileByCode(req.body.code),
        transaction
      );
      await createAuditLog(models, req, {
        userId: result.user.id,
        clientKey: cached.clientKey,
        eventType: "login_success",
        provider: PROVIDERS.GOOGLE,
        success: true,
      });
      const responsePayload = await buildLoginResponse(req, { ...result, clientKey: cached.clientKey, transaction });
      await transaction.commit();
      return res.json(responsePayload);
    } catch (error) {
      await transaction.rollback();
      await createAuditLog(models, req, {
        eventType: "login_failed",
        provider: PROVIDERS.GOOGLE,
        success: false,
        reason: error.message,
      });
      return sendError(res, error, "GOOGLE_LOGIN_FAILED");
    }
  }
);

router.post(
  "/identities/password/bind",
  authenticateAuthCenterToken(),
  [
    body("accountName").isString().trim().notEmpty(),
    body("password").isString().notEmpty(),
    validateRequest,
  ],
  async (req, res) => {
    const transaction = await pgInstance.transaction();
    try {
      const result = await bindPasswordIdentity(
        models,
        req.authCenter.user,
        {
          accountName: req.body.accountName,
          password: req.body.password,
        },
        transaction
      );
      await createAuditLog(models, req, {
        userId: req.authCenter.user.id,
        clientKey: req.authCenter.session.clientKey,
        eventType: "bind_identity",
        provider: PROVIDERS.PASSWORD,
        success: true,
      });
      const userPayload = buildPublicUser(result.user, result.identities);
      await transaction.commit();
      return res.json({ success: true, user: userPayload });
    } catch (error) {
      await transaction.rollback();
      await createAuditLog(models, req, {
        userId: req.authCenter.user.id,
        clientKey: req.authCenter.session.clientKey,
        eventType: "bind_identity",
        provider: PROVIDERS.PASSWORD,
        success: false,
        reason: error.message,
      });
      return sendError(res, error, "PASSWORD_BIND_FAILED");
    }
  }
);

router.post(
  "/identities/evm/bind",
  authenticateAuthCenterToken(),
  [
    body("address").isString().trim().notEmpty(),
    body("signature").isString().trim().notEmpty(),
    body("message").optional().isString(),
    validateRequest,
  ],
  async (req, res) => {
    const transaction = await pgInstance.transaction();
    try {
      const address = extractEvm40Address(req.body.address);
      if (!address) {
        const err = new Error("INVALID_EVM_ADDRESS");
        err.status = 400;
        throw err;
      }
      const raw = await req.redisClient.get(getWalletNonceKey(address));
      const cached = raw ? JSON.parse(raw) : null;
      if (!cached) {
        const err = new Error("CHALLENGE_NOT_FOUND_OR_EXPIRED");
        err.status = 400;
        throw err;
      }
      if (req.body.message && req.body.message !== cached.message) {
        const err = new Error("MESSAGE_MISMATCH");
        err.status = 400;
        throw err;
      }

      const { utils } = require("ethers");
      const recovered = utils.verifyMessage(cached.message, req.body.signature);
      if (!recovered || recovered.toLowerCase() !== address) {
        const err = new Error("ADDRESS_MISMATCH");
        err.status = 400;
        throw err;
      }
      await req.redisClient.del(getWalletNonceKey(address));

      const result = await bindOAuthIdentityToUser(
        models,
        req.authCenter.user,
        PROVIDERS.EVM,
        buildWalletProfile(address),
        transaction
      );
      await createAuditLog(models, req, {
        userId: req.authCenter.user.id,
        clientKey: req.authCenter.session.clientKey,
        eventType: "bind_identity",
        provider: PROVIDERS.EVM,
        success: true,
      });
      const userPayload = buildPublicUser(result.user, result.identities);
      await transaction.commit();
      return res.json({ success: true, user: userPayload });
    } catch (error) {
      await transaction.rollback();
      await createAuditLog(models, req, {
        userId: req.authCenter.user.id,
        clientKey: req.authCenter.session.clientKey,
        eventType: "bind_identity",
        provider: PROVIDERS.EVM,
        success: false,
        reason: error.message,
      });
      return sendError(res, error, "EVM_BIND_FAILED");
    }
  }
);

router.post(
  "/identities/twitter/url",
  authenticateAuthCenterToken(),
  [body("clientKey").optional().isString().trim(), validateRequest],
  async (req, res) => {
    try {
      const clientKey = req.body.clientKey || req.authCenter.session.clientKey || "xhunt-web";
      const url = await generateTwitterAuthUrl(async (state, codeVerifier) => {
        await req.redisClient.setEx(
          `auth_center_twitter_bind_state:${state}`,
          8 * 60,
          JSON.stringify({
            codeVerifier,
            clientKey,
            userId: req.authCenter.user.id,
            sessionId: req.authCenter.session.id,
            createdAt: Date.now(),
          })
        );
      }, clientKey);
      return res.json({ url, clientKey });
    } catch (error) {
      return sendError(res, error, "TWITTER_BIND_URL_FAILED");
    }
  }
);

router.post(
  "/identities/twitter/callback",
  [body("code").isString().trim().notEmpty(), body("state").isString().trim().notEmpty(), validateRequest],
  async (req, res) => {
    const transaction = await pgInstance.transaction();
    try {
      const cacheKey = `auth_center_twitter_bind_state:${req.body.state}`;
      const raw = await req.redisClient.get(cacheKey);
      const cached = raw ? JSON.parse(raw) : null;
      if (!cached?.codeVerifier || !cached?.userId) {
        const err = new Error("INVALID_OR_EXPIRED_STATE");
        err.status = 400;
        throw err;
      }
      await req.redisClient.del(cacheKey);

      const user = await AuthCenterXhuntUser.findByPk(cached.userId, { transaction });
      if (!user || user.status !== "active") {
        const err = new Error("USER_DISABLED");
        err.status = 403;
        throw err;
      }

      const { accessToken, refreshToken, expiresIn } = await getTwitterTokens(
        req.body.code,
        cached.codeVerifier
      );
      const twitterUser = await getTwitterUserInfo(accessToken);
      const result = await bindOAuthIdentityToUser(
        models,
        user,
        PROVIDERS.TWITTER,
        {
          providerSubject: twitterUser.id,
          providerSubjectLower: twitterUser.id,
          username: twitterUser.username,
          displayName: twitterUser.name,
          avatar: twitterUser.profile_image_url,
          accessToken,
          refreshToken,
          tokenExpiry: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        },
        transaction
      );
      await createAuditLog(models, req, {
        userId: user.id,
        clientKey: cached.clientKey,
        eventType: "bind_identity",
        provider: PROVIDERS.TWITTER,
        success: true,
      });
      const userPayload = buildPublicUser(result.user, result.identities);
      await transaction.commit();
      return res.json({ success: true, user: userPayload });
    } catch (error) {
      await transaction.rollback();
      await createAuditLog(models, req, {
        eventType: "bind_identity",
        provider: PROVIDERS.TWITTER,
        success: false,
        reason: error.message,
      });
      return sendError(res, error, "TWITTER_BIND_FAILED");
    }
  }
);

router.post(
  "/identities/google/url",
  authenticateAuthCenterToken(),
  [body("clientKey").optional().isString().trim(), validateRequest],
  async (req, res) => {
    try {
      const { clientId, redirectUri } = getGoogleConfig();
      const state = randomToken(24);
      const clientKey = req.body.clientKey || req.authCenter.session.clientKey || "xhunt-web";
      await req.redisClient.setEx(
        `auth_center_google_bind_state:${state}`,
        8 * 60,
        JSON.stringify({
          clientKey,
          userId: req.authCenter.user.id,
          sessionId: req.authCenter.session.id,
          createdAt: Date.now(),
        })
      );
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        access_type: "offline",
        prompt: "consent",
      });
      return res.json({
        url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
        clientKey,
      });
    } catch (error) {
      return sendError(res, error, "GOOGLE_BIND_URL_FAILED");
    }
  }
);

router.post(
  "/identities/google/callback",
  [body("code").isString().trim().notEmpty(), body("state").isString().trim().notEmpty(), validateRequest],
  async (req, res) => {
    const transaction = await pgInstance.transaction();
    try {
      const cacheKey = `auth_center_google_bind_state:${req.body.state}`;
      const raw = await req.redisClient.get(cacheKey);
      const cached = raw ? JSON.parse(raw) : null;
      if (!cached?.userId) {
        const err = new Error("INVALID_OR_EXPIRED_STATE");
        err.status = 400;
        throw err;
      }
      await req.redisClient.del(cacheKey);

      const user = await AuthCenterXhuntUser.findByPk(cached.userId, { transaction });
      if (!user || user.status !== "active") {
        const err = new Error("USER_DISABLED");
        err.status = 403;
        throw err;
      }

      const result = await bindOAuthIdentityToUser(
        models,
        user,
        PROVIDERS.GOOGLE,
        await fetchGoogleProfileByCode(req.body.code),
        transaction
      );
      await createAuditLog(models, req, {
        userId: user.id,
        clientKey: cached.clientKey,
        eventType: "bind_identity",
        provider: PROVIDERS.GOOGLE,
        success: true,
      });
      const userPayload = buildPublicUser(result.user, result.identities);
      await transaction.commit();
      return res.json({ success: true, user: userPayload });
    } catch (error) {
      await transaction.rollback();
      await createAuditLog(models, req, {
        eventType: "bind_identity",
        provider: PROVIDERS.GOOGLE,
        success: false,
        reason: error.message,
      });
      return sendError(res, error, "GOOGLE_BIND_FAILED");
    }
  }
);

router.delete(
  "/identities/:identityId",
  authenticateAuthCenterToken(),
  [param("identityId").isUUID(), validateRequest],
  async (req, res) => {
    const transaction = await pgInstance.transaction();
    try {
      const result = await unbindIdentity(
        models,
        req.authCenter.user,
        req.params.identityId,
        transaction
      );
      await createAuditLog(models, req, {
        userId: req.authCenter.user.id,
        clientKey: req.authCenter.session.clientKey,
        eventType: "unbind_identity",
        provider: result.removedProvider,
        success: true,
      });
      const userPayload = buildPublicUser(result.user, result.identities);
      await transaction.commit();
      return res.json({ success: true, user: userPayload });
    } catch (error) {
      await transaction.rollback();
      await createAuditLog(models, req, {
        userId: req.authCenter.user.id,
        clientKey: req.authCenter.session.clientKey,
        eventType: "unbind_identity",
        success: false,
        reason: error.message,
      });
      return sendError(res, error, "UNBIND_IDENTITY_FAILED");
    }
  }
);

module.exports = router;
