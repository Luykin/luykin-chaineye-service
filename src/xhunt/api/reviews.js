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
const kolProfileTags = [
	'🔥有灵魂的KOL', '投研', '二级', '套利', '打新', 'Meme',
	'段子手', '宏观', '空投', '美女', '科学家',
	'创业者', 'VC', '假冒账户', '诈骗犯', '黑名单',
	'degen', '鲸鱼', '钻石手', '车头', '大佬',
	'喊单', '反指', '舔狗', '抄袭', '镰刀', '纸手'
];

// # 项目/机构特征标签
const projectCharacterTags = [
	'团队豪华', '宏大叙事', '技术领先', '被反撸',
	'老鼠仓', '诈骗项目', '求拉盘'
];

const colorTags = {
	'🔥有灵魂的KOL': {
		color: '#c02cd3',
		bg: 'rgba(192,44,211,0.1)'
	}
};

/** 内置tag ===end === **/

// GET /reviews/:handle
router.get('/:handle', [
	authenticateTokenOptional,
	param('handle').trim().notEmpty(),
	query('onlyKOL').optional().isBoolean().toBoolean(),
	validateRequest
], async (req, res) => {
	try {
		const handle = req.params.handle;
		const twid = req.twid;
		const onlyKOL = req.query.onlyKOL === true;
		// Step 1: 获取 XAccount 及其基础信息 - 优先用 twid 匹配 xId
		let xAccount = null;
		if (twid) {
			xAccount = await XAccount.findOne({
				where: { xId: twid },
				attributes: ['id']
			});
		}
		if (!xAccount) {
			xAccount = await XAccount.findOne({
				where: {
					handle: {
						[Op.iLike]: handle
					}
				},
				attributes: ['id']
			});
		}
		
		if (!xAccount) {
			return res.json({
				defaultTags: {
					kol: kolProfileTags,
					project: projectCharacterTags,
					colorTags
				}
			});
		}
		
		const accountId = xAccount.id;
		
		// Step 2: 使用 Sequelize 执行聚合查询（带关联）- 根据 onlyKOL 筛选
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
		
		// Step 2.1: 新增 - 获取真实的总评论数（不受 onlyKOL 筛选影响）
		const realTotalReviews = await XReviewForAccount.count({
			where: { xAccountId: accountId }
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
					'note', //本字段即将需要被废弃⚠️
					'comment' // 新增返回 comment 字段
				],
				raw: true
			});
		}
		
		// Step 7: 返回结果
		res.json({
			averageRating,
			totalReviews,
			realTotalReviews, // 新增字段：真实的总评论数
			tagCloud,
			topReviewers,
			currentUserReview,
			allTagCount,
			defaultTags: {
				kol: kolProfileTags,
				project: projectCharacterTags,
				colorTags
			}
		});
	} catch (error) {
		console.error('Error fetching reviews:', error);
		res.status(500).json({ error: 'Failed to fetch reviews' });
	}
});

