const express = require('express');
const { body, param } = require('express-validator');
const { validateRequest } = require('../middleware/validate-request');
const { authenticateToken } = require('../middleware/auth');
const { XPrivateNote, XAccount } = require('../../models/postgres-start');
const { sanitizeNote } = require('../services/inputValidator');

const router = express.Router();

/**
 * @swagger
 * /notes/{handle}:
 *   get:
 *     tags:
 *       - Private Notes
 *     summary: 获取私人备注
 *     description: 获取当前用户对指定X账号的私人备注
 *     security:
 *       - BearerAuth: []
 *       - SecurityHeaders: []
 *     parameters:
 *       - name: handle
 *         in: path
 *         required: true
 *         description: X账号用户名（不含@符号）
 *         schema:
 *           type: string
 *           example: "elonmusk"
 *     responses:
 *       200:
 *         description: 成功获取私人备注
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PrivateNote'
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
 *       500:
 *         description: 服务器内部错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * GET /notes/:handle
 * 获取当前用户对特定账号的私人备注
 * 只能查询当前用户自己的备注
 */
router.get('/:handle', [
	authenticateToken,
	param('handle').trim().notEmpty().withMessage('账号handle不能为空'),
	validateRequest
], async (req, res) => {
	try {
		const { handle } = req.params;
		
		// 查找当前用户对特定账号的备注
		const privateNote = await XPrivateNote.findOne({
			where: {
				xHuntUserId: req.user.id // 只能查询当前用户的备注
			},
			include: [{
				model: XAccount,
				as: 'xAccount',
				where: { handle: handle.trim() },
				attributes: ['id', 'handle', 'displayName', 'avatar']
			}],
			attributes: ['id', 'note', 'createdAt', 'updatedAt']
		});
		
		// 如果没有找到，返回空备注
		if (!privateNote) {
			return res.json({
				handle,
				note: '',
				lastUpdated: null
			});
		}
		
		// 返回找到的备注
		res.json({
			handle,
			note: privateNote.note || '',
			lastUpdated: privateNote.updatedAt
		});
		
	} catch (error) {
		console.error('Error fetching private note by handle:', error);
		res.status(500).json({ error: '获取备注失败' });
	}
});

/**
 * @swagger
 * /notes:
 *   post:
 *     tags:
 *       - Private Notes
 *     summary: 创建或更新私人备注
 *     description: 为指定X账号创建新的私人备注或更新已有备注
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
 *               note:
 *                 type: string
 *                 maxLength: 2000
 *                 description: 私人备注内容（最多2000字符）
 *                 example: "这是我的私人备注，只有我能看到"
 *     responses:
 *       200:
 *         description: 备注保存成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "备注保存成功"
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
 *       500:
 *         description: 服务器内部错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * POST /notes
 * 新增或修改当前用户对指定账号的私人备注
 */
router.post('/', [
	authenticateToken,
	body('handle').trim().notEmpty().withMessage('账号handle不能为空'),
	body('xLink').trim().notEmpty().withMessage('账号链接不能为空'),
	body('displayName').trim().notEmpty().withMessage('显示名称不能为空'),
	body('avatar').trim().notEmpty().withMessage('头像不能为空'),
	body('note')
		.optional()
		.isString()
		.trim()
		.customSanitizer(sanitizeNote)
		.custom((note) => {
			if (note && note.length > 2000) {
				throw new Error('备注内容不能超过 2000 字符');
			}
			return true;
		}),
	validateRequest
], async (req, res) => {
	try {
		const { handle, xLink, displayName, avatar, followers, following, note } = req.body;
		
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
		
		// Step 2: 查找是否已存在私人备注（只查询当前用户的）
		const existingNote = await XPrivateNote.findOne({
			where: {
				xHuntUserId: req.user.id, // 确保只操作当前用户的备注
				xAccountId: xAccount.id
			}
		});
		
		if (existingNote) {
			// Step 3a: 更新已有备注
			await existingNote.update({
				note: sanitizeNote(note || '')
			});
		} else {
			// Step 3b: 创建新备注
			await XPrivateNote.create({
				xHuntUserId: req.user.id, // 确保只为当前用户创建备注
				xAccountId: xAccount.id,
				note: sanitizeNote(note || '')
			});
		}
		
		res.status(200).json({ 
			status: 'success',
			message: '备注保存成功'
		});
		
	} catch (error) {
		console.error('Error saving private note:', error);
		res.status(500).json({ error: '保存备注失败' });
	}
});

/**
 * @swagger
 * /notes:
 *   delete:
 *     tags:
 *       - Private Notes
 *     summary: 删除私人备注
 *     description: 删除当前用户对指定X账号的私人备注
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
 *         description: 备注删除成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "备注删除成功"
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
 *         description: 备注不存在
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
/**
 * DELETE /notes
 * 删除当前用户对指定账号的私人备注
 */
router.delete('/', [
	authenticateToken,
	body('handle').trim().notEmpty().withMessage('账号handle不能为空'),
	validateRequest
], async (req, res) => {
	try {
		const { handle } = req.body;
		
		// Step 1: 查找目标账号
		const xAccount = await XAccount.findOne({
			where: { handle },
			attributes: ['id']
		});
		
		if (!xAccount) {
			return res.status(404).json({ error: '账号不存在' });
		}
		
		// Step 2: 查找并删除私人备注（只删除当前用户的）
		const deleteResult = await XPrivateNote.destroy({
			where: {
				xHuntUserId: req.user.id, // 确保只删除当前用户的备注
				xAccountId: xAccount.id
			}
		});
		
		if (deleteResult === 0) {
			return res.status(404).json({ error: '备注不存在' });
		}
		
		res.status(200).json({ 
			status: 'success',
			message: '备注删除成功'
		});
		
	} catch (error) {
		console.error('Error deleting private note:', error);
		res.status(500).json({ error: '删除备注失败' });
	}
});

module.exports = router;