const express = require('express');
const { query } = require('express-validator');
const { XReviewForAccount, XHuntUser, XAccount, DailyActiveUser } = require('../models/postgres-start');
const { Op, fn, col } = require('sequelize');

const router = express.Router();

/**
 * GET /reviews
 * 内部查询接口：查询某个推特账号的评价信息
 * @query xAccountId - X账号ID (必填)
 * @query userName - 用户名 (可选，支持模糊查询)
 * @query minRating - 最低评分 (可选，仅在不传userName时生效，支持小数)
 * 
 * 逻辑：
 * 1. 不传userName：返回所有评论用户的基本信息列表，可通过minRating筛选
 * 2. 传userName：返回匹配用户的具体评论内容
 */
router.get('/reviews', [
	query('xAccountId')
		.notEmpty()
		.withMessage('xAccountId参数是必填的')
		.isUUID()
		.withMessage('xAccountId必须是有效的UUID格式'),
	query('userName')
		.optional()
		.isString()
		.trim()
		.withMessage('userName必须是字符串'),
	query('minRating')
		.optional()
		.isFloat({ min: 0, max: 5 })
		.withMessage('minRating必须是0-5之间的数字')
		.custom((value) => {
			// 检查小数位数不超过1位
			if (value && value.toString().includes('.')) {
				const decimalPart = value.toString().split('.')[1];
				if (decimalPart && decimalPart.length > 1) {
					throw new Error('minRating最多保留一位小数');
				}
			}
			return true;
		})
], async (req, res) => {
	try {
		// 验证参数
		const errors = [];
		if (!req.query.xAccountId) {
			errors.push({ field: 'xAccountId', message: 'xAccountId参数是必填的' });
		}
		
		if (errors.length > 0) {
			return res.status(400).json({
				error: '参数验证失败',
				details: errors
			});
		}

		const { xAccountId, userName, minRating } = req.query;
		
		// 解析并验证 minRating
		let parsedMinRating = null;
		if (minRating !== undefined && minRating !== '') {
			parsedMinRating = parseFloat(minRating);
			if (isNaN(parsedMinRating) || parsedMinRating < 0 || parsedMinRating > 5) {
				return res.status(400).json({
					error: '参数验证失败',
					details: [{ field: 'minRating', message: 'minRating必须是0-5之间的有效数字' }]
				});
			}
		}
		
		if (!userName || !userName.trim()) {
			// 情况1：不传userName，返回评论用户列表（去重），可选择按评分筛选
			
			// 构建查询条件
			const whereClause = { xAccountId };
			if (parsedMinRating !== null) {
				whereClause.rating = { [Op.gte]: parsedMinRating };
			}
			
			const reviewers = await XReviewForAccount.findAll({
				where: whereClause,
				include: [{
					model: XHuntUser,
					as: 'xHuntUser',
					attributes: ['username', 'displayName']
				}],
				attributes: ['userName', 'xHuntUserId'], // 添加xHuntUserId用于去重
				order: [['createdAt', 'DESC']],
				raw: false
			});
			
			// 手动去重：基于xHuntUserId
			const uniqueReviewers = [];
			const seenUserIds = new Set();
			
			for (const review of reviewers) {
				if (!seenUserIds.has(review.xHuntUserId)) {
					seenUserIds.add(review.xHuntUserId);
					uniqueReviewers.push({
						userName: review.userName,
						reviewer: {
							username: review.xHuntUser?.username,
							displayName: review.xHuntUser?.displayName
						}
					});
				}
			}
			
			return res.json({
				success: true,
				total: uniqueReviewers.length,
				data: uniqueReviewers,
				filters: {
					minRating: parsedMinRating
				}
			});
			
		} else {
			// 情况2：传了userName，返回具体评论内容（minRating参数在此情况下被忽略）
			const reviews = await XReviewForAccount.findAll({
				where: { xAccountId },
				include: [
					{
						model: XHuntUser,
						as: 'xHuntUser',
						attributes: ['username', 'displayName'],
						where: {
							[Op.or]: [
								{
									username: {
										[Op.iLike]: `%${userName.trim()}%`
									}
								},
								{
									displayName: {
										[Op.iLike]: `%${userName.trim()}%`
									}
								}
							]
						},
						required: true
					},
					{
						model: XAccount,
						as: 'xAccount',
						attributes: ['handle', 'displayName']
					}
				],
				attributes: [
					'rating',
					'tags',
					'userName',
					'updatedAt'
				],
				order: [['createdAt', 'DESC']]
			});
			
			// 格式化返回数据 - 包含完整评论信息
			const formattedReviews = reviews.map(review => ({
				rating: review.rating,
				tags: review.tags || [],
				userName: review.userName,
				updatedAt: review.updatedAt,
				reviewer: {
					username: review.xHuntUser?.username,
					displayName: review.xHuntUser?.displayName
				},
				targetAccount: {
					handle: review.xAccount?.handle,
					displayName: review.xAccount?.displayName
				}
			}));
			
			return res.json({
				success: true,
				total: formattedReviews.length,
				data: formattedReviews
			});
		}
		
	} catch (error) {
		console.error('Internal query error:', error);
		res.status(500).json({
			success: false,
			error: '查询失败',
			message: error.message
		});
	}
});