// 🆕 GET /reviews/:handle/comments - 获取某个 handle 的所有长评论（分页）
router.get('/:handle/comments', [
	authenticateTokenOptional,
	param('handle').trim().notEmpty().withMessage('账号handle不能为空'),
	query('page').optional().isInt({ min: 1 }).withMessage('页码必须是大于0的整数'),
	query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('每页数量必须在1-50之间'),
	query('onlyKOL').optional().isBoolean().toBoolean(),
	validateRequest
], async (req, res) => {
	try {
		const handle = req.params.handle;
		const twid = req.twid;
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 10;
		const onlyKOL = req.query.onlyKOL === true;
		const offset = (page - 1) * limit;
		
		// Step 1: 查找目标账号 - 优先用 twid 匹配 xId，其次按 handle（大小写不敏感）
		let xAccount = null;
		if (twid) {
			xAccount = await XAccount.findOne({
				where: { xId: twid },
				attributes: ['id', 'handle', 'displayName', 'avatar']
			});
		}
		if (!xAccount) {
			xAccount = await XAccount.findOne({
				where: {
					handle: {
						[Op.iLike]: handle
					}
				},
				attributes: ['id', 'handle', 'displayName', 'avatar']
			});
		}
		
		if (!xAccount) {
			return res.status(404).json({ error: 'Account not found' });
		}
		
		// Step 2: 构建查询条件
		const whereClause = {
			xAccountId: xAccount.id,
			comment: {
				[Op.and]: [
					{ [Op.ne]: null },     // comment 不为 null
					{ [Op.ne]: '' }        // comment 不为空字符串
				]
			}
		};
		
		// Step 3: 构建关联查询条件（KOL筛选）
		const includeClause = {
			model: XHuntUser,
			as: 'xHuntUser',
			attributes: ['username', 'displayName', 'avatar', 'kolRank20W', 'classification'],
			required: true // 必须有关联的用户
		};
		
		if (onlyKOL) {
			includeClause.where = { kolRank20W: { [Op.ne]: null } };
		}
		
		// Step 4: 查询长评论列表（分页）
		const { rows: comments, count: totalComments } = await XReviewForAccount.findAndCountAll({
			where: whereClause,
			include: [includeClause],
			attributes: [
				'id',
				'rating',
				'tags',
				'comment',
				'userAvatar',
				'userName',
				'createdAt',
				'updatedAt'
			],
			order: [['createdAt', 'DESC']], // 按创建时间倒序
			limit,
			offset
		});
		
		// Step 5: 格式化返回数据
		const formattedComments = comments.map(comment => ({
			id: comment.id,
			rating: parseFloat(comment.rating),
			tags: comment.tags || [],
			comment: comment.comment,
			createdAt: comment.createdAt,
			updatedAt: comment.updatedAt,
			reviewer: {
				username: comment.xHuntUser?.username,
				displayName: comment.xHuntUser?.displayName || comment.userName,
				avatar: comment.xHuntUser?.avatar || comment.userAvatar,
				kolRank20W: comment.xHuntUser?.kolRank20W,
				classification: comment.xHuntUser?.classification,
				isKOL: comment.xHuntUser?.kolRank20W !== null
			}
		}));
		
		// Step 6: 计算分页信息
		const totalPages = Math.ceil(totalComments / limit);
		
		// Step 7: 返回结果
		res.json({
			success: true,
			data: {
				account: {
					handle: xAccount.handle,
					displayName: xAccount.displayName,
					avatar: xAccount.avatar
				},
				comments: formattedComments,
				pagination: {
					page,
					limit,
					totalComments,
					totalPages,
					hasNextPage: page < totalPages,
					hasPrevPage: page > 1
				},
				filters: {
					onlyKOL
				}
			}
		});
		
	} catch (error) {
		console.error('Error fetching comments for handle:', error);
		res.status(500).json({ error: 'Failed to fetch comments' });
	}
});

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
		const twid = req.twid;
		/** 提前检查评论数量上限 **/
		const cacheKey = `user:review:limit:${req.user.id}`;
		const userReviewsLimit = await req.redisClient.get(cacheKey);
		if (userReviewsLimit) {
			return res.status(403).json({ status: 'error', error: '您今日已达到最大评论次数（5次）' });
		}
		// Step 1: 查找或创建 XAccount - 优先按 twid 匹配 xId，其次按 handle（大小写不敏感）
		let xAccount = null;
		if (twid) {
			xAccount = await XAccount.findOne({ where: { xId: twid } });
		}
		if (!xAccount) {
			xAccount = await XAccount.findOne({
				where: {
					handle: {
						[Op.iLike]: handle // 使用 iLike 进行大小写不敏感查找
					}
				}
			});
		}
		
		if (!xAccount) {
			// 如果不存在，创建一个新的 XAccount
			xAccount = await XAccount.create({
				xLink,
				handle,
				displayName,
				avatar,
				followers: followers || 0,
				following: following || 0,
				...(twid ? { xId: twid } : {})
			});
		} else {
			// 如果存在，更新相关信息
			await xAccount.update({
				displayName,
				avatar,
				followers: followers || 0,
				following: following || 0,
				...(twid ? { xId: twid } : {})
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

router.post('/delete', [
	authenticateToken,
	body('handle').trim().notEmpty(),
	validateRequest
], async (req, res) => {
	try {
		const { handle } = req.body;
		
		// Step 1: 查找目标 XAccount - 大小写不敏感查找
		const xAccount = await XAccount.findOne({
			where: {
				handle: {
					[Op.iLike]: handle // 使用 iLike 进行大小写不敏感查找
				}
			}
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
