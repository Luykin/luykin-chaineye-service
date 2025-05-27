const express = require('express');
const jwt = require('jsonwebtoken');
const { XHuntUserToken, XHuntUser, XPointRecord } = require('../../models/postgres-start');
const { generateTwitterAuthUrl, getTwitterTokens, getTwitterUserInfo } = require('../services/twitter');
const { validateRequest } = require('../middleware/validate-request');
const { body, param } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { Op } = require('sequelize');
const axios = require('axios');
const retry = require('async-retry');

const router = express.Router();

// 获取 Twitter 授权 URL
router.get('/twitter/url', async (req, res) => {
	try {
		const authUrl = await generateTwitterAuthUrl(async (state, codeVerifier) => {
			const cacheKey = `twitter_oauth_state:${state}`;
			/** state 8分钟没处理就过期 **/
			await req.redisClient.setEx(cacheKey, 480, codeVerifier);
		});
		res.json({ url: authUrl });
	} catch (error) {
		console.error('Error generating auth URL:', error);
		res.status(500).json({ error: '获取授权URL失败' });
	}
});

/**
 * Twitter OAuth 回调处理接口
 */
router.post('/twitter/callback', [
	body('code').trim().notEmpty(),
	body('state').trim().notEmpty(),
	validateRequest
], async (req, res) => {
	const { code, state } = req.body;
	
	try {
		const cacheKey = `twitter_oauth_state:${state}`;
		let cachedData;
		
		// Step 1: 验证 state 是否有效
		try {
			cachedData = await req.redisClient.get(cacheKey);
		} catch (redisError) {
			console.error('Redis GET error:', redisError);
			return res.status(500).json({ error: '服务器内部错误（Redis）' });
		}
		
		if (!cachedData) {
			return res.status(400).json({ error: '无效或过期的 state' });
		}
		
		// Step 2: 删除已使用的 state，防止重复使用
		try {
			await req.redisClient.del(cacheKey);
		} catch (redisDelError) {
			console.warn('无法删除 Redis 中的 state:', redisDelError);
		}
		
		// Step 3: 获取 Twitter Tokens
		const { accessToken, refreshToken, expiresIn } = await getTwitterTokens(code, cachedData);
		
		// Step 4: 获取 Twitter 用户信息
		const twitterUser = await getTwitterUserInfo(accessToken);
		
		// Step 5: 创建或更新用户信息
		const [user, created] = await XHuntUser.findOrCreate({
			where: { twitterId: twitterUser.id },
			defaults: {
				username: twitterUser.username,
				displayName: twitterUser.name,
				avatar: twitterUser.profile_image_url
			}
		});
		
		// Step 6: 可选：调用外部 API 获取用户分类和排名
		try {
			const response = await retry(
				async (bail) => {
					try {
						const res = await axios.get(
							`http://10.170.0.2:16530/api/c9e1c6/plugin/twitter/info?username=${twitterUser.username}`,
							{
								timeout: 5000 // 设置5秒超时
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
						req.dataDog.increment('user.retryInitRank', 1, [`err:${err.message}`, `attempt:${attempt}`]);
						// console.error(`第 ${attempt} 次重试:`, err.message);
					}
				}
			);
			
			// 请求成功后处理数据
			const { basicInfo, kolFollow } = response.data.data || {};
			const { classification } = basicInfo || {};
			const { kolRank20W } = kolFollow || {};
			
			await user.update({
				classification,
				kolRank20W: kolRank20W && Number(kolRank20W) > 0 ? parseInt(kolRank20W, 10) : null
			});
			
		} catch (finalError) {
			// 所有重试都失败了
			req.dataDog.increment('user.initRankFinalFail', 1, [`err:${finalError.message}`]);
			console.error('初始化用户排名最终请求失败:', finalError.message);
		}
		
		if (created) {
			req.dataDog.increment('user.registrations', 1, [
				`source:twitter`,
				`classification:${user.classification || 'unknown'}`
			]);
		} else {
			req.dataDog.increment('user.logins', 1, [
				`source:twitter`,
				`classification:${user.classification || 'unknown'}`
			]);
		}
		
		// Step 7: 清除旧 token
		await XHuntUserToken.destroy({ where: { userId: user.id } });
		
		// Step 8: 创建新 Token 记录
		const expiryDays = 30;//  30天过期
		const thirtyDaysFromNow = new Date();
		thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + expiryDays);
		
		const tokenRecord = await XHuntUserToken.create({
			userId: user.id,
			accessToken,
			refreshToken,
			tokenExpiry: thirtyDaysFromNow,
			lastUsed: new Date(),
			fingerprint: req?.securityContext?.fingerprint || ''
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
			}
		});
	} catch (error) {
		console.error('Twitter callback error:', error);
		res.status(500).json({ error: '登录失败，请稍后再试' });
	}
});

// 获取当前用户信息
router.get('/me', authenticateToken, async (req, res) => {
	try {
		const cacheKey = `user:points:${req.user.id}`;
		
		// 优先从 Redis 获取积分
		const cachedPoints = await req.redisClient.get(cacheKey);
		
		let totalPoints = 0;
		
		if (cachedPoints !== null) {
			totalPoints = parseInt(cachedPoints, 10);
		} else {
			// 回退到数据库查询（冷启动或缓存过期）
			totalPoints = await XPointRecord.sum('points', {
				where: { xHuntUserId: req.user.id }
			}) || 0;
			
			// 写入缓存（异步非阻塞）
			req.redisClient.setEx(cacheKey, 3600, totalPoints).catch(console.error);
		}
		res.json({
			username: req.user.username,
			displayName: req.user.displayName,
			avatar: req.user.avatar,
			twitterId: req.user.twitterId,
			xPoints: totalPoints
		});
	} catch (error) {
		console.error('Failed to fetch user info:', error);
		res.status(500).json({ error: '获取用户信息失败' });
	}
});

/**
 * POST /logout
 * 登出接口：将当前 Token 标记为已撤销
 */
router.post('/logout', authenticateToken, async (req, res) => {
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
		console.error('Logout error:', error);
		res.status(500).json({ error: '登出失败，请稍后再试' });
	}
});

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
