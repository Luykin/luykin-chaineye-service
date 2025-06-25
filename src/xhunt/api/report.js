const express = require('express');
const { body } = require('express-validator');
const { validateRequest } = require('../middleware/validate-request');
const { securityMiddleware } = require('../middleware/security');

const router = express.Router();

/**
 * POST /errors
 * 前端错误上报接口
 * 接收前端错误信息并转发给 DataDog
 * 校验宽松，前端传什么就上报什么
 */
router.post('/errors', [
	securityMiddleware,
	// 只做最基本的校验
	body('errors').optional().isArray(),
	body('timestamp').optional(),
	body('userAgent').optional(),
	body('url').optional(),
	body('sessionId').optional(),
	validateRequest
], async (req, res) => {
	try {
		const reportData = req.body;
		const version = req?.securityContext?.version || 'unknown';
		const fingerprint = req?.securityContext?.fingerprint || 'unknown';
		
		// 基础标签
		const baseTags = [
			`version:${version}`,
			`fingerprint:${fingerprint.slice(0, 8)}` // 只取前8位
		];
		
		// 如果有 errors 数组，合并所有错误信息
		if (Array.isArray(reportData.errors) && reportData.errors.length > 0) {
			// 合并所有错误信息为一个大的message
			const errorMessages = reportData.errors.map((error, index) => {
				const parts = [];
				if (error.message) parts.push(`Message: ${error.message}`);
				if (error.errorType) parts.push(`Type: ${error.errorType}`);
				if (error.source) parts.push(`Source: ${error.source}`);
				if (error.filename) parts.push(`File: ${error.filename}`);
				if (error.lineno) parts.push(`Line: ${error.lineno}`);
				if (error.count && error.count > 1) parts.push(`Count: ${error.count}`);
				
				return `[Error ${index + 1}] ${parts.join(' | ')}`;
			}).join('\n');
			
			// 限制总长度，避免超出DataDog限制
			const maxLength = 4000;
			const finalMessage = errorMessages.length > maxLength
				? errorMessages.substring(0, maxLength - 20) + '...[truncated]'
				: errorMessages;
			
			// 统计错误类型分布
			const errorTypes = reportData.errors.map(e => e.errorType || 'unknown');
			const priorityLevels = reportData.errors.map(e => e.priority || 'unknown');
			const totalCount = reportData.errors.reduce((sum, e) => sum + (Number(e.count) || 1), 0);
			
			const errorTags = [
				...baseTags,
				`error_types:${[...new Set(errorTypes)].join(',')}`,
				`priorities:${[...new Set(priorityLevels)].join(',')}`,
				`total_errors:${reportData.errors.length}`,
				`total_count:${totalCount}`
			];
			
			// 发送单次错误详情事件
			req.dataDog.event(
				'Frontend Error Batch',
				finalMessage,
				{
					alert_type: priorityLevels.includes('critical') ? 'error' :
					           priorityLevels.includes('high') ? 'warning' : 'info',
					tags: errorTags,
					source_type_name: 'frontend',
					date_happened: reportData.timestamp ? Math.floor(Number(reportData.timestamp) / 1000) : undefined
				}
			);
		}
		
		res.status(200).json({
			status: 'success'
		});
		
	} catch (error) {
		console.error('Error reporting failed:', error);
		res.status(500).json({
			status: 'error',
			message: '错误报告处理失败'
		});
	}
});

/**
 * POST /request-delay
 * 前端请求延迟统计接口（已废弃，仅为兼容线上版本）
 * 直接返回成功状态，不做任何处理
 */
router.post('/request-delay', [
	securityMiddleware,
	validateRequest
], async (req, res) => {
	// 为了兼容线上版本，直接返回成功
	res.status(200).json({
		status: 'success'
	});
});

/**
 * POST /high-delay
 * 前端高延迟请求上报接口
 * 接收前端高延迟请求信息（6秒以上）并转发给 DataDog
 */
