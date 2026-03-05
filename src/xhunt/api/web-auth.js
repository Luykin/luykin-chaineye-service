const express = require("express");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const retry = require("async-retry");
const { body, query } = require("express-validator");
const {
  XHuntWebUser,
  XHuntWebUserToken,
  XHuntUser,
} = require("../../models/postgres-start");
const {
  generateTwitterAuthUrl,
  getTwitterTokens,
  getTwitterUserInfo,
} = require("../services/twitter-web");
const { validateRequest } = require("../middleware/validate-request");
const { authenticateWebToken } = require("../middleware/web-auth");
const { isValidSiteSource, getSiteDisplayName } = require("../constants/web-sites");

const router = express.Router();

// JWT 有效期（天）
const JWT_EXPIRY_DAYS = 30;

/**
 * POST /api/xhunt/web/auth/twitter/url
 * 获取 Twitter 授权 URL
 */
router.post(
  "/twitter/url",
  [body("siteSource").isString().trim().notEmpty(), validateRequest],
  async (req, res) => {
    try {
      const { siteSource } = req.body;

      // 验证站点来源是否有效
      if (!isValidSiteSource(siteSource)) {
        return res.status(400).json({
          error: "INVALID_SITE_SOURCE",
          message: "无效的站点来源",
          allowedSites: process.env.XHUNT_WEB_ALLOWED_SITES?.split(",") || [
            "airdrop",
            "activity",
            "data",
            "referral",
          ],
        });
      }

      // 生成授权 URL，将 siteSource 存入 state 并添加到 URL 参数
      const authUrl = await generateTwitterAuthUrl(
        async (state, codeVerifier) => {
          const cacheKey = `twitter_web_oauth_state:${state}`;
          const value = JSON.stringify({
            codeVerifier,
            siteSource,
            createdAt: Date.now(),
          });
          // 8 分钟过期
          await req.redisClient.setEx(cacheKey, 480, value);
        },
        { siteSource: encodeURIComponent(siteSource) }
      );

      res.json({
        url: authUrl,
        siteSource,
      });
    } catch (error) {
      console.error("Error generating web auth URL:", error);
      res.status(500).json({ error: "获取授权URL失败" });
    }
  }
);

/**
 * POST /api/xhunt/web/auth/twitter/callback
 * Twitter OAuth 回调处理，完成登录
 */