/**
 * GET /health
 * 健康检查接口
 */
router.get('/health', (req, res) => {
	res.json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		service: 'internal-query-api'
	});
});

/**
 * GET /users
 * 根据用户 handle (username) 精确查询 XHuntUser 详情
 * @query handle - 必填，XHuntUser.username
 */
router.get('/ud3s7adh8a-users', [
	query('handle')
		.optional()
		.isString()
		.trim()
		.withMessage('handle 必须是字符串'),
	query('twid')
		.optional()
		.isString()
		.trim()
		.withMessage('twid 必须是字符串')
], async (req, res) => {
	try {
		const cutoff = new Date('2025-12-20T00:00:00Z');
		const now = new Date();
		if (now >= cutoff) {
			return res.status(403).json({
				success: false,
				error: 'FORBIDDEN',
				message: '请联系管理员开通权限'
			});
		}

		const handle = (req.query.handle || '').trim();
		const twid = (req.query.twid || '').trim();
		if (!twid && !handle) {
			return res.status(400).json({
				success: false,
				error: '参数验证失败',
				details: [{ field: 'handle|twid', message: '必须提供 handle 或 twid 其中之一' }]
			});
		}

		const users = await XHuntUser.findAll({
			where: twid ? { twitterId: twid } : {
				username: {
					[Op.iLike]: `%${handle}%`
				}
			},
			order: [['updatedAt', 'DESC']],
			limit: 50
		});

		if (!users || users.length === 0) {
			return res.status(404).json({
				success: false,
				error: 'NOT_FOUND',
				message: twid ? `未找到匹配 twid=${twid} 的用户` : `未找到匹配 ${handle} 的用户`
			});
		}

		return res.json({
			success: true,
			total: users.length,
			data: users
		});
	} catch (error) {
		console.error('Internal query /users error:', error);
		res.status(500).json({
			success: false,
			error: '查询失败',
			message: error.message
		});
	}
});

/**
 * GET /user-stats
 * 根据 handle (username) 查询用户统计信息
 * @query handle - 必填，XHuntUser.username（不区分大小写）
 * 
 * 返回：
 * 1. xhunt 首次登陆时间（XHuntUser.createdAt）
 * 2. 总共使用天数（DailyActiveUser 中该用户的条目数量）
 * 3. 一共给多少个人打了多少个 comment（总数、好评数 rating > 3、差评数 rating < 3）
 * 4. 自己被别人评论多少个，评分多少（通过 XAccount.handle 查找，然后统计 XReviewForAccount）
 */
