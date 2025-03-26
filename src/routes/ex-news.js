const express = require('express');
const router = express.Router();
const { Op } = require('sequelize'); // Sequelize 操作符
const { NewsStatistics } = require('../models/sqlite-start');

// 定义 GET /status 路由
router.get('/status', async (req, res) => {
	try {
		// 获取请求参数
		const { limit = 10, key, ip, offset = 0 } = req.query;

		// 校验 limit 参数
		const parsedLimit = parseInt(limit, 10);
		if (isNaN(parsedLimit) || parsedLimit <= 0 || parsedLimit > 50) {
			return res.status(400).json({
				success: false,
				message: 'Invalid limit. Limit must be a number between 1 and 50.',
			});
		}

		// 校验 offset 参数（用于分页）
		const parsedOffset = parseInt(offset, 10);
		if (isNaN(parsedOffset) || parsedOffset < 0) {
			return res.status(400).json({
				success: false,
				message: 'Invalid offset. Offset must be a non-negative integer.',
			});
		}

		// 构建查询条件
		const whereClause = {};
		if (key) {
			// 支持 key 的模糊查询，同时清理特殊字符
			whereClause.key = { [Op.like]: `%${sanitizeInput(key)}%` };
		}
		if (ip) {
			// 支持 ip 的模糊查询，同时清理特殊字符
			whereClause.ip = { [Op.like]: `%${sanitizeInput(ip)}%` };
		}

		// 查询数据
		const recentRecords = await NewsStatistics.findAndCountAll({
			where: whereClause, // 应用筛选条件
			order: [['updatedAt', 'DESC']], // 按更新时间降序排序
			limit: parsedLimit, // 动态限制返回记录数
			offset: parsedOffset, // 分页偏移量
		});

		// 对查询结果进行去重处理
		const uniqueRecords = removeDuplicatesByKey(recentRecords.rows, 'key');

		// 返回查询结果
		res.status(200).json({
			success: true,
			total: uniqueRecords.length, // 去重后的记录数
			data: uniqueRecords, // 去重后的数据
		});
	} catch (error) {
		// 捕获并处理错误
		console.error('Error fetching records:', error);
		res.status(500).json({
			success: false,
			message: 'An error occurred while fetching the data.',
			error: error.message,
		});
	}
});

/**
 * 输入清理函数，防止 SQL 注入或其他恶意输入
 * @param {string} input - 用户输入
 * @returns {string} - 清理后的输入
 */
function sanitizeInput(input) {
	if (typeof input !== 'string') return '';
	return input.replace(/[^a-zA-Z0-9._%-]/g, ''); // 仅允许字母、数字、点、下划线、百分号和连字符
}

/**
 * 根据指定的键值对数组对象进行去重
 * @param {Array} array - 数据数组
 * @param {string} key - 去重依据的键
 * @returns {Array} - 去重后的数组
 */
function removeDuplicatesByKey(array, key) {
	const seen = new Set();
	return array.filter(item => {
		const value = item[key];
		if (seen.has(value)) {
			return false; // 如果已经存在，则过滤掉
		}
		seen.add(value); // 记录当前值
		return true;
	});
}

module.exports = router;