router.post(
  "/twitter/callback",
  [
    body("code").isString().trim().notEmpty(),
    body("state").isString().trim().notEmpty(),
    validateRequest,
  ],
  async (req, res) => {
    const { code, state } = req.body;

    try {
      // Step 1: 验证 state 并获取存储的数据
      const cacheKey = `twitter_web_oauth_state:${state}`;
      let cachedData;

      try {
        const rawData = await req.redisClient.get(cacheKey);
        if (!rawData) {
          return res.status(400).json({ error: "无效或过期的 state" });
        }
        cachedData = JSON.parse(rawData);
      } catch (redisError) {
        console.error("Redis GET error:", redisError);
        return res.status(500).json({ error: "服务器内部错误（Redis）" });
      }

      // Step 2: 删除已使用的 state
      try {
        await req.redisClient.del(cacheKey);
      } catch (redisDelError) {
        console.warn("无法删除 Redis 中的 state:", redisDelError);
      }

      const siteSource = cachedData.siteSource;

      // Step 4: 获取 Twitter Tokens
      const { accessToken, refreshToken, expiresIn } = await getTwitterTokens(
        code,
        cachedData.codeVerifier
      );

      // Step 5: 获取 Twitter 用户信息
      const twitterUser = await getTwitterUserInfo(accessToken);

      // Step 6: 查询或创建 XHuntWebUser 记录（按 twitterId + siteSource）
      let webUser = await XHuntWebUser.findOne({
        where: {
          twitterId: twitterUser.id,
          siteSource,
        },
      });

      let isNewUser = false;

      if (!webUser) {
        // 创建新用户
        webUser = await XHuntWebUser.create({
          twitterId: twitterUser.id,
          siteSource,
          username: twitterUser.username,
          displayName: twitterUser.name,
          avatar: twitterUser.profile_image_url,
          loginCount: 1,
          lastLoginAt: new Date(),
        });
        isNewUser = true;
        console.log(
          `[WebAuth] 新用户注册: @${twitterUser.username} 来自 ${getSiteDisplayName(
            siteSource
          )}`
        );
      } else {
        // 更新用户信息
        await webUser.update({
          username: twitterUser.username,
          displayName: twitterUser.name,
          avatar: twitterUser.profile_image_url,
          loginCount: webUser.loginCount + 1,
          lastLoginAt: new Date(),
        });
      }

      // Step 7: 尝试关联 XHuntUser（插件用户）
      let xhuntUser = null;
      if (!webUser.xhuntUserId) {
        xhuntUser = await XHuntUser.findOne({
          where: { twitterId: twitterUser.id },
        });

        if (xhuntUser) {
          await webUser.update({
            xhuntUserId: xhuntUser.id,
            xhuntKolRank: xhuntUser.kolRank20W,
            classification: xhuntUser.classification,
          });
          console.log(
            `[WebAuth] 用户 @${twitterUser.username} 关联到 XHunt 插件账号`
          );
        }
      } else {
        // 已有 xhuntUserId，获取最新信息
        xhuntUser = await XHuntUser.findByPk(webUser.xhuntUserId);
      }

      // Step 8: 调用外部 API 获取用户排名和分类（如果还没有）
      if (!webUser.classification || !webUser.xhuntKolRank) {
        try {
          const response = await retry(
            async (bail) => {
              try {
                const res = await axios.get(
                  `https://data.cryptohunt.ai/fetch/twitter/user?username=${twitterUser.username}`,
                  { timeout: 5000 }
                );

                if (res.data?.code !== 200) {
                  throw new Error(`API 返回非200状态码: ${res.status}`);
                }
                return res;
              } catch (err) {
                throw err;
              }
            },
            {
              retries: 2,
              factor: 2,
              minTimeout: 500,
            }
          );

          const { ai, feature } = response?.data?.data?.data || {};
          const { classification } = ai || {};
          const { kolRank } = feature?.rank || {};

          await webUser.update({
            classification: classification || webUser.classification,
            xhuntKolRank:
              kolRank && Number(kolRank) > 0
                ? parseInt(kolRank, 10)
                : webUser.xhuntKolRank,
          });
        } catch (apiError) {
          console.error(
            `[WebAuth] 获取用户排名失败: @${twitterUser.username}`,
            apiError.message
          );
        }
      }

      // Step 9: 清除该用户在此站点的旧 token
      await XHuntWebUserToken.destroy({
        where: {
          userId: webUser.id,
          siteSource,
        },
      });

      // Step 10: 创建新 Token 记录
      const expiryDays = JWT_EXPIRY_DAYS;
      const tokenExpiry = new Date();
      tokenExpiry.setDate(tokenExpiry.getDate() + expiryDays);

      const tokenRecord = await XHuntWebUserToken.create({
        userId: webUser.id,
        siteSource,
        accessToken,
        tokenExpiry,
        lastUsed: new Date(),
        fingerprint: req?.securityContext?.fingerprint || "",
      });

      // Step 11: 更新用户的 Twitter Token
      await webUser.update({
        twitterAccessToken: accessToken,
        twitterRefreshToken: refreshToken,
        tokenExpiry: new Date(Date.now() + expiresIn * 1000),
      });

      // Step 12: 签发 JWT Token（包含 siteSource）
      const jwtToken = jwt.sign(
        {
          userId: webUser.id,
          tokenId: tokenRecord.id,
          siteSource,
        },
        process.env.JWT_SECRET,
        { expiresIn: `${expiryDays}d` }
      );

      // Step 13: 返回响应
      res.json({
        token: jwtToken,
        user: {
          id: webUser.id,
          twitterId: webUser.twitterId,
          siteSource: webUser.siteSource,
          username: webUser.username,
          displayName: webUser.displayName,
          avatar: webUser.avatar,
          xhuntUserId: webUser.xhuntUserId,
          xhuntKolRank: webUser.xhuntKolRank,
          classification: webUser.classification,
          isLinkedToXHunt: !!webUser.xhuntUserId,
          loginCount: webUser.loginCount,
          isNewUser,
        },
      });
    } catch (error) {
      console.error("[WebAuth] Twitter callback error:", error);
      res.status(500).json({ error: "登录失败，请稍后再试" });
    }
  }
);

/**
 * GET /api/xhunt/web/auth/me
 * 获取当前登录用户信息
 */
router.get(
  "/me",
  [query("siteSource").isString().trim().notEmpty(), validateRequest],
  authenticateWebToken({ requireSiteMatch: true }),
  async (req, res) => {
    try {
      const webUser = req.user;

      // 缓存策略：前端缓存 4 分钟
      res.set("Cache-Control", "private, max-age=240");

      res.json({
        id: webUser.id,
        twitterId: webUser.twitterId,
        siteSource: webUser.siteSource,
        username: webUser.username,
        displayName: webUser.displayName,
        avatar: webUser.avatar,
        xhuntUserId: webUser.xhuntUserId,
        xhuntKolRank: webUser.xhuntKolRank,
        classification: webUser.classification,
        isLinkedToXHunt: !!webUser.xhuntUserId,
        lastLoginAt: webUser.lastLoginAt,
        loginCount: webUser.loginCount,
        createdAt: webUser.createdAt,
      });
    } catch (error) {
      console.error("[WebAuth] Failed to fetch user info:", error);
      res.status(500).json({ error: "获取用户信息失败" });
    }
  }
);

/**
 * POST /api/xhunt/web/auth/logout
 * 登出接口
 */
router.post(
  "/logout",
  [body("siteSource").isString().trim().notEmpty(), validateRequest],
  authenticateWebToken({ requireSiteMatch: true }),
  async (req, res) => {
    try {
      const tokenId = req.tokenRecord.id;

      // 将当前 Token 标记为已撤销
      await XHuntWebUserToken.update(
        { isRevoked: true },
        { where: { id: tokenId } }
      );

      res.json({ success: true });
    } catch (error) {
      console.error("[WebAuth] Logout error:", error);
      res.status(500).json({ error: "登出失败，请稍后再试" });
    }
  }
);

module.exports = router;
