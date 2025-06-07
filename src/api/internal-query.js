const express = require('express');
const { query } = require('express-validator');
const { XReviewForAccount, XHuntUser, XAccount } = require('../models/postgres-start');
const { Op } = require('sequelize');

const router = express.Router();

/**
 * GET /reviews
 * 内部查询接口：查询某个用户对某个推特账号的评价内容
 * @query xAccountId - X账号ID (必填)
 * @query userName - 用户名 (可选，支持模糊查询)
 */
router.get('/reviews', [
	query('xAccountId')
		.notEmpty()
		.withMessage('xAccountId参数是必填的')
		.isUUID()
		.withMessage('xAccountId必须是有效的UUID格式'),
	query('userName')
		.notEmpty()
		.withMessage('userName参数是必填的')
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
		
		// 构建查询条件
		const whereConditions = {
			xAccountId: xAccountId
		};
		
		// 如果提供了userName，添加模糊查询条件
		if (userName && userName.trim()) {
			whereConditions.userName = {
				[Op.iLike]: `%${userName.trim()}%` // 使用iLike进行大小写不敏感的模糊查询
			};
		}
		
		// 查询评价记录
		const reviews = await XReviewForAccount.findAll({
			where: whereConditions,
			include: [
				{
					model: XHuntUser,
					as: 'xHuntUser',
					attributes: ['id', 'username', 'displayName', 'avatar', 'kolRank20W', 'classification']
				},
				{
					model: XAccount,
					as: 'xAccount',
					attributes: ['id', 'handle', 'displayName', 'avatar', 'followers', 'following']
				}
			],
			attributes: [
				'id',
				'rating',
				'tags',
				'userName',
				'userAvatar',
				'createdAt',
				'updatedAt'
			],
			order: [['createdAt', 'DESC']] // 按创建时间倒序排列
		});
		
		// 格式化返回数据
		const formattedReviews = reviews.map(review => ({
			rating: review.rating,
			tags: review.tags || [],
			userName: review.userName,
			userAvatar: review.userAvatar,
			createdAt: review.createdAt,
			updatedAt: review.updatedAt,
			reviewer: {
				username: review.xHuntUser?.username,
				displayName: review.xHuntUser?.displayName,
				avatar: review.xHuntUser?.avatar,
				kolRank20W: review.xHuntUser?.kolRank20W,
				classification: review.xHuntUser?.classification
			},
			targetAccount: {
				handle: review.xAccount?.handle,
				displayName: review.xAccount?.displayName,
				avatar: review.xAccount?.avatar
			}
		}));
		
		// 返回查询结果
		res.json({
			success: true,
			total: formattedReviews.length,
			data: formattedReviews,
			// query: {
			// 	xAccountId,
			// 	userName: userName || null
			// }
		});
		
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