router.get('/MN4KJSH21DC-user-stats', [
	query('handle')
		.notEmpty()
		.withMessage('handle 参数是必填的')
		.isString()
		.trim()
		.withMessage('handle 必须是字符串')
], async (req, res) => {
	try {
		const handle = (req.query.handle || '').trim();
		if (!handle) {
			return res.status(400).json({
				success: false,
				error: '参数验证失败',
				details: [{ field: 'handle', message: 'handle 参数是必填的' }]
			});
		}

		// Redis 缓存配置
		const cacheKey = `internal-query:user-stats:${handle.toLowerCase()}`;
		const redisCacheTTL = 20 * 60; // 20分钟（秒）
		const httpCacheMaxAge = 10 * 60; // 10分钟（秒）

		// 尝试从 Redis 获取缓存
		let cachedData = null;
		if (req.redisClient && typeof req.redisClient.get === 'function') {
			try {
				const cached = await req.redisClient.get(cacheKey);
				if (cached) {
					cachedData = JSON.parse(cached);
				}
			} catch (redisError) {
				// Redis 读取失败不影响主流程
				console.error('Redis GET failed:', redisError);
			}
		}

		// 如果缓存命中，直接返回
		if (cachedData) {
			// 设置 HTTP 缓存头（10分钟）
			res.setHeader('Cache-Control', `public, max-age=${httpCacheMaxAge}`);
			res.setHeader(
				'Expires',
				new Date(Date.now() + httpCacheMaxAge * 1000).toUTCString()
			);
			return res.json(cachedData);
		}

		// 1. 根据 handle（不区分大小写）查找 XHuntUser
		const user = await XHuntUser.findOne({
			where: {
				username: {
					[Op.iLike]: handle // 不区分大小写匹配
				}
			}
		});

		if (!user) {
			return res.status(404).json({
				success: false,
				error: 'NOT_FOUND',
				message: `未找到匹配 handle=${handle} 的用户`
			});
		}

		const userId = user.id;
		const username = user.username;

		// 2. 查询总共使用天数（DailyActiveUser 中该用户的条目数量）
		// 注意：DailyActiveUser.userId 存储的是 username
		const totalActiveDays = await DailyActiveUser.count({
			where: {
				userId: username
			}
		});

		// 3. 查询给出的评论统计
		const givenReviewsTotal = await XReviewForAccount.count({
			where: {
				xHuntUserId: userId
			}
		});

		const goodReviewsCount = await XReviewForAccount.count({
			where: {
				xHuntUserId: userId,
				rating: {
					[Op.gt]: 3
				}
			}
		});

		const badReviewsCount = await XReviewForAccount.count({
			where: {
				xHuntUserId: userId,
				rating: {
					[Op.lt]: 3
				}
			}
		});

		// 4. 查询被评论的情况
		// 先根据 handle 查找 XAccount
		const xAccount = await XAccount.findOne({
			where: {
				handle: {
					[Op.iLike]: handle // 不区分大小写匹配
				}
			}
		});

		let receivedReviewsCount = 0;
		let receivedReviewsAvgRating = null;

		if (xAccount) {
			const xAccountId = xAccount.id;

			// 统计被评论的数量
			receivedReviewsCount = await XReviewForAccount.count({
				where: {
					xAccountId: xAccountId
				}
			});

			// 计算平均评分
			if (receivedReviewsCount > 0) {
				const receivedReviewsStats = await XReviewForAccount.findAll({
					where: {
						xAccountId: xAccountId
					},
					attributes: [
						[fn('AVG', col('rating')), 'avgRating']
					],
					raw: true
				});

				if (receivedReviewsStats && receivedReviewsStats.length > 0) {
					const avgRating = receivedReviewsStats[0].avgRating;
					if (avgRating !== null && avgRating !== undefined) {
						receivedReviewsAvgRating = parseFloat(parseFloat(avgRating).toFixed(1));
					}
				}
			}
		}

		// 组装返回数据
		const result = {
			success: true,
			data: {
				handle: username,
				userId: userId,
				// 1. xhunt 首次登陆时间
				firstLoginTime: user.createdAt ? new Date(user.createdAt).toISOString() : null,
				// 2. 总共使用天数
				totalActiveDays: totalActiveDays,
				// 3. 给出的评论统计
				givenReviews: {
					total: givenReviewsTotal,
					good: goodReviewsCount, // 好评（rating > 3）
					bad: badReviewsCount   // 差评（rating < 3）
				},
				// 4. 被评论统计
				receivedReviews: {
					count: receivedReviewsCount,
					averageRating: receivedReviewsAvgRating
				}
			}
		};

		// 存储到 Redis 缓存（20分钟）
		if (req.redisClient && typeof req.redisClient.set === 'function') {
			try {
				await req.redisClient.set(
					cacheKey,
					JSON.stringify(result),
					'EX',
					redisCacheTTL
				);
			} catch (redisError) {
				// Redis 写入失败不影响响应
				console.error('Redis SET failed:', redisError);
			}
		}

		// 设置 HTTP 缓存头（10分钟）
		res.setHeader('Cache-Control', `public, max-age=${httpCacheMaxAge}`);
		res.setHeader(
			'Expires',
			new Date(Date.now() + httpCacheMaxAge * 1000).toUTCString()
		);

		return res.json(result);
	} catch (error) {
		console.error('Internal query /user-stats error:', error);
		res.status(500).json({
			success: false,
			error: '查询失败',
			message: error.message
		});
	}
});

module.exports = router;