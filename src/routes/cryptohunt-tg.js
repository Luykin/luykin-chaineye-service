const express = require('express');
const { validateRequestParams } = require('./util');
const { TGUser } = require('../models/postgres-start');
const router = express.Router();

router.post('/create-invite', validateRequestParams, async (req, res) => {
	let redisListener;
	
	try {
		const { decryptedData } = req;
		
		// 创建唯一的响应通道
		const uniqueResponseChannel = `bot-commands-response-${Date.now()}-${Math.random()}`;
		console.log(`[CREATE_INVITE] 创建响应通道: ${uniqueResponseChannel}`);
		
		// 初始化响应监听客户端
		redisListener = req.redisClient.duplicate();
		await redisListener.connect();
		
		// 设定超时时间（例如 20 秒）
		const timeout = 20 * 1000;
		const responsePromise = new Promise((resolve, reject) => {
			// 监听唯一的响应通道
			redisListener.subscribe(uniqueResponseChannel, (message) => {
				const response = JSON.parse(message);
				resolve(response);
			});
			
			setTimeout(() => {
				reject(new Error('Timed out waiting for bot response'));
			}, timeout);
		});
		
		// 向任务通道发布任务
		const command = {
			action: 'createInviteLink',
			params: decryptedData,
			responseChannel: uniqueResponseChannel,
		};
		await req.redisClient.publish('bot-commands', JSON.stringify(command));
		console.log(`[CREATE_INVITE] 已向 Redis 发布任务: ${JSON.stringify(command)}`);
		
		// 等待响应
		const result = await responsePromise;
		
		// 检查结果并返回
		if (result?.inviteLink) {
			res.json(result);
		} else {
			res.status(400).json({ error: 'Failed to create invite link.' });
		}
	} catch (err) {
		console.error('[CREATE_INVITE] 错误:', err);
		res.status(500).json({ error: 'Failed to create invite link.' });
	} finally {
		if (redisListener) {
			try {
				await redisListener.unsubscribe();
				await redisListener.disconnect();
			} catch (err) {
				console.error('[CREATE_INVITE] 清理 Redis 监听器失败:', err);
			}
		}
	}
});

/**
 * GET /user
 * 查询用户信息，通过 address 或 paymentHash 查询单条数据
 * @query address - 用户的地址 (可选)
 * @query paymentHash - 支付哈希值 (可选)
 */
router.get('/user', async (req, res) => {
	try {
		const { address, paymentHash } = req.query;
		
		if (!address && !paymentHash) {
			return res.status(400).json({
				error: 'Address or paymentHash must be provided as a query criterion.',
			});
		}
		
		// 构造查询条件
		const whereClause = {};
		if (address) {
			whereClause.address = address;
		}
		if (paymentHash) {
			whereClause.paymentHash = paymentHash;
		}
		
		// 查询数据库
		const user = await TGUser.findOne({
			where: whereClause,
			attributes: {
				exclude: ['inviteLink', 'expireTime', 'myId', 'otherInfo', 'removedTime'], // 排除指定字段
			},
		});
		
		if (!user) {
			return res.status(404).json({
				error: '404',
			});
		}
		
		// 返回用户数据
		return res.status(200).json(user);
	} catch (error) {
		console.error('查询用户时发生错误:', error);
		return res.status(500).json({
			error: error,
		});
	}
});

module.exports = router;
