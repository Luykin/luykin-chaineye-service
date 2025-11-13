const express = require("express");
const jwt = require("jsonwebtoken");
const {
  XHuntUserToken,
  XHuntUser,
  XPointRecord,
  XHuntUserProSubscription,
} = require("../../models/postgres-start");
const {
  generateTwitterAuthUrl,
  getTwitterTokens,
  getTwitterUserInfo,
} = require("../services/twitter");
const { validateRequest } = require("../middleware/validate-request");
const { body, param } = require("express-validator");
const { authenticateToken } = require("../middleware/auth");
const { Op } = require("sequelize");
const axios = require("axios");
const retry = require("async-retry");

const router = express.Router();

// ---------------- Wallet Sign-in (EVM) ----------------
// Helper: extract a standard 20-byte EVM address (0x + 40 hex) if present
function extractEvm40Address(input) {
  if (!input) return null;
  const str = String(input);
  const match = str.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0].toLowerCase() : null;
}

// Helper: compute a stable cache key from input address string
function computeWalletNonceKey(input) {
  const lower = String(input || "")
    .trim()
    .toLowerCase();
  const evm40 = extractEvm40Address(lower);
  return `wallet_nonce:${evm40 || lower}`;
}

// Generate and cache a challenge message (nonce) for a given EVM address
router.get("/wallet/nonce", async (req, res) => {
  try {
    const address = (req.query.address || "").toString().trim();
    const lower = address.toLowerCase();
    if (!lower) {
      return res.status(400).json({ error: "INVALID_ADDRESS" });
    }
    const cacheKey = computeWalletNonceKey(lower);

    // generate a nonce and generic challenge message
    const nonce = Math.random().toString(36).slice(2, 10);
    const displayAddress = extractEvm40Address(lower) || lower;
    const message = `Sign to verify wallet ownership (no transaction or gas).\nAddress: ${displayAddress}.\nNonce: ${nonce}.\nRequested by XHunt.`;

    try {
      await req.redisClient.setEx(
        cacheKey,
        5 * 60, // 5 minutes TTL
        JSON.stringify({ nonce, message })
      );
    } catch (redisErr) {
      console.error("Redis SET wallet nonce error:", redisErr);
      return res.status(500).json({ error: "SERVER_REDIS_ERROR" });
    }

    return res.json({ nonce, message });
  } catch (error) {
    console.error("Wallet nonce error:", error);
    return res.status(500).json({ error: "WALLET_NONCE_FAILED" });
  }
});

// Verify signature for the cached challenge message
router.post(
  "/wallet/verify",
  [
    body("address").isString(),
    body("signature").isString(),
    body("nonce").optional().isString(),
    body("message").optional().isString(),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const { address, signature, nonce, message } = req.body || {};
      const lower = String(address || "")
        .trim()
        .toLowerCase();
      const cacheKey = computeWalletNonceKey(lower);

      let cached;
      try {
        const raw = await req.redisClient.get(cacheKey);
        cached = raw ? JSON.parse(raw) : null;
      } catch (redisErr) {
        console.error("Redis GET wallet nonce error:", redisErr);
        return res.status(500).json({ error: "SERVER_REDIS_ERROR" });
      }

      if (!cached || !cached.nonce || !cached.message) {
        return res
          .status(400)
          .json({ error: "CHALLENGE_NOT_FOUND_OR_EXPIRED" });
      }

      // Ensure the provided message/nonce align with the cached challenge
      if (message && message !== cached.message) {
        return res.status(400).json({ error: "MESSAGE_MISMATCH" });
      }
      if (nonce && nonce !== cached.nonce) {
        return res.status(400).json({ error: "NONCE_MISMATCH" });
      }

      // Verify signature using ethers (v5)
      let recovered;
      try {
        const { utils } = require("ethers");
        recovered = utils.verifyMessage(message || cached.message, signature);
      } catch (e) {
        console.error("EVM signature verify error:", e);
        return res.status(400).json({ error: "SIGNATURE_VERIFY_FAILED" });
      }

      if (recovered) {
        const expected40 = extractEvm40Address(lower);
        if (expected40 && recovered.toLowerCase() !== expected40) {
          return res.status(400).json({ error: "ADDRESS_MISMATCH" });
        }
      }

      // One-time challenge: remove it after success to prevent replay
      try {
        await req.redisClient.del(cacheKey);
      } catch (redisDelErr) {
        console.warn("Redis DEL wallet nonce warn:", redisDelErr);
      }

      // For now, we only confirm success and whether the address is bound
      // Future: bind to user and issue JWT if needed
      return res.json({ success: true, bound: false });
    } catch (error) {
      console.error("Wallet verify error:", error);
      return res.status(500).json({ error: "WALLET_VERIFY_FAILED" });
    }
  }
);
// ---------------- Wallet Sign-in (EVM) ---------------- end ----------------

