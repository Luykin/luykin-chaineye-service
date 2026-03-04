const { TwitterApi } = require("twitter-api-v2");

// Web 用户专用的 Twitter OAuth 配置
const WEB_CLIENT_ID = process.env.XHUNT_WEB_TWITTER_CLIENT_ID;
const WEB_CLIENT_SECRET = process.env.XHUNT_WEB_TWITTER_CLIENT_SECRET;
const WEB_CALLBACK_URL = process.env.XHUNT_WEB_TWITTER_CALLBACK_URL;

// 如果环境变量未设置，使用主应用的配置作为回退（便于开发环境）
const CLIENT_ID = WEB_CLIENT_ID || process.env.TWITTER_CLIENT_ID;
const CLIENT_SECRET = WEB_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET;
const CALLBACK_URL = WEB_CALLBACK_URL || process.env.TWITTER_CALLBACK_URL;

if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error(
    "Missing Twitter credentials for Web OAuth. Please set XHUNT_WEB_TWITTER_CLIENT_ID and XHUNT_WEB_TWITTER_CLIENT_SECRET"
  );
}

const client = new TwitterApi({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
});

/**
 * 生成 Twitter 授权 URL
 * @param {Function} stateStoreFn - 存储 state 和 codeVerifier 的回调函数
 * @returns {Promise<string>} 授权 URL
 */
async function generateTwitterAuthUrl(stateStoreFn) {
  const { url, state, codeVerifier } = await client.generateOAuth2AuthLink(
    CALLBACK_URL,
    {
      scope: ["tweet.read", "users.read", "offline.access"],
    }
  );

  // 将 state 存入 session（通过回调函数）
  if (typeof stateStoreFn === "function") {
    await stateStoreFn(state, codeVerifier);
  }

  return url;
}

/**
 * 获取 Twitter Tokens
 * @param {string} code - 授权码
 * @param {string} codeVerifier - PKCE code verifier
 * @returns {Promise<{accessToken: string, refreshToken: string, expiresIn: number}>}
 */
async function getTwitterTokens(code, codeVerifier) {
  const { accessToken, refreshToken, expiresIn } = await client.loginWithOAuth2({
    code,
    codeVerifier,
    redirectUri: CALLBACK_URL,
  });
  return { accessToken, refreshToken, expiresIn };
}

/**
 * 获取 Twitter 用户信息
 * @param {string} accessToken - Access Token
 * @returns {Promise<Object>} 用户信息
 */
async function getTwitterUserInfo(accessToken) {
  const userClient = new TwitterApi(accessToken);
  const { data: user } = await userClient.v2.me({
    "user.fields": [
      "id",
      "name",
      "username",
      "profile_image_url",
      "created_at",
    ],
  });
  return user;
}

/**
 * 刷新 Twitter Access Token
 * @param {string} refreshToken - Refresh Token
 * @returns {Promise<{accessToken: string, refreshToken: string, expiresIn: number}>}
 */
async function refreshTwitterToken(refreshToken) {
  const {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn,
  } = await client.refreshOAuth2Token(refreshToken);
  return { accessToken, refreshToken: newRefreshToken, expiresIn };
}

module.exports = {
  generateTwitterAuthUrl,
  getTwitterTokens,
  getTwitterUserInfo,
  refreshTwitterToken,
};
