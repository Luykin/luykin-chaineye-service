const express = require('express');
const { body, param, query } = require('express-validator');
const { validateRequest } = require('../middleware/validate-request');
const { authenticateToken, authenticateTokenOptional } = require('../middleware/auth');
const { XReviewForAccount, XHuntUser, XAccount, XPointRecord } = require('../../models/postgres-start');
const { validateTags, validateNote, validateComment } = require('../middleware/reviewValidator');
const { sanitizeNote, sanitizeComment } = require('../services/inputValidator');
const { getPointsByRank } = require('../services/twitter');
const router = express.Router();

// Get reviews for a Twitter account
const { fn, col, Op } = require('sequelize');

/** 内置tag ===start === **/
// # KOL人物类型标签
kolProfileTags = [
	'投研', '二级', '套利', '打新', 'Meme',
	'段子手', '宏观', '空投', '美女', '科学家',
	'创业者', 'VC', '假冒账户', '诈骗犯', '黑名单',
	'degen', '鲸鱼', '钻石手', '车头', '大佬',
	'喊单', '反指', '舔狗', '抄袭', '镰刀', '纸手'
];

// # 项目/机构特征标签
projectCharacterTags = [
	'团队豪华', '宏大叙事', '技术领先', '被反撸',
	'老鼠仓', '诈骗项目', '求拉盘'
];

/** 内置tag ===end === **/