// 获取 Twitter 授权 URL
router.get("/twitter/url", async (req, res) => {
  try {
    const authUrl = await generateTwitterAuthUrl(
      async (state, codeVerifier) => {
        const cacheKey = `twitter_oauth_state:${state}`;
        /** state 8分钟没处理就过期 **/
        await req.redisClient.setEx(cacheKey, 480, codeVerifier);
      }
    );
    res.json({ url: authUrl });
  } catch (error) {
    console.error("Error generating auth URL:", error);
    res.status(500).json({ error: "获取授权URL失败" });
  }
});

/**
 * Twitter OAuth 回调处理接口
 */
router.post(
  "/twitter/callback",
  [
    body("code").trim().notEmpty(),
    body("state").trim().notEmpty(),
    validateRequest,
  ],
  async (req, res) => {
    const { code, state } = req.body;

    try {
      const cacheKey = `twitter_oauth_state:${state}`;
      let cachedData;

      // Step 1: 验证 state 是否有效
      try {
        cachedData = await req.redisClient.get(cacheKey);
      } catch (redisError) {
        console.error("Redis GET error:", redisError);
        return res.status(500).json({ error: "服务器内部错误（Redis）" });
      }

      if (!cachedData) {
        return res.status(400).json({ error: "无效或过期的 state" });
      }

      // Step 2: 删除已使用的 state，防止重复使用
      try {
        await req.redisClient.del(cacheKey);
      } catch (redisDelError) {
        console.warn("无法删除 Redis 中的 state:", redisDelError);
      }

      // Step 3: 获取 Twitter Tokens
      const { accessToken, refreshToken } = await getTwitterTokens(
        code,
        cachedData
      );

      // Step 4: 获取 Twitter 用户信息
      const twitterUser = await getTwitterUserInfo(accessToken);

      // Step 5: 创建或更新用户信息
      const [user, created] = await XHuntUser.findOrCreate({
        where: { twitterId: twitterUser.id },
        defaults: {
          username: twitterUser.username,
          displayName: twitterUser.name,
          avatar: twitterUser.profile_image_url,
        },
      });

      // 如果用户已存在，更新可能变化的信息
      if (!created) {
        await user.update({
          username: twitterUser.username,
          displayName: twitterUser.name,
          avatar: twitterUser.profile_image_url,
        });
      }

      // Step 6: 可选：调用外部 API 获取用户分类和排名
      try {
        const response = await retry(
          async (bail) => {
            try {
              const res = await axios.get(
                `https://data.cryptohunt.ai/fetch/twitter/user?username=${twitterUser.username}`,
                {
                  timeout: 5000, // 设置5秒超时
                }
              );

              if (res.data?.code !== 200) {
                // 非200响应视为失败，触发重试
                throw new Error(`API 返回非200状态码: ${res.status}`);
              }

              return res;
            } catch (err) {
              // 可以选择在某些错误不重试（比如404或认证失败）
              // bail(err); // 如果你不希望重试某些错误，就调用 bail()

              // 否则继续重试
              throw err;
            }
          },
          {
            retries: 2, // 最多重试2次
            factor: 2, // 指数退避因子
            minTimeout: 500, // 第一次重试前等待1秒
            onRetry: (err, attempt) => {
              req.dataDog.increment("user.retryInitRank", 1, [
                `err:${err.message}`,
                `attempt:${attempt}`,
              ]);
              // console.error(`第 ${attempt} 次重试:`, err.message);
            },
          }
        );

        // 请求成功后处理数据
        const { ai, feature } = response?.data?.data?.data || {};
        const { classification } = ai || {};
        const { kolRank } = feature?.rank || {};

        await user.update({
          classification,
          kolRank20W:
            kolRank && Number(kolRank) > 0 ? parseInt(kolRank, 10) : null,
        });
      } catch (finalError) {
        // 所有重试都失败了
        req.dataDog.increment("user.initRankFinalFail", 1, [
          `err:${finalError.message}`,
        ]);
        console.error("初始化用户排名最终请求失败:", finalError.message);
      }

      if (created) {
        req.dataDog.increment("user.registrations", 1, [
          `source:twitter`,
          `classification:${user.classification || "unknown"}`,
        ]);
      } else {
        req.dataDog.increment("user.logins", 1, [
          `source:twitter`,
          `classification:${user.classification || "unknown"}`,
        ]);
      }

      // Step 7: 清除旧 token
      await XHuntUserToken.destroy({ where: { userId: user.id } });

      // Step 8: 创建新 Token 记录
      const expiryDays = 30; //  30天过期
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + expiryDays);

      const tokenRecord = await XHuntUserToken.create({
        userId: user.id,
        accessToken,
        refreshToken,
        tokenExpiry: thirtyDaysFromNow,
        lastUsed: new Date(),
        fingerprint: req?.securityContext?.fingerprint || "",
      });

      // Step 9: 签发 JWT Token
      const jwtToken = jwt.sign(
        { userId: user.id, tokenId: tokenRecord.id },
        process.env.JWT_SECRET,
        { expiresIn: `${expiryDays}d` }
      );

      // Step 10: 返回响应
      res.json({
        token: jwtToken,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          classification: user.classification,
          kolRank20W: user.kolRank20W,
          twitterId: user.twitterId,
          evmAddresses: user.evmAddresses || [],
        },
      });
    } catch (error) {
      console.error("Twitter callback error:", error);
      res.status(500).json({ error: "登录失败，请稍后再试" });
    }
  }
);