router.post('/high-delay', [
	securityMiddleware,
	// 🆕 增加数据量验证和限制
	body('records')
		.optional()
		.isArray()
		.custom((records) => {
			if (Array.isArray(records) && records.length > 50) {
				throw new Error('单次上报记录数不能超过50条');
			}
			return true;
		}),
	body('timestamp').optional(),
	body('sessionId').optional(),
	body('reportType').optional(),
	validateRequest
], async (req, res) => {
	try {
		const reportData = req.body;
		const version = req?.securityContext?.version || 'unknown';
		const fingerprint = req?.securityContext?.fingerprint || 'unknown';
		
		// 🆕 记录请求体大小用于监控
		const requestSizeKB = Math.round(JSON.stringify(req.body).length / 1024);
		if (requestSizeKB > 50) { // 超过50KB记录
			req.dataDog.histogram('high_delay_report.size', requestSizeKB, [
				`version:${version}`,
				`size_category:${requestSizeKB > 200 ? 'large' : 'medium'}`
			]);
		}
		
		// 基础标签
		const baseTags = [
			`version:${version}`,
			`fingerprint:${fingerprint.slice(0, 8)}`
		];
		
		// 处理高延迟记录
		if (Array.isArray(reportData.records) && reportData.records.length > 0) {
			// 🆕 限制处理的记录数量，防止过大数据
			const maxRecords = 20; // 最多处理20条记录
			const recordsToProcess = reportData.records.slice(0, maxRecords);
			
			// 提取 IP 信息（从第一条记录中获取，通常所有记录的 IP 都相同）
			const firstRecord = recordsToProcess[0];
			const ipInfo = firstRecord?.deviceInfo?.ipInfo;
			let ipPrefix = '';
			
			if (ipInfo?.ip) {
				const ipParts = [];
				ipParts.push(`IP: ${ipInfo.ip}`);
				if (ipInfo.country) ipParts.push(`Country: ${ipInfo.country}`);
				if (ipInfo.region) ipParts.push(`Region: ${ipInfo.region}`);
				if (ipInfo.city) ipParts.push(`City: ${ipInfo.city}`);
				if (ipInfo.isp) ipParts.push(`ISP: ${ipInfo.isp}`);
				if (ipInfo.timezone) ipParts.push(`Timezone: ${ipInfo.timezone}`);
				
				ipPrefix = `[${ipParts.join(' | ')}]\n\n`;
			}
			
			// 🆕 简化延迟记录信息，减少数据量
			const delayMessages = recordsToProcess.map((record, index) => {
				const parts = [];
				
				// 只保留核心信息
				if (record.url) {
					// 截断过长的URL
					const shortUrl = record.url.length > 100 ? 
						record.url.substring(0, 100) + '...' : record.url;
					parts.push(`URL: ${shortUrl}`);
				}
				if (record.method) parts.push(`Method: ${record.method}`);
				if (record.duration) parts.push(`Duration: ${record.duration}ms`);
				if (record.success !== undefined) parts.push(`Success: ${record.success}`);
				if (record.statusCode) parts.push(`Status: ${record.statusCode}`);
				if (record.errorMessage) {
					// 截断过长的错误信息
					const shortError = record.errorMessage.length > 200 ? 
						record.errorMessage.substring(0, 200) + '...' : record.errorMessage;
					parts.push(`Error: ${shortError}`);
				}
				
				// 简化的用户和网络信息
				if (record.userId) parts.push(`User: ${record.userId}`);
				if (record.networkBefore?.effectiveType) {
					parts.push(`Network: ${record.networkBefore.effectiveType}`);
				}
				
				return `[HighDelay ${index + 1}] ${parts.join(' | ')}`;
			}).join('\n');
			
			// 拼接 IP 信息到最前面
			const fullMessage = ipPrefix + delayMessages;
			
			// 🆕 更严格的长度限制
			const maxLength = 3000; // 减少到3000字符
			const finalMessage = fullMessage.length > maxLength
				? fullMessage.substring(0, maxLength - 20) + '...[truncated]'
				: fullMessage;
			
			// 简化的标签（只保留基础信息）
			const delayTags = [
				...baseTags,
				`total_requests:${recordsToProcess.length}`
			];
			
			// 添加 IP 相关标签
			if (ipInfo?.country) {
				delayTags.push(`country:${ipInfo.country}`);
			}
			if (ipInfo?.isp) {
				delayTags.push(`isp:${ipInfo.isp.replace(/[:=]/g, '_')}`); // 移除标签分隔符
			}
			
			// 🆕 如果原始记录数超过处理数，添加标记
			if (reportData.records.length > maxRecords) {
				delayTags.push(`truncated:true`);
				delayTags.push(`original_count:${reportData.records.length}`);
			}
			
			// 计算平均延迟用于判断严重程度
			const avgDuration = recordsToProcess.reduce((sum, r) => sum + (Number(r.duration) || 0), 0) / recordsToProcess.length;
			
			// 发送高延迟事件
			req.dataDog.event(
				'Frontend High Delay Report',
				finalMessage,
				{
					alert_type: avgDuration > 10000 ? 'error' : 'warning', // 10秒以上为错误级别
					tags: delayTags,
					source_type_name: 'frontend',
					date_happened: reportData.timestamp ? Math.floor(Number(reportData.timestamp) / 1000) : undefined
				}
			);
		}
		
		res.status(200).json({
			status: 'success'
		});
		
	} catch (error) {
		console.error('High delay reporting failed:', error);
		res.status(500).json({
			status: 'error',
			message: '高延迟报告处理失败'
		});
	}
});

/**
 * GET /health
 * 健康检查接口
 */
router.get('/health', (req, res) => {
	res.json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		service: 'xhunt-report-api'
	});
});

module.exports = router;