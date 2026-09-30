const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const crypto = require("crypto");

const X_API_BASE_URL = "https://api.x.com/2";
const X_FOLLOW_TARGET_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

function getEchohuntTwitterConfig() {
  const clientId = process.env.ECHOHUNT_X_CLIENT_ID || process.env.ECHOHUNT_TWITTER_CLIENT_ID;
  const clientSecret = process.env.ECHOHUNT_X_CLIENT_SECRET || process.env.ECHOHUNT_TWITTER_CLIENT_SECRET;
  const callbackUrl = process.env.ECHOHUNT_X_CALLBACK_URL || process.env.ECHOHUNT_TWITTER_CALLBACK_URL || "https://app.echohunt.ai";

  if (!clientId || !clientSecret) {
    const err = new Error("ECHOHUNT_X_OAUTH_NOT_CONFIGURED");
    err.status = 500;
    err.publicMessage = "EchoHunt X OAuth is not configured";
    throw err;
  }

  return { clientId, clientSecret, callbackUrl };
}

function createEchohuntTwitterClient() {
  const { clientId, clientSecret } = getEchohuntTwitterConfig();
  return new TwitterApi({ clientId, clientSecret });
}

function randomState() {
  return crypto.randomBytes(24).toString("base64url");
}

async function generateEchohuntTwitterAuthUrl(stateStoreFn) {
  const { callbackUrl } = getEchohuntTwitterConfig();
  const state = randomState();
  const client = createEchohuntTwitterClient();
  const { url, codeVerifier } = await client.generateOAuth2AuthLink(callbackUrl, {
    scope: ["tweet.read", "users.read", "offline.access"],
    state,
  });

  if (typeof stateStoreFn === "function") {
    await stateStoreFn(state, codeVerifier);
  }

  return { url, state };
}

async function getEchohuntTwitterTokens(code, codeVerifier) {
  const { callbackUrl } = getEchohuntTwitterConfig();
  const client = createEchohuntTwitterClient();
  const { accessToken, refreshToken, expiresIn } = await client.loginWithOAuth2({
    code,
    codeVerifier,
    redirectUri: callbackUrl,
  });
  return { accessToken, refreshToken, expiresIn };
}

async function getEchohuntTwitterUserInfo(accessToken) {
  const userClient = new TwitterApi(accessToken);
  const { data: user } = await userClient.v2.me({
    "user.fields": ["id", "name", "username", "profile_image_url", "created_at"],
  });
  return user;
}

function twitterVerificationError(code, status, publicMessage) {
  const error = new Error(code);
  error.status = status;
  error.publicMessage = publicMessage;
  return error;
}

function normalizeTwitterId(value) {
  const normalized = String(value || "").trim();
  return /^\d{1,30}$/.test(normalized) ? normalized : null;
}

function normalizeTwitterHandle(value) {
  const normalized = String(value || "").trim().replace(/^@+/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(normalized) ? normalized : null;
}

function getTwitterHandleFromProfileUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) return null;
    return normalizeTwitterHandle(segments[0]);
  } catch (_) {
    return null;
  }
}

function getTwitterFollowTaskTarget(task) {
  if (task?.type !== "twitter") return null;

  const twitterId = normalizeTwitterId(task?.targetTwitterId);
  const handle = normalizeTwitterHandle(task?.targetHandle) || getTwitterHandleFromProfileUrl(task?.url);
  if (!twitterId && !handle) {
    throw twitterVerificationError(
      "X_FOLLOW_TASK_CONFIG_INVALID",
      502,
      "X follow task is missing a valid project account"
    );
  }
  return { twitterId, handle };
}

function getXApiStatus(error) {
  const candidates = [
    error?.response?.status,
    error?.response?.statusCode,
    error?.status,
    error?.statusCode,
    error?.code,
  ];
  return candidates.map(Number).find(Number.isInteger) || null;
}

function getXApiError(error) {
  const status = getXApiStatus(error);
  if (status === 401 || status === 403) {
    return twitterVerificationError(
      "X_REAUTH_REQUIRED",
      401,
      "Please reconnect X to grant follow verification permission"
    );
  }
  if (status === 429) {
    return twitterVerificationError(
      "X_FOLLOW_VERIFICATION_RATE_LIMITED",
      429,
      "X verification is temporarily rate limited, please try again later"
    );
  }
  return twitterVerificationError(
    "X_FOLLOW_VERIFICATION_UNAVAILABLE",
    502,
    "X follow verification is temporarily unavailable"
  );
}