// 获取当前用户信息
router.get("/me", authenticateToken, async (req, res) => {
  try {
    // 缓存策略：前端缓存
    res.set("Cache-Control", "private, max-age=240"); // 4分钟

    // 查询用户当前有效的 Pro 订阅
    // 使用复合索引 idx_pro_subscription_user_end_time 优化查询
    // 查询条件：userId = ? AND endTime > NOW()，按 endTime DESC 排序取最新的一条
    const activeProSubscription = await XHuntUserProSubscription.findOne({
      where: {
        userId: req.user.id,
        endTime: {
          [Op.gt]: new Date(), // endTime > 当前时间，表示未过期
        },
      },
      order: [["endTime", "DESC"]], // 按过期时间降序，取最新的
      attributes: ["endTime", "planType"], // 只返回需要的字段
    });

    const isPro = !!activeProSubscription;
    const proExpiryTime = activeProSubscription?.endTime || null;

    res.json({
      username: req.user.username,
      displayName: req.user.displayName,
      avatar: req.user.avatar,
      twitterId: req.user.twitterId,
      evmAddresses: req.user.evmAddresses || [],
      xPoints: -1,
      isPro,
      proExpiryTime,
    });
  } catch (error) {
    console.error("Failed to fetch user info:", error);
    res.status(500).json({ error: "获取用户信息失败" });
  }
});

/**
 * POST /logout
 * 登出接口：将当前 Token 标记为已撤销
 */
router.post("/logout", authenticateToken, async (req, res) => {
  try {
    // 获取当前 Token ID
    const tokenId = req.tokenRecord.id;

    // 更新数据库，标记为已撤销
    await XHuntUserToken.update(
      { isRevoked: true },
      { where: { id: tokenId } }
    );

    // 返回成功响应
    res.status(200).json({});
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "登出失败，请稍后再试" });
  }
});

/**
 * POST /evm-addresses
 * 绑定/修改 EVM 地址接口
 * 前端传递全量的 EVM 地址数组，后端会替换现有的所有地址
 * 每周最多只能调用3次
 */
