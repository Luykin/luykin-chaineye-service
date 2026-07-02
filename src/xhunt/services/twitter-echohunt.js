const { TwitterApi } = require("twitter-api-v2");
const crypto = require("crypto");

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

module.exports = {
  getEchohuntTwitterConfig,
  generateEchohuntTwitterAuthUrl,
  getEchohuntTwitterTokens,
  getEchohuntTwitterUserInfo,
};