async function refreshEchohuntTwitterIdentity(identity) {
  const refreshToken = identity?.refreshTokenEncrypted;
  if (!refreshToken) {
    throw twitterVerificationError("X_REAUTH_REQUIRED", 401, "Please reconnect X to verify follow tasks");
  }

  try {
    const client = createEchohuntTwitterClient();
    const refreshed = await client.refreshOAuth2Token(refreshToken);
    const tokenExpiry = refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000) : null;
    if (typeof identity.update === "function") {
      await identity.update({
        accessTokenEncrypted: refreshed.accessToken,
        refreshTokenEncrypted: refreshed.refreshToken || refreshToken,
        tokenExpiry,
      });
    } else {
      identity.accessTokenEncrypted = refreshed.accessToken;
      identity.refreshTokenEncrypted = refreshed.refreshToken || refreshToken;
      identity.tokenExpiry = tokenExpiry;
    }
    return refreshed.accessToken;
  } catch (error) {
    throw getXApiError(error);
  }
}

function isTwitterTokenExpired(identity) {
  const expiry = identity?.tokenExpiry ? new Date(identity.tokenExpiry).getTime() : NaN;
  return Number.isFinite(expiry) && expiry <= Date.now() + 30 * 1000;
}

async function getEchohuntTwitterAccessToken(identity) {
  if (!identity?.accessTokenEncrypted || isTwitterTokenExpired(identity)) {
    return refreshEchohuntTwitterIdentity(identity);
  }
  return identity.accessTokenEncrypted;
}

async function requestXApiWithIdentity(identity, request) {
  let accessToken = await getEchohuntTwitterAccessToken(identity);
  try {
    return await request(accessToken);
  } catch (error) {
    if (getXApiStatus(error) !== 401 || !identity?.refreshTokenEncrypted) throw getXApiError(error);
    accessToken = await refreshEchohuntTwitterIdentity(identity);
    try {
      return await request(accessToken);
    } catch (retryError) {
      throw getXApiError(retryError);
    }
  }
}

async function resolveTwitterFollowTargetId(target, identity, redisClient) {
  if (target.twitterId) return target.twitterId;
  const handle = target.handle;
  const cacheKey = `echohunt:x-follow:target:${handle.toLowerCase()}`;
  const cached = redisClient ? await redisClient.get(cacheKey).catch(() => null) : null;
  const cachedId = normalizeTwitterId(cached);
  if (cachedId) return cachedId;

  const response = await requestXApiWithIdentity(identity, (accessToken) =>
    axios.get(`${X_API_BASE_URL}/users/by/username/${encodeURIComponent(handle)}`, {
      timeout: 8000,
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  );
  const twitterId = normalizeTwitterId(response?.data?.data?.id);
  if (!twitterId) {
    throw twitterVerificationError("X_FOLLOW_TARGET_NOT_FOUND", 502, "Configured X project account was not found");
  }
  if (redisClient) await redisClient.setEx(cacheKey, X_FOLLOW_TARGET_CACHE_TTL_SECONDS, twitterId).catch(() => {});
  return twitterId;
}

async function verifyEchohuntTwitterFollowTask({ task, identity, twitterUserId, redisClient }) {
  const target = getTwitterFollowTaskTarget(task);
  if (!target) return null;
  const sourceTwitterId = normalizeTwitterId(twitterUserId || identity?.providerSubject);
  if (!sourceTwitterId) {
    throw twitterVerificationError("X_REAUTH_REQUIRED", 401, "Please reconnect X to verify follow tasks");
  }

  const targetTwitterId = await resolveTwitterFollowTargetId(target, identity, redisClient);
  const response = await requestXApiWithIdentity(identity, (accessToken) =>
    axios.get(`${X_API_BASE_URL}/users/${encodeURIComponent(targetTwitterId)}`, {
      timeout: 8000,
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { "user.fields": "connection_status" },
    })
  );
  const connectionStatus = response?.data?.data?.connection_status;
  const following = Array.isArray(connectionStatus) && connectionStatus.includes("following");
  if (!following) {
    throw twitterVerificationError("X_FOLLOW_REQUIRED", 400, "Please follow the project X account before registering");
  }
  return {
    taskId: task?.id || null,
    targetTwitterId,
    targetHandle: target.handle || null,
    verifiedAt: new Date().toISOString(),
  };
}

module.exports = {
  getEchohuntTwitterConfig,
  generateEchohuntTwitterAuthUrl,
  getEchohuntTwitterTokens,
  getEchohuntTwitterUserInfo,
  getTwitterFollowTaskTarget,
  verifyEchohuntTwitterFollowTask,
};
