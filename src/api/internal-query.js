const express = require('express');
const { query } = require('express-validator');
const { XReviewForAccount, XHuntUser, XAccount, EngageToEarnSignup, EngageToEarnActivity } = require('../models/postgres-start');
const { Op } = require('sequelize');

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
 * GET /e2e-activities
 * 内部查询接口：查询所有 e2e 活动列表
 * 
 * 返回：所有活动信息列表（不包含内部ID）
 */
router.get('/e2e-activities', async (req, res) => {
	try {
		// 查询所有活动
		const activities = await EngageToEarnActivity.findAll({
			order: [['createdAt', 'DESC']], // 按创建时间降序排列
			attributes: [
				'activitySlug',
				'externalId',
				'avatarImage',
				'tweetLink',
				'rewardLabel',
				'rewardAmountUsd',
				'title',
				'description',
				'startAt',
				'endAt',
				'limitProOnly',
				'limitByFollowers',
				'minFollowers',
				'requiresEvmBound',
				'status',
				'participantCount',
				'createdAt',
				'updatedAt'
			]
		});
		
		// 格式化返回数据（不包含内部ID）
		const formattedActivities = activities.map(activity => ({
			// activitySlug: activity.activitySlug,
			// externalId: activity.externalId,
			avatarImage: activity.avatarImage,
			tweetLink: activity.tweetLink,
			rewardLabel: activity.rewardLabel,
			rewardAmountUsd: activity.rewardAmountUsd ? parseFloat(activity.rewardAmountUsd) : null,
			title: activity.title,
			description: activity.description,
			startAt: activity.startAt,
			endAt: activity.endAt,
			limitProOnly: activity.limitProOnly,
			limitByFollowers: activity.limitByFollowers,
			minFollowers: activity.minFollowers,
			requiresEvmBound: activity.requiresEvmBound,
			status: activity.status,
			participantCount: activity.participantCount,
			createdAt: activity.createdAt,
			updatedAt: activity.updatedAt
		}));
		
		return res.json({
			success: true,
			total: formattedActivities.length,
			data: formattedActivities
		});
		
	} catch (error) {
		console.error('E2E activities query error:', error);
		res.status(500).json({
			success: false,
			error: '查询失败',
			message: error.message
		});
	}
});

/**
 * GET /e2e-activity-signups
 * 内部查询接口：查询某个活动的所有报名用户
 * @query activityId - 活动ID (必填，UUID格式)
 * 
 * 返回：所有报名该活动的用户信息列表（不包含内部ID）
 */
router.get('/e2e-activity-signups', [
	query('activityId')
		.notEmpty()
		.withMessage('activityId参数是必填的')
		.isUUID()
		.withMessage('activityId必须是有效的UUID格式')
], async (req, res) => {
	try {
		// 验证参数
		const errors = [];
		if (!req.query.activityId) {
			errors.push({ field: 'activityId', message: 'activityId参数是必填的' });
		} else {
			// 验证UUID格式
			const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
			if (!uuidRegex.test(req.query.activityId)) {
				errors.push({ field: 'activityId', message: 'activityId必须是有效的UUID格式' });
			}
		}
		
		if (errors.length > 0) {
			return res.status(400).json({
				success: false,
				error: '参数验证失败',
				details: errors
			});
		}

		const { activityId } = req.query;
		
		// 查询该活动的所有报名记录，包含用户信息
		const signups = await EngageToEarnSignup.findAll({
			where: {
				activityId: activityId
			},
			include: [{
				model: XHuntUser,
				as: 'xHuntUser',
				attributes: ['id', 'username', 'displayName', 'avatar', 'twitterId']
			}],
			attributes: [
				'id',
				'xHuntUserId',
				'xHuntUserName',
				'twitterId',
				'activityId',
				'activityTitle',
				'tweetLink',
				'signedAt',
				'createdAt',
				'updatedAt'
			],
			order: [['signedAt', 'DESC']] // 按报名时间降序排列
		});
		
		// 格式化返回数据（不包含内部ID）
		const formattedSignups = signups.map(signup => ({
			signedAt: signup.signedAt,
			tweetLink: signup.tweetLink,
			user: {
				username: signup.xHuntUser?.username || signup.xHuntUserName,
				displayName: signup.xHuntUser?.displayName,
				avatar: signup.xHuntUser?.avatar,
				twitterId: signup.xHuntUser?.twitterId || signup.twitterId
			},
			activity: {
				title: signup.activityTitle
			}
		}));
		
		return res.json({
			success: true,
			total: formattedSignups.length,
			data: formattedSignups
		});
		
	} catch (error) {
		console.error('Activity signups query error:', error);
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

module.exports = router;