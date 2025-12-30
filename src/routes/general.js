const express = require("express");
const { body } = require("express-validator");
const { validateRequest } = require("../xhunt/middleware/validate-request");
const { TwitterApi } = require("twitter-api-v2");

const router = express.Router();

// 通用：获取 Twitter 授权 URL（不经过 securityMiddleware）
router.get("/twitter/url", async (req, res) => {
  // 要求：必须携带 x-request-id（该文件其他不做检查）
  if (!req.get("x-request-id")) {
    return res.status(400).json({ error: "缺少 x-request-id" });
  }
  try {
    const clientId = process.env.WEB_TWITTER_CLIENT_ID;
    const clientSecret = process.env.WEB_TWITTER_CLIENT_SECRET;
    const callbackUrl = process.env.WEB_TWITTER_CALLBACK_URL;

    if (!clientId || !clientSecret || !callbackUrl) {
      return res.status(500).json({ error: "缺少 WEB_TWITTER_* 环境变量" });
    }

    const client = new TwitterApi({ clientId, clientSecret });
    const { url, state, codeVerifier } = await client.generateOAuth2AuthLink(
      callbackUrl,
      { scope: ["tweet.read", "users.read", "offline.access"] }
    );

    const cacheKey = `general_twitter_oauth_state:${state}`;
    // 8 分钟过期
    await req.redisClient.setEx(cacheKey, 480, codeVerifier);

    const authUrl = url;
    res.json({ url: authUrl });
  } catch (error) {
    console.error("[general] Error generating auth URL:", error);
    res.status(500).json({ error: "获取授权URL失败" });
  }
});

// 通用：Twitter OAuth 回调，直接返回 tokens 与 twitterUser（不做用户落库与 JWT 签发）
router.post(
  "/twitter/callback",
  [body("code").trim().notEmpty(), body("state").trim().notEmpty(), validateRequest],
  async (req, res) => {
    // 要求：必须携带 x-request-id（该文件其他不做检查）
    if (!req.get("x-request-id")) {
      return res.status(400).json({ error: "缺少 x-request-id" });
    }
    const { code, state } = req.body || {};
    try {
      const clientId = process.env.WEB_TWITTER_CLIENT_ID;
      const clientSecret = process.env.WEB_TWITTER_CLIENT_SECRET;
      const callbackUrl = process.env.WEB_TWITTER_CALLBACK_URL;

      if (!clientId || !clientSecret || !callbackUrl) {
        return res.status(500).json({ error: "缺少 WEB_TWITTER_* 环境变量" });
      }

      const cacheKey = `general_twitter_oauth_state:${state}`;
      let cachedData;

      // 校验并获取 codeVerifier
      try {
        cachedData = await req.redisClient.get(cacheKey);
      } catch (redisError) {
        console.error("[general] Redis GET error:", redisError);
        return res.status(500).json({ error: "服务器内部错误（Redis）" });
      }

      if (!cachedData) {
        return res.status(400).json({ error: "无效或过期的 state" });
      }

      // 删除已使用的 state
      try {
        await req.redisClient.del(cacheKey);
      } catch (redisDelError) {
        console.warn("[general] 无法删除 Redis 中的 state:", redisDelError);
      }

      // 交换 token（使用 WEB_TWITTER_* 配置）
      const client = new TwitterApi({ clientId, clientSecret });
      const { accessToken, refreshToken, expiresIn } =
        await client.loginWithOAuth2({
          code,
          codeVerifier: cachedData,
          redirectUri: callbackUrl,
        });

      // 获取 twitter 用户信息（使用 accessToken 直接请求）
      const userClient = new TwitterApi(accessToken);
      const { data: twitterUser } = await userClient.v2.me({
        "user.fields": [
          "id",
          "name",
          "username",
          "profile_image_url",
          "created_at",
        ],
      });

      return res.json({ accessToken, refreshToken, expiresIn, twitterUser });
    } catch (error) {
      console.error("[general] Twitter callback error:", error);
      return res.status(500).json({ error: "处理失败，请稍后再试" });
    }
  }
);

module.exports = router;
