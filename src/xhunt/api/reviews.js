const express = require('express');
const { body, param } = require('express-validator');
const { validateRequest } = require('../middleware/validate-request');
const { authenticateToken } = require('../middleware/auth');
const { XReviewForAccount, XHuntUser, XAccount } = require('../models');

const router = express.Router();

// Get reviews for a Twitter account
router.get('/:xAccountId', [
	param('xAccountId').trim().notEmpty(),
	validateRequest
], async (req, res) => {
	try {
		const reviews = await XReviewForAccount.findAll({
			where: { xAccountId: req.params.xAccountId },
			include: [
				{
					model: XHuntUser,
					as: 'reviewer',
					attributes: ['id', 'username', 'displayName', 'avatar']
				},
				{
					model: XAccount,
					as: 'account',
					attributes: ['id', 'handle', 'displayName', 'avatar']
				}
			],
			order: [['createdAt', 'DESC']]
		});
		
		// Calculate stats
		const totalReviews = reviews.length;
		const averageRating = reviews.reduce((acc, review) => acc + review.rating, 0) / totalReviews;
		
		// Generate tag cloud
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
		
		// Get top reviewers
		const topReviewers = reviews.slice(0, 5).map(review => ({
			id: review.reviewer.id,
			avatar: review.reviewer.avatar,
			name: review.reviewer.displayName
		}));
		
		res.json({
			reviews,
			stats: {
				averageRating,
				totalReviews,
				tagCloud,
				topReviewers
			}
		});
	} catch (error) {
		console.error('Error fetching reviews:', error);
		res.status(500).json({ error: 'Failed to fetch reviews' });
	}
});

// Create a new review
router.post('/', [
	authenticateToken,
	body('xAccountId').trim().notEmpty(),
	body('rating').isInt({ min: 1, max: 5 }),
	body('tags').isArray({ min: 1 }),
	body('note').optional().trim(),
	validateRequest
], async (req, res) => {
	try {
		const review = await XReviewForAccount.create({
			xHuntUserId: req.user.id,
			xAccountId: req.body.xAccountId,
			userAvatar: req.user.avatar,
			userName: req.user.displayName,
			rating: req.body.rating,
			tags: req.body.tags,
			note: req.body.note
		});
		
		res.status(201).json(review);
	} catch (error) {
		console.error('Error creating review:', error);
		res.status(500).json({ error: 'Failed to create review' });
	}
});

// Update a review
router.put('/:id', [
	authenticateToken,
	param('id').trim().notEmpty(),
	body('rating').isInt({ min: 1, max: 5 }),
	body('tags').isArray({ min: 1 }),
	body('note').optional().trim(),
	validateRequest
], async (req, res) => {
	try {
		const review = await XReviewForAccount.findOne({
			where: {
				id: req.params.id,
				xHuntUserId: req.user.id
			}
		});
		
		if (!review) {
			return res.status(404).json({ error: 'Review not found' });
		}
		
		await review.update({
			rating: req.body.rating,
			tags: req.body.tags,
			note: req.body.note
		});
		
		res.json(review);
	} catch (error) {
		console.error('Error updating review:', error);
		res.status(500).json({ error: 'Failed to update review' });
	}
});

// Delete a review
router.delete('/:id', [
	authenticateToken,
	param('id').trim().notEmpty(),
	validateRequest
], async (req, res) => {
	try {
		const review = await XReviewForAccount.findOne({
			where: {
				id: req.params.id,
				xHuntUserId: req.user.id
			}
		});
		
		if (!review) {
			return res.status(404).json({ error: 'Review not found' });
		}
		
		await review.destroy();
		res.status(204).send();
	} catch (error) {
		console.error('Error deleting review:', error);
		res.status(500).json({ error: 'Failed to delete review' });
	}
});

module.exports = router;