router.post(
  "/evm-addresses",
  authenticateToken,
  [
    body("addresses").isArray({ min: 0 }).withMessage("addresses 必须是数组"),
    body("addresses.*")
      .isString()
      .matches(/^0x[a-fA-F0-9]{40}$/)
      .withMessage("每个地址必须是有效的 EVM 地址（0x + 40个十六进制字符）"),
    validateRequest,
  ],
  async (req, res) => {
    try {
      // 30天修改频率限制（首次绑定不计数）
      const userId = req.user.id;
      const rateLimitKey = `evm_addresses_modify_limit:user:${userId}`;
      const maxModsPerWindow = 1;
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60; // 30天
      let currentCount = 0;
      try {
        const countStr = await req.redisClient.get(rateLimitKey);
        currentCount = countStr ? parseInt(countStr, 10) : 0;
      } catch (redisErr) {
        console.error("Redis GET evm addresses limit error:", redisErr);
        // Redis 错误不阻断请求，但记录日志
      }

      const { addresses } = req.body;

      // 标准化和去重地址
      const normalizedAddresses = [
        ...new Set(
          addresses.map((addr) => {
            const trimmed = String(addr || "").trim();
            if (!trimmed) return null;
            // 提取标准的 40 字节地址（0x + 40 hex）
            const match = trimmed.match(/^0x[a-fA-F0-9]{40}$/i);
            return match ? match[0].toLowerCase() : null;
          })
        ),
      ].filter((addr) => addr !== null); // 过滤掉无效地址

      // 判断是否首次绑定与是否实际发生变更
      const existingAddresses = Array.isArray(req.user.evmAddresses)
        ? req.user.evmAddresses.map((a) => (String(a || "").trim().toLowerCase()))
        : [];
      const isFirstBind = existingAddresses.length === 0;
      const oldSet = new Set(existingAddresses);
      const newSet = new Set(normalizedAddresses);
      const isChanged =
        oldSet.size !== newSet.size || [...newSet].some((a) => !oldSet.has(a));

      // 如果不是首次绑定且发生了变更，则进行30天限流检查（仅允许1次）
      if (!isFirstBind && isChanged && currentCount >= maxModsPerWindow) {
        return res.status(429).json({
          error: "MODIFY_TOO_FREQUENT",
          message:
            "30天内仅允许修改1次，请稍后再试 (Only one modification is allowed within 30 days)",
          limit: maxModsPerWindow,
          remaining: 0,
        });
      }

      // 跨用户唯一性校验：任一地址已被其他用户绑定则拦截
      if (normalizedAddresses.length > 0) {
        try {
          const conflicts = await XHuntUser.sequelize.query(
            `
            SELECT u.id, u."evmAddresses"
            FROM "XHuntUsers" u
            WHERE u.id != :userId
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(COALESCE(u."evmAddresses"::jsonb, '[]'::jsonb)) AS a(elem)
                WHERE a.elem IN (:addrArray)
              )
            LIMIT 1
            `,
            {
              replacements: {
                userId: userId,
                addrArray: normalizedAddresses,
              },
              type: XHuntUser.sequelize.QueryTypes.SELECT,
            }
          );

          if (Array.isArray(conflicts) && conflicts.length > 0) {
            return res.status(400).json({
              error: "WALLET_ADDRESS_ALREADY_REGISTERED",
              message:
                "该钱包地址已注册，请使用其他地址进行注册。（This wallet address has already been registered. Please use a different address.）",
            });
          }
        } catch (checkErr) {
          console.error("EVM address uniqueness check failed:", checkErr);
          return res
            .status(500)
            .json({ error: "检查地址唯一性失败，请稍后再试" });
        }
      }

      // 更新用户的 evmAddresses 字段
      await req.user.update({
        evmAddresses: normalizedAddresses,
      });

      // 若为修改且实际发生变更，则记录一次并设置30天TTL
      let newCount = currentCount;
      if (!isFirstBind && isChanged) {
        try {
          newCount = await req.redisClient.incr(rateLimitKey);
          if (newCount === 1) {
            await req.redisClient.expire(rateLimitKey, thirtyDaysInSeconds);
          }
        } catch (redisErr) {
          console.error("Redis SET evm addresses limit error:", redisErr);
          // Redis 错误不阻断请求，但记录日志
        }
      }

      // 在响应头中添加使用情况信息
      res.setHeader("X-RateLimit-Limit", maxModsPerWindow);
      res.setHeader(
        "X-RateLimit-Remaining",
        isFirstBind || !isChanged
          ? Math.max(0, maxModsPerWindow - currentCount)
          : Math.max(0, maxModsPerWindow - newCount)
      );

      // 返回成功响应
      res.json({
        success: true,
        addresses: normalizedAddresses,
        count: normalizedAddresses.length,
        rateLimit: {
          limit: maxModsPerWindow,
          remaining:
            isFirstBind || !isChanged
              ? Math.max(0, maxModsPerWindow - currentCount)
              : Math.max(0, maxModsPerWindow - newCount),
        },
      });
    } catch (error) {
      console.error("Update EVM addresses error:", error);
      res.status(500).json({ error: "更新 EVM 地址失败，请稍后再试" });
    }
  }
);

