const express = require('express');
const { body, param } = require('express-validator');
const { validateRequest } = require('../middleware/validate-request');
const { authenticateToken, authenticateTokenOptional } = require('../middleware/auth');
const { XReviewForAccount, XHuntUser, XAccount } = require('../../models/postgres-start');
const { validateTags, validateNote } = require('../middleware/reviewValidator');
const { sanitizeNote } = require('../services/inputValidator');

const router = express.Router();

// Get reviews for a Twitter account
router.get('/:handle', [
	authenticateTokenOptional,
	param('handle').trim().notEmpty(),
	validateRequest
], async (req, res) => {
	try {
		const handle = req.params.handle;
		
		// Step 1: 查找 XAccount
		const xAccount = await XAccount.findOne({
			where: { handle },
			include: [
				{
					model: XReviewForAccount,
					as: 'receivedReviews',
					include: [
						{
							model: XHuntUser,
							as: 'xHuntUser',
							attributes: ['id', 'displayName', 'avatar']
						}
					]
				}
			]
		});
		if (!xAccount) {
			return res.status(404).json({ error: 'Account not found' });
		}
		
		const reviews = xAccount.receivedReviews;
		
		// Step 2: 计算统计数据
		const totalReviews = reviews.length;
		const averageRating = totalReviews > 0
			? Number((reviews.reduce((acc, review) => acc + review.rating, 0) / totalReviews).toFixed(2))
			: 0;
		
		// Step 3: 构建标签云
		const tagCounts = {};
		reviews.forEach(review => {
			review.tags.forEach(tag => {
				tagCounts[tag] = (tagCounts[tag] || 0) + 1;
			});
		});
		
		const tagCloud = Object.entries(tagCounts).map(([text, value]) => ({
			text,
			value
		}));
		
		// Step 4: 获取顶级评论者
		const topReviewers = reviews.slice(0, 5).map(review => ({
			avatar: review.userAvatar,
			name: review.userName
		}));
		
		// Step 5: 检查当前用户是否评论过（如果已登录）
		let currentUserReview = null;
		if (req.user) {
			const userReview = reviews.find(review => review.xHuntUserId === req.user.id);
			if (userReview) {
				currentUserReview = {
					// id: userReview.id,
					rating: userReview.rating,
					tags: userReview.tags,
					note: userReview.note
				};
			}
		}
		
		// Step 6: 返回封装好格式的数据
		res.json({
			averageRating,
			totalReviews,
			tagCloud,
			topReviewers,
			currentUserReview
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