/**
 * @swagger
 * /reviews/{handle}:
 *   get:
 *     tags:
 *       - Reviews
 *     summary: 获取X账号的评论汇总
 *     description: 获取指定X账号的评论统计信息，包括平均评分、标签云、最近评论用户等
 *     security:
 *       - SecurityHeaders: []
 *     parameters:
 *       - name: handle
 *         in: path
 *         required: true
 *         description: X账号用户名（不含@符号）
 *         schema:
 *           type: string
 *           example: "elonmusk"
 *       - name: onlyKOL
 *         in: query
 *         required: false
 *         description: 是否只显示KOL用户的评论
 *         schema:
 *           type: boolean
 *           default: false
 *     responses:
 *       200:
 *         description: 成功获取评论汇总
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReviewSummary'
 *       404:
 *         description: 账号不存在
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: 服务器内部错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// GET /reviews/:handle
router.get('/:handle', [
	authenticateTokenOptional,
	param('handle').trim().notEmpty(),
	query('onlyKOL').optional().isBoolean().toBoolean(),
	validateRequest
], async (req, res) => {
	try {
		const handle = req.params.handle;
		const onlyKOL = req.query.onlyKOL === true;
		// Step 1: 获取 XAccount 及其基础信息
		const xAccount = await XAccount.findOne({
			where: { handle },
			attributes: ['id']
		});
		
		if (!xAccount) {
			return res.status(404).json({ error: 'Account not found' });
		}
		
		const accountId = xAccount.id;
		
		// Step 2: 使用 Sequelize 执行聚合查询（带关联）
		const stats = await XReviewForAccount.findOne({
			where: { xAccountId: accountId },
			include: [{
				model: XHuntUser,
				as: 'xHuntUser',
				where: onlyKOL ? { kolRank20W: { [Op.ne]: null } } : undefined,
				required: onlyKOL,
				attributes: []
			}],
			attributes: [
				[fn('AVG', col('rating')), 'averageRating'],
				[fn('COUNT', col('XReviewForAccount.id')), 'totalReviews'],
				[fn('JSON_AGG', col('tags')), 'allTags']
			],
			raw: true,
			nest: true
		});
		
		let averageRating = Number(Number(stats.averageRating || 0).toFixed(2));
		const totalReviews = parseInt(stats.totalReviews, 10);
		
		// Step 3: 解析所有标签（扁平化数组）
		let allTags = [];
		if (stats.allTags) {
			stats.allTags.forEach(tagArr => {
				allTags = [...allTags, ...tagArr];
			});
		}
		
		// Step 4: 构建 tagCloud（仅前 10 个高频标签）
		const tagCounts = {};
		allTags.forEach(tag => {
			tagCounts[tag] = (tagCounts[tag] || 0) + 1;
		});
		const allTagCount = Object.keys(tagCounts || {}).length;
		
		// 只取前 10 个
		const tagCloud = Object.entries(tagCounts)
			.map(([text, value]) => ({ text, value }))
			.sort((a, b) => b.value - a.value)
			.slice(0, 10);
		
		// Step 5: 获取前 5 条评论用户（避免加载全部评论）
		let topReviewers = await XReviewForAccount.findAll({
			where: { xAccountId: accountId },
			limit: 5,
			order: [['createdAt', 'DESC']],
			attributes: ['userAvatar', 'userName'],
			include: [{
				model: XHuntUser,
				as: 'xHuntUser',
				where: onlyKOL ? { kolRank20W: { [Op.ne]: null } } : undefined,
				required: onlyKOL
			}],
			raw: true,
			// group: ['xHuntUser.displayName', 'xHuntUser.id'], // 必须包含所有非聚合字段
			// having: fn('COUNT', col('XReviewForAccount.id')) > 0,
			// raw: true
		});
		topReviewers = topReviewers.map(review => ({
			avatar: review.userAvatar,
			name: review.userName
		}));
		
		// Step 6: 如果登录了，检查当前用户是否评论过
		let currentUserReview = null;
		if (req.user) {
			currentUserReview = await XReviewForAccount.findOne({
				where: {
					xHuntUserId: req.user.id,
					xAccountId: accountId
				},
				attributes: ['rating', 'tags',
					'note' //本字段即将需要被废弃⚠️
				],
				raw: true
			});
		}
		
		// Step 7: 返回结果
		res.json({
			averageRating,
			totalReviews,
			tagCloud,
			topReviewers,
			currentUserReview,
			allTagCount,
			defaultTags: {
				kol: kolProfileTags,
				project: projectCharacterTags
			}
		});
	} catch (error) {
		console.error('Error fetching reviews:', error);
		res.status(500).json({ error: 'Failed to fetch reviews' });
	}
});

/**
 * @swagger
 * /reviews:
 *   post:
 *     tags:
 *       - Reviews
 *     summary: 创建或更新评论
 *     description: 为指定X账号创建新评论或更新已有评论。每日限制5次新评论。
 *     security:
 *       - BearerAuth: []
 *       - SecurityHeaders: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - handle
 *               - xLink
 *               - displayName
 *               - avatar
 *               - rating
 *               - tags
 *             properties:
 *               handle:
 *                 type: string
 *                 description: X账号用户名（不含@）
 *                 example: "elonmusk"
 *               xLink:
 *                 type: string
 *                 format: uri
 *                 description: X账号完整链接
 *                 example: "https://x.com/elonmusk"
 *               displayName:
 *                 type: string
 *                 description: X账号显示名称
 *                 example: "Elon Musk"
 *               avatar:
 *                 type: string
 *                 format: uri
 *                 description: X账号头像URL
 *                 example: "https://pbs.twimg.com/profile_images/..."
 *               followers:
 *                 type: integer
 *                 description: 关注者数量
 *                 example: 50000000
 *               following:
 *                 type: integer
 *                 description: 正在关注的数量
 *                 example: 100
 *               rating:
 *                 type: number
 *                 format: float
 *                 minimum: 0.0
 *                 maximum: 5.0
 *                 description: 评分（0.0-5.0，最多一位小数）
 *                 example: 4.5
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 1
 *                 description: 标签列表（至少一个）
 *                 example: ["创业者", "大佬", "技术领先"]
 *               note:
 *                 type: string
 *                 maxLength: 1000
 *                 description: 私人备注（即将废弃，最多1000字符）
 *                 example: "这是一个私人备注"
 *               comment:
 *                 type: string
 *                 maxLength: 3000
 *                 description: 公开评论内容（最多3000字符）
 *                 example: "这是一个公开的评论内容，其他用户可以看到"
 *     responses:
 *       201:
 *         description: 评论创建/更新成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *       400:
 *         description: 请求参数错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: 未授权访问
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: 今日评论次数已达上限（5次）
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "error"
 *                 error:
 *                   type: string
 *                   example: "您今日已达到最大评论次数（5次）"
 *       500:
 *         description: 服务器内部错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', [
	authenticateToken,
	body('handle').trim().notEmpty(),
	body('xLink').trim().notEmpty(),
	body('displayName').trim().notEmpty(),
	body('avatar').trim().notEmpty(),
	body('rating')
		.isFloat({ min: 0.0, max: 5.0 })
		.withMessage('评分必须在 0.0 到 5.0 之间')
		.custom(value => {
			const decimalPart = value.toString().split('.')[1] || '';
			if (decimalPart.length > 1) {
				throw new Error('评分最多保留一位小数');
			}
			return true;
		}),
	validateTags,
	validateNote,
	validateComment
], validateRequest, async (req, res) => {
	try {
		const { handle, xLink, displayName, avatar, followers, following, rating, tags, note, comment } = req.body;
		/** 提前检查评论数量上限 **/
		const cacheKey = `user:review:limit:${req.user.id}`;
		const userReviewsLimit = await req.redisClient.get(cacheKey);
		if (userReviewsLimit) {
			return res.status(403).json({ status: 'error', error: '您今日已达到最大评论次数（5次）' });
		}
		// Step 1: 查找或创建 XAccount
		let xAccount = await XAccount.findOne({
			where: { handle }
		});
		
		if (!xAccount) {
			// 如果不存在，创建一个新的 XAccount
			xAccount = await XAccount.create({
				xLink,
				handle,
				displayName,
				avatar,
				followers: followers || 0,
				following: following || 0,
			});
		} else {
			// 如果存在，更新相关信息
			await xAccount.update({
				displayName,
				avatar,
				followers: followers || 0,
				following: following || 0,
			});
		}
		
		// Step 2: 检查是否已存在评论
		const existingReview = await XReviewForAccount.findOne({
			where: {
				xHuntUserId: req.user.id,
				xAccountId: xAccount.id
			}
		});
		
		const isCreatingNew = !existingReview;
		
		// Step 2.1: 如果是新增评论，检查当日是否已达上限
		if (isCreatingNew) {
			const today = new Date();
			const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
			
			const reviewCount = await XReviewForAccount.count({
				where: {
					xHuntUserId: req.user.id,
					createdAt: {
						[Op.gte]: startOfToday
					}
				}
			});
			
			if (reviewCount >= 5) {
				// const cacheKey = `user:review:limit:${req.user.id}`;
				req.redisClient.setEx(cacheKey, 360, '5');
				return res.status(403).json({ status: 'error', error: '您今日已达到最大评论次数（5次）' });
			}
		}
		
		if (existingReview) {
			// 更新已有评论
			await existingReview.update({
				rating,
				tags: tags.map(t => t.trim()),
				note: sanitizeNote(note || ''), //本字段即将需要被废弃⚠️
				comment: sanitizeComment(comment || '')
			});
		} else {
			// Step 3: 创建新评论
			const newReview = await XReviewForAccount.create({
				xHuntUserId: req.user.id,
				xAccountId: xAccount.id,
				userAvatar: req.user.avatar,
				userName: req.user.displayName,
				rating,
				tags: tags.map(t => t.trim()),
				note: sanitizeNote(note || ''), //本字段即将需要被废弃⚠️
				comment: sanitizeComment(comment || '')
			});
			const points = getPointsByRank(req.user.kolRank20W);
			await XPointRecord.create({
				xHuntUserId: req.user.id,
				reviewId: newReview.id,
				points,
				userRankAtTimeOfReview: req.user.kolRank20W
			});
			const cacheKey1 = `user:points:${req.user.id}`;
			await req.redisClient.del(cacheKey1);
		}
		
		res.status(201).json({ status: 'success' });
	} catch (error) {
		console.error('Error creating review:', error);
		res.status(500).json({ error: 'Failed to create review' });
	}
});

