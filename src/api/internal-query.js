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
 * @query limit - 返回记录数限制 (可选，默认20，最大100)
 * @query offset - 偏移量 (可选，默认0，用于分页)
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
	query('limit')
		.optional()
		.isInt({ min: 1, max: 100 })
		.withMessage('limit必须是1-100之间的整数')
		.toInt(),
	query('offset')
		.optional()
		.isInt({ min: 0 })
		.withMessage('offset必须是非负整数')
		.toInt()
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

		const { xAccountId, userName, limit = 20, offset = 0 } = req.query;
		
		// 构建查询条件
		const whereConditions = {
			xAccountId: xAccountId
		};
		
		// 构建 include 条件
		const includeConditions = [
			{
				model: XHuntUser,
				as: 'xHuntUser',
				attributes: ['id', 'username', 'displayName', 'avatar', 'kolRank20W', 'classification'],
				// 如果提供了userName，在XHuntUser的username上进行模糊查询
				where: userName && userName.trim() ? {
					[Op.or]: [
						{
							username: {
								[Op.iLike]: `%${userName.trim()}%` // 使用iLike进行大小写不敏感的模糊查询
							}
						},
						{
							displayName: {
								[Op.iLike]: `%${userName.trim()}%` // 同时在displayName上查询
							}
						}
					]
				} : undefined,
				required: !!(userName && userName.trim()) // 如果有userName条件，则必须匹配
			},
			{
				model: XAccount,
				as: 'xAccount',
				attributes: ['id', 'handle', 'displayName', 'avatar'] // 移除不必要的字段
			}
		];
		
		// 查询评价记录 - 使用分页和限制
		const { rows: reviews, count: totalCount } = await XReviewForAccount.findAndCountAll({
			where: whereConditions,
			include: includeConditions,
			attributes: [
				'id',
				'rating',
				'tags',
				'userName',
				'userAvatar',
				'createdAt',
				'updatedAt'
			],
			order: [['createdAt', 'DESC']], // 按创建时间倒序排列
			limit: parseInt(limit, 10),
			offset: parseInt(offset, 10),
			distinct: true // 确保count准确
		});
		
		// 格式化返回数据
		const formattedReviews = reviews.map(review => ({
			id: review.id,
			rating: review.rating,
			tags: review.tags || [],
			userName: review.userName,
			userAvatar: review.userAvatar,
			createdAt: review.createdAt,
			updatedAt: review.updatedAt,
			reviewer: {
				id: review.xHuntUser?.id,
				username: review.xHuntUser?.username,
				displayName: review.xHuntUser?.displayName,
				avatar: review.xHuntUser?.avatar,
				kolRank20W: review.xHuntUser?.kolRank20W,
				classification: review.xHuntUser?.classification
			},
			targetAccount: {
				id: review.xAccount?.id,
				handle: review.xAccount?.handle,
				displayName: review.xAccount?.displayName,
				avatar: review.xAccount?.avatar
			}
		}));
		
		// 计算分页信息
		const totalPages = Math.ceil(totalCount / limit);
		const currentPage = Math.floor(offset / limit) + 1;
		const hasNextPage = offset + limit < totalCount;
		const hasPrevPage = offset > 0;
		
		// 返回查询结果
		res.json({
			success: true,
			data: formattedReviews,
			pagination: {
				total: totalCount,
				limit: parseInt(limit, 10),
				offset: parseInt(offset, 10),
				currentPage,
				totalPages,
				hasNextPage,
				hasPrevPage
			}
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
 * GET /reviews/stats
 * 获取指定账号的评价统计信息（不返回具体评价内容，性能更好）
 * @query xAccountId - X账号ID (必填)
 */
router.get('/reviews/stats', [
	query('xAccountId')
		.notEmpty()
		.withMessage('xAccountId参数是必填的')
		.isUUID()
		.withMessage('xAccountId必须是有效的UUID格式')
], async (req, res) => {
	try {
		const { xAccountId } = req.query;
		
		if (!xAccountId) {
			return res.status(400).json({
				error: '参数验证失败',
				details: [{ field: 'xAccountId', message: 'xAccountId参数是必填的' }]
			});
		}
		
		// 使用原生SQL查询获取统计信息，性能更好
		const [statsResult] = await XReviewForAccount.sequelize.query(`
			SELECT 
				COUNT(*) as total_reviews,
				AVG(rating) as average_rating,
				COUNT(DISTINCT "xHuntUserId") as unique_reviewers
			FROM "XReviewForAccounts" 
			WHERE "xAccountId" = :xAccountId
		`, {
			replacements: { xAccountId },
			type: XReviewForAccount.sequelize.QueryTypes.SELECT
		});
		
		res.json({
			success: true,
			data: {
				totalReviews: parseInt(statsResult.total_reviews, 10),
				averageRating: parseFloat(Number(statsResult.average_rating || 0).toFixed(2)),
				uniqueReviewers: parseInt(statsResult.unique_reviewers, 10)
			}
		});
		
	} catch (error) {
		console.error('Internal query stats error:', error);
		res.status(500).json({
			success: false,
			error: '查询统计信息失败',
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