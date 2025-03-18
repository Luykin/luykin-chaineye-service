const express = require('express');
const router = express.Router();
const { NewsStatistics } = require('../models/sqlite-start');

router.get('/status', async (req, res) => {
	try {
		// 查询最近的 6 条数据，按 timestamp 字段降序排列
		const recentRecords = await NewsStatistics.findAll({
			order: [['updatedAt', 'DESC']], // 按 timestamp 字段降序排序
			limit: 6, // 限制返回 6 条记录
		});
		
		// 返回查询结果
		res.status(200).json({
			success: true,
			data: recentRecords,
		});
	} catch (error) {
		// 捕获并处理错误
		console.error('Error fetching recent records:', error);
		res.status(500).json({
			success: false,
			message: 'An error occurred while fetching the data.',
			error: error.message,
		});
	}
});

module.exports = router;