// // 刷新令牌
// router.post('/refresh', async (req, res) => {
// 	try {
// 		const authHeader = req.headers['authorization'];
// 		const token = authHeader && authHeader.split(' ')[1];
//
// 		if (!token) {
// 			return res.status(401).json({ error: 'TOKEN_REQUIRED' });
// 		}
//
// 		const decoded = jwt.verify(token, process.env.JWT_SECRET);
//
// 		const tokenRecord = await XHuntUserToken.findOne({
// 			where: {
// 				id: decoded.tokenId,
// 				isRevoked: false
// 			},
// 			include: ['user']
// 		});
//
// 		if (!tokenRecord) {
// 			return res.status(401).json({ error: 'TOKEN_INVALID' });
// 		}
//
// 		const now = new Date();
// 		if (tokenRecord.tokenExpiry <= new Date(now.getTime() + 24 * 60 * 60 * 1000)) {
// 			const { accessToken, refreshToken, expiresIn } = await getTwitterTokens(tokenRecord.refreshToken);
//
// 			await tokenRecord.update({
// 				accessToken,
// 				refreshToken,
// 				tokenExpiry: new Date(now.getTime() + expiresIn * 1000),
// 				lastUsed: now
// 			});
// 		}
//
// 		const newJwtToken = jwt.sign(
// 			{
// 				userId: tokenRecord.user.id,
// 				tokenId: tokenRecord.id
// 			},
// 			process.env.JWT_SECRET,
// 			{ expiresIn: '30d' }
// 		);
//
// 		res.json({ token: newJwtToken });
// 	} catch (error) {
// 		console.error('Refresh token error:', error);
// 		res.status(500).json({ error: '令牌刷新失败' });
// 	}
// });
//
// // 撤销单个令牌
// router.delete('/tokens/:tokenId', [
// 	authenticateToken,
// 	param('tokenId').isUUID(),
// 	validateRequest
// ], async (req, res) => {
// 	try {
// 		const { tokenId } = req.params;
//
// 		const token = await XHuntUserToken.findOne({
// 			where: { id: tokenId },
// 			include: ['user']
// 		});
//
// 		if (!token) {
// 			return res.status(404).json({ error: 'TOKEN_NOT_FOUND' });
// 		}
//
// 		if (token.userId !== req.user.id && !req.user.isAdmin) {
// 			return res.status(403).json({ error: 'PERMISSION_DENIED' });
// 		}
//
// 		await token.update({ isRevoked: true });
//
// 		res.json({ message: '令牌已撤销' });
// 	} catch (error) {
// 		console.error('Revoke token error:', error);
// 		res.status(500).json({ error: '撤销令牌失败' });
// 	}
// });
//
// // 批量撤销令牌
// router.post('/tokens/revoke-batch', [
// 	authenticateToken,
// 	body('tokenIds').isArray().optional(),
// 	body('tokenIds.*').isUUID(),
// 	body('username').isString().optional(),
// 	body('userId').isUUID().optional(),
// 	validateRequest
// ], async (req, res) => {
// 	try {
// 		const { tokenIds, username, userId } = req.body;
//
// 		if (!tokenIds && !username && !userId) {
// 			return res.status(400).json({ error: '必须提供tokenIds、username或userId中的至少一个参数' });
// 		}
//
// 		let where = { isRevoked: false };
//
// 		if (tokenIds) {
// 			where.id = { [Op.in]: tokenIds };
// 		}
//
// 		if (username || userId) {
// 			const userWhere = {};
// 			if (username) userWhere.username = username;
// 			if (userId) userWhere.id = userId;
//
// 			const users = await XHuntUser.findAll({ where: userWhere });
// 			const userIds = users.map(user => user.id);
//
// 			if (userIds.length === 0) {
// 				return res.status(404).json({ error: 'USER_NOT_FOUND' });
// 			}
//
// 			where.userId = { [Op.in]: userIds };
// 		}
//
// 		if (!req.user.isAdmin) {
// 			where.userId = req.user.id;
// 		}
//
// 		const [updatedCount] = await XHuntUserToken.update(
// 			{ isRevoked: true },
// 			{ where }
// 		);
//
// 		res.json({
// 			message: '令牌已批量撤销',
// 			revokedCount: updatedCount
// 		});
// 	} catch (error) {
// 		console.error('Batch revoke tokens error:', error);
// 		res.status(500).json({ error: '批量撤销令牌失败' });
// 	}
// });
//
// router.post('/tokens/revoke-all', async (req, res) => {
// 	try {
// 		const [rowsUpdated] = await XHuntUserToken.update(
// 			{ isRevoked: true },
// 			{ where: { isRevoked: false } } // 仅更新未撤销的 XHuntUserToken
// 		);
//
// 		res.json({
// 			message: '所有 Token 已被撤销',
// 			revokedCount: rowsUpdated
// 		});
// 	} catch (error) {
// 		console.error('Revoke all tokens error:', error);
// 		res.status(500).json({ error: '一键撤销 Token 失败' });
// 	}
// });

module.exports = router;
