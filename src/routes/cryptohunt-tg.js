const express = require('express');
const { TGUser } = require('../models/postgres-start');
const router = express.Router();

// POST /create-invite 已停用，不再暴露创建 TG 邀请链接能力。
// 如需恢复，必须先补充真实链上支付校验、幂等与鉴权。

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
