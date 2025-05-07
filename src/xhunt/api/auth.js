const express = require('express');
const jwt = require('jsonwebtoken');
const { User, Token } = require('../models');
const { generateTwitterAuthUrl, getTwitterTokens, getTwitterUserInfo } = require('../services/twitter');
const { validateRequest } = require('../middleware/validate-request');
const { body, param } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { Op } = require('sequelize');

const router = express.Router();

// 获取 Twitter 授权 URL
router.get('/twitter/url', async (req, res) => {
	try {
		const authUrl = await generateTwitterAuthUrl();
		res.json({ url: authUrl });
	} catch (error) {
		console.error('Error generating auth URL:', error);
		res.status(500).json({ error: '获取授权URL失败' });
	}
});

// Twitter OAuth 回调处理
router.post('/twitter/callback', [
	body('code').trim().notEmpty(),
	validateRequest
], async (req, res) => {
	try {
		const { code } = req.body;
		
		const { accessToken, refreshToken, expiresIn } = await getTwitterTokens(code);
		
		const twitterUser = await getTwitterUserInfo(accessToken);
		
		const [user] = await User.findOrCreate({
			where: { twitterId: twitterUser.id },
			defaults: {
				username: twitterUser.username,
				displayName: twitterUser.name,
				avatar: twitterUser.profile_image_url
			}
		});
		
		const tokenExpiry = new Date(Date.now() + expiresIn * 1000);
		const tokenRecord = await Token.create({
			userId: user.id,
			accessToken,
			refreshToken,
			tokenExpiry,
			lastUsed: new Date()
		});
		
		const jwtToken = jwt.sign(
			{
				userId: user.id,
				tokenId: tokenRecord.id
			},
			process.env.JWT_SECRET,
			{ expiresIn: '30d' }
		);
		
		res.json({
			token: jwtToken,
			user: {
				id: user.id,
				username: user.username,
				displayName: user.displayName,
				avatar: user.avatar
			}
		});
	} catch (error) {
		console.error('Twitter callback error:', error);
		res.status(500).json({ error: '登录失败' });
	}
});

// 刷新令牌
router.post('/refresh', async (req, res) => {
	try {
		const authHeader = req.headers['authorization'];
		const token = authHeader && authHeader.split(' ')[1];
		
		if (!token) {
			return res.status(401).json({ error: 'TOKEN_REQUIRED' });
		}
		
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		
		const tokenRecord = await Token.findOne({
			where: {
				id: decoded.tokenId,
				isRevoked: false
			},
			include: ['user']
		});
		
		if (!tokenRecord) {
			return res.status(401).json({ error: 'TOKEN_INVALID' });
		}
		
		const now = new Date();
		if (tokenRecord.tokenExpiry <= new Date(now.getTime() + 24 * 60 * 60 * 1000)) {
			const { accessToken, refreshToken, expiresIn } = await getTwitterTokens(tokenRecord.refreshToken);
			
			await tokenRecord.update({
				accessToken,
				refreshToken,
				tokenExpiry: new Date(now.getTime() + expiresIn * 1000),
				lastUsed: now
			});
		}
		
		const newJwtToken = jwt.sign(
			{
				userId: tokenRecord.user.id,
				tokenId: tokenRecord.id
			},
			process.env.JWT_SECRET,
			{ expiresIn: '30d' }
		);
		
		res.json({ token: newJwtToken });
	} catch (error) {
		console.error('Refresh token error:', error);
		res.status(500).json({ error: '令牌刷新失败' });
	}
});

// 撤销单个令牌
router.delete('/tokens/:tokenId', [
	authenticateToken,
	param('tokenId').isUUID(),
	validateRequest
], async (req, res) => {
	try {
		const { tokenId } = req.params;
		
		const token = await Token.findOne({
			where: { id: tokenId },
			include: ['user']
		});
		
		if (!token) {
			return res.status(404).json({ error: 'TOKEN_NOT_FOUND' });
		}
		
		if (token.userId !== req.user.id && !req.user.isAdmin) {
			return res.status(403).json({ error: 'PERMISSION_DENIED' });
		}
		
		await token.update({ isRevoked: true });
		
		res.json({ message: '令牌已撤销' });
	} catch (error) {
		console.error('Revoke token error:', error);
		res.status(500).json({ error: '撤销令牌失败' });
	}
});

// 批量撤销令牌
router.post('/tokens/revoke-batch', [
	authenticateToken,
	body('tokenIds').isArray().optional(),
	body('tokenIds.*').isUUID(),
	body('username').isString().optional(),
	body('userId').isUUID().optional(),
	validateRequest
], async (req, res) => {
	try {
		const { tokenIds, username, userId } = req.body;
		
		if (!tokenIds && !username && !userId) {
			return res.status(400).json({ error: '必须提供tokenIds、username或userId中的至少一个参数' });
		}
		
		let where = { isRevoked: false };
		
		if (tokenIds) {
			where.id = { [Op.in]: tokenIds };
		}
		
		if (username || userId) {
			const userWhere = {};
			if (username) userWhere.username = username;
			if (userId) userWhere.id = userId;
			
			const users = await User.findAll({ where: userWhere });
			const userIds = users.map(user => user.id);
			
			if (userIds.length === 0) {
				return res.status(404).json({ error: 'USER_NOT_FOUND' });
			}
			
			where.userId = { [Op.in]: userIds };
		}
		
		if (!req.user.isAdmin) {
			where.userId = req.user.id;
		}
		
		const [updatedCount] = await Token.update(
			{ isRevoked: true },
			{ where }
		);
		
		res.json({
			message: '令牌已批量撤销',
			revokedCount: updatedCount
		});
	} catch (error) {
		console.error('Batch revoke tokens error:', error);
		res.status(500).json({ error: '批量撤销令牌失败' });
	}
});

router.post('/tokens/revoke-all', async (req, res) => {
	try {
		const [rowsUpdated] = await Token.update(
			{ isRevoked: true },
			{ where: { isRevoked: false } } // 仅更新未撤销的 Token
		);
		
		res.json({
			message: '所有 Token 已被撤销',
			revokedCount: rowsUpdated
		});
	} catch (error) {
		console.error('Revoke all tokens error:', error);
		res.status(500).json({ error: '一键撤销 Token 失败' });
	}
});

module.exports = router;
