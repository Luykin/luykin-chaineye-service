const express = require('express');
const { query } = require('express-validator');
const { XReviewForAccount, XHuntUser, XAccount } = require('../models/postgres-start');
const { Op } = require('sequelize');

const router = express.Router();

/**
 * GET /reviews
 * 内部查询接口：查询某个推特账号的评价信息
 * @query xAccountId - X账号ID (必填)
 * @query userName - 用户名 (可选，支持模糊查询)
 * 
 * 逻辑：
 * 1. 不传userName：返回所有评论用户的基本信息列表
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
		.withMessage('userName必须是字符串')
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

		const { xAccountId, userName } = req.query;
		
		if (!userName || !userName.trim()) {
			// 情况1：不传userName，只返回评论用户列表
			const reviewers = await XReviewForAccount.findAll({
				where: { xAccountId },
				include: [{
					model: XHuntUser,
					as: 'xHuntUser',
					attributes: ['username', 'displayName']
				}],
				attributes: ['userName'],
				order: [['createdAt', 'DESC']],
				// 去重：每个用户只显示一次
				group: ['XReviewForAccount.xHuntUserId', 'xHuntUser.id', 'XReviewForAccount.userName'],
				raw: false
			});
			
			// 格式化返回数据 - 只返回用户信息
			const formattedReviewers = reviewers.map(review => ({
				userName: review.userName,
				reviewer: {
					username: review.xHuntUser?.username,
					displayName: review.xHuntUser?.displayName
				}
			}));
			
			return res.json({
				success: true,
				total: formattedReviewers.length,
				data: formattedReviewers
			});
			
		} else {
			// 情况2：传了userName，返回具体评论内容
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
					'createdAt',
					'updatedAt'
				],
				order: [['createdAt', 'DESC']]
			});
			
			// 格式化返回数据 - 包含完整评论信息
			const formattedReviews = reviews.map(review => ({
				rating: review.rating,
				tags: review.tags || [],
				userName: review.userName,
				createdAt: review.createdAt,
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

module.exports = router;