/**
 * @swagger
 * /reviews/delete:
 *   post:
 *     tags:
 *       - Reviews
 *     summary: 删除评论
 *     description: 删除当前用户对指定X账号的评论，同时会删除相关积分记录
 *     security:
 *       - BearerAuth: []
 *       - SecurityHeaders: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - handle
 *             properties:
 *               handle:
 *                 type: string
 *                 description: X账号用户名（不含@）
 *                 example: "elonmusk"
 *     responses:
 *       200:
 *         description: 删除成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "删除成功"
 *       400:
 *         description: 请求参数错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: 未授权访问
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: 评论不存在或无权删除
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: 服务器内部错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/delete', [
	authenticateToken,
	body('handle').trim().notEmpty(),
	validateRequest
], async (req, res) => {
	try {
		const { handle } = req.body;
		
		// Step 1: 查找目标 XAccount
		const xAccount = await XAccount.findOne({
			where: { handle }
		});
		
		if (!xAccount) {
			return res.status(404).json({ error: 'X 账号不存在' });
		}
		
		// Step 2: 查找评论并验证归属
		const review = await XReviewForAccount.findOne({
			where: {
				xHuntUserId: req.user.id,
				xAccountId: xAccount.id
			}
		});
		
		if (!review) {
			return res.status(404).json({ error: '评论不存在或无权删除' });
		}
		
		const pointRecord = await XPointRecord.findOne({
			where: {
				xHuntUserId: req.user.id,
				reviewId: review.id
			}
		});
		
		if (pointRecord) {
			// 删除评论前销毁积分记录
			await pointRecord.destroy();
			const cacheKey1 = `user:points:${req.user.id}`;
			await req.redisClient.del(cacheKey1);
		}
		
		// Step 3: 删除评论
		await review.destroy();
		
		res.status(200).json({ message: '删除成功' });
	} catch (error) {
		console.error('Error deleting review:', error);
		res.status(500).json({ error: 'Failed to delete review' });
	}
});

module.exports = router;