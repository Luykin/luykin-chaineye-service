const { TwitterApi } = require("twitter-api-v2");
const crypto = require("crypto");

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
 * 生成包含 siteSource 的复合 state
 * 格式: base64({random}:{siteSource})
 * @param {string} siteSource - 站点来源
 * @returns {string} 复合 state
 */
function encodeCompositeState(siteSource) {
  const randomPart = crypto.randomBytes(16).toString("hex");
  const data = JSON.stringify({
    r: randomPart, // random
    s: siteSource, // siteSource
  });
  return Buffer.from(data).toString("base64url");
}

/**
 * 解析复合 state，提取 siteSource
 * @param {string} compositeState - 复合 state
 * @returns {Object|null} {random, siteSource} 或 null（解析失败）
 */
function decodeCompositeState(compositeState) {
  try {
    const data = Buffer.from(compositeState, "base64url").toString("utf8");
    const parsed = JSON.parse(data);
    return {
      random: parsed.r,
      siteSource: parsed.s,
    };
  } catch (err) {
    return null;
  }
}

/**
 * 生成 Twitter 授权 URL
 * @param {Function} stateStoreFn - 存储 state 和 codeVerifier 的回调函数
 * @param {string} siteSource - 站点来源（会编码到 state 中）
 * @returns {Promise<string>} 授权 URL
 */
async function generateTwitterAuthUrl(stateStoreFn, siteSource) {
  // 生成复合 state，包含 siteSource
  const compositeState = encodeCompositeState(siteSource);
  
  // 使用复合 state 生成授权链接
  const { url, codeVerifier } = await client.generateOAuth2AuthLink(
    CALLBACK_URL,
    {
      scope: ["tweet.read", "users.read", "offline.access"],
      state: compositeState,
    }
  );

  // 将 state 和 codeVerifier 存入 session（通过回调函数）
  if (typeof stateStoreFn === "function") {
    await stateStoreFn(compositeState, codeVerifier);
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
  decodeCompositeState,
};
