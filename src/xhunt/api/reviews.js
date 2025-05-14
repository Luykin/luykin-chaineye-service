const express = require('express');
const { body, param } = require('express-validator');
const { validateRequest } = require('../middleware/validate-request');
const { authenticateToken, authenticateTokenOptional } = require('../middleware/auth');
const { XReviewForAccount, XHuntUser, XAccount } = require('../../models/postgres-start');
const { validateTags, validateNote } = require('../middleware/reviewValidator');
const { sanitizeNote } = require('../services/inputValidator');

const router = express.Router();

// Get reviews for a Twitter account
const { fn, col } = require('sequelize');

/** 内置tag ===start === **/
// # KOL人物类型标签
kolProfileTags = [
	'投研', '二级', '套利', '打新', 'Meme',
	'段子手', '宏观', '空投', '美女', '科学家',
	'创业者', 'VC', '假冒账户', '诈骗犯', '黑名单'
];

// # 项目/机构特征标签
projectCharacterTags = [
	'团队豪华', '宏大叙事', '技术领先', '被反撸',
	'老鼠仓', '诈骗项目', '求拉盘'
];

/** 内置tag ===end === **/

router.get('/:handle', [
	authenticateTokenOptional,
	param('handle').trim().notEmpty(),
	validateRequest
], async (req, res) => {
	try {
		const handle = req.params.handle;
		
		// Step 1: 获取 XAccount 及其基础信息
		const xAccount = await XAccount.findOne({
			where: { handle },
			attributes: ['id']
		});
		
		if (!xAccount) {
			return res.status(404).json({ error: 'Account not found' });
		}
		
		const accountId = xAccount.id;
		
		// Step 2: 使用 Sequelize 执行聚合查询（替代 JS 处理）
		const stats = await XReviewForAccount.findOne({
			where: { xAccountId: accountId },
			attributes: [
				[fn('AVG', col('rating')), 'averageRating'],
				[fn('COUNT', col('id')), 'totalReviews'],
				[fn('JSON_AGG', col('tags')), 'allTags'], // 收集所有 tags 数组
			],
			raw: true
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
		
		// Step 4: 构建 tagCloud
		const tagCounts = {};
		allTags.forEach(tag => {
			tagCounts[tag] = (tagCounts[tag] || 0) + 1;
		});
		
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
			// include: [{
			// 	model: XHuntUser,
			// 	as: 'xHuntUser',
			// 	attributes: ['displayName', 'avatar']
			// }],
			attributes: ['userAvatar', 'userName'],
			raw: true
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
				attributes: ['rating', 'tags', 'note'],
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

router.post('/', [
	authenticateToken,
	body('handle').trim().notEmpty(),
	body('xLink').trim().notEmpty(),
	body('displayName').trim().notEmpty(),
	body('avatar').trim().notEmpty(),
	body('rating').isInt({ min: 1, max: 5 }),
	validateTags,
	validateNote
], validateRequest, async (req, res) => {
	try {
		const { handle, xLink, displayName, avatar, followers, following, rating, tags, note } = req.body;
		
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
		
		if (existingReview) {
			// 更新已有评论
			await existingReview.update({
				rating,
				tags: tags.map(t => t.trim()),
				note: sanitizeNote(note || '')
			});
		} else {
			// Step 3: 创建新评论
			await XReviewForAccount.create({
				xHuntUserId: req.user.id,
				xAccountId: xAccount.id,
				userAvatar: req.user.avatar,
				userName: req.user.displayName,
				rating,
				tags: tags.map(t => t.trim()),
				note: sanitizeNote(note || '')
			});
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
	body('reviewId').trim().notEmpty(),
	validateRequest
], async (req, res) => {
	try {
		const { handle, reviewId } = req.body;
		
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
				id: reviewId,
				xHuntUserId: req.user.id,
				xAccountId: xAccount.id
			}
		});
		
		if (!review) {
			return res.status(404).json({ error: '评论不存在或无权删除' });
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
