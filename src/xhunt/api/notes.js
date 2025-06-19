const express = require('express');
const { body, param } = require('express-validator');
const { validateRequest } = require('../middleware/validate-request');
const { authenticateToken } = require('../middleware/auth');
const { XPrivateNote, XAccount, XReviewForAccount } = require('../../models/postgres-start');
const { sanitizeNote } = require('../services/inputValidator');

const router = express.Router();

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
		
		// Step 4: 异步清空 reviews 表中的 note 字段（用于逐步迁移）
		setImmediate(async () => {
			try {
				await XReviewForAccount.update(
					{ note: '' }, // 清空 note 字段
					{
						where: {
							xHuntUserId: req.user.id,
							xAccountId: xAccount.id
						}
					}
				);
				console.log(`已清空用户 ${req.user.id} 对账号 ${handle} 在 reviews 表中的 note 字段`);
			} catch (error) {
				console.error('清空 reviews 表中的 note 字段失败:', error);
			}
		});
		
		res.status(200).json({
			status: 'success',
			message: '备注保存成功'
		});
		
	} catch (error) {
		console.error('Error saving private note:', error);
		res.status(500).json({ error: '保存备注失败' });
	}
});

// /**
//  * DELETE /notes
//  * 删除当前用户对指定账号的私人备注
//  */
// router.delete('/', [
// 	authenticateToken,
// 	body('handle').trim().notEmpty().withMessage('账号handle不能为空'),
// 	validateRequest
// ], async (req, res) => {
// 	try {
// 		const { handle } = req.body;
//
// 		// Step 1: 查找目标账号
// 		const xAccount = await XAccount.findOne({
// 			where: { handle },
// 			attributes: ['id']
// 		});
//
// 		if (!xAccount) {
// 			return res.status(404).json({ error: '账号不存在' });
// 		}
//
// 		// Step 2: 查找并删除私人备注（只删除当前用户的）
// 		const deleteResult = await XPrivateNote.destroy({
// 			where: {
// 				xHuntUserId: req.user.id, // 确保只删除当前用户的备注
// 				xAccountId: xAccount.id
// 			}
// 		});
//
// 		if (deleteResult === 0) {
// 			return res.status(404).json({ error: '备注不存在' });
// 		}
//
// 		res.status(200).json({
// 			status: 'success',
// 			message: '备注删除成功'
// 		});
//
// 	} catch (error) {
// 		console.error('Error deleting private note:', error);
// 		res.status(500).json({ error: '删除备注失败' });
// 	}
// });

module.exports = router;