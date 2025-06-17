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
 * POST /high-delay
 * 前端高延迟请求上报接口
 * 接收前端高延迟请求信息（6秒以上）并转发给 DataDog
 */
router.post('/high-delay', [
	securityMiddleware,
	// 只做最基本的校验
	body('records').optional().isArray(),
	body('timestamp').optional(),
	body('sessionId').optional(),
	body('reportType').optional(),
	validateRequest
], async (req, res) => {
	try {
		const reportData = req.body;
		const version = req?.securityContext?.version || 'unknown';
		const fingerprint = req?.securityContext?.fingerprint || 'unknown';
		
		// 基础标签
		const baseTags = [
			`version:${version}`,
			`fingerprint:${fingerprint.slice(0, 8)}`
		];
		
		// 处理高延迟记录
		if (Array.isArray(reportData.records) && reportData.records.length > 0) {
			// 合并所有高延迟请求信息
			const delayMessages = reportData.records.map((record, index) => {
				const parts = [];
				
				// 基础请求信息
				if (record.url) parts.push(`URL: ${record.url}`);
				if (record.method) parts.push(`Method: ${record.method}`);
				if (record.duration) parts.push(`Duration: ${record.duration}ms`);
				if (record.success !== undefined) parts.push(`Success: ${record.success}`);
				if (record.statusCode) parts.push(`Status: ${record.statusCode}`);
				if (record.errorMessage) parts.push(`Error: ${record.errorMessage}`);
				
				// 用户信息
				if (record.userId) parts.push(`User: ${record.userId}`);
				if (record.currentUrl) parts.push(`CurrentPage: ${record.currentUrl}`);
				
				// 网络信息
				if (record.networkBefore) {
					const netBefore = record.networkBefore;
					parts.push(`NetworkBefore: ${netBefore.effectiveType || 'unknown'} (${netBefore.downlink || 'unknown'}Mbps)`);
				}
				if (record.networkAfter) {
					const netAfter = record.networkAfter;
					parts.push(`NetworkAfter: ${netAfter.effectiveType || 'unknown'} (${netAfter.downlink || 'unknown'}Mbps)`);
				}
				
				// 设备信息
				if (record.deviceInfo) {
					const device = record.deviceInfo;
					parts.push(`Device: ${device.platform || 'unknown'} ${device.userAgent ? device.userAgent.slice(0, 50) : ''}`);
				}
				
				return `[HighDelay ${index + 1}] ${parts.join(' | ')}`;
			}).join('\n');
			
			// 限制总长度
			const maxLength = 4000;
			const finalMessage = delayMessages.length > maxLength
				? delayMessages.substring(0, maxLength - 20) + '...[truncated]'
				: delayMessages;
			
			// 统计延迟分布
			const avgDuration = reportData.records.reduce((sum, r) => sum + (Number(r.duration) || 0), 0) / reportData.records.length;
			const maxDuration = Math.max(...reportData.records.map(r => Number(r.duration) || 0));
			const failedCount = reportData.records.filter(r => !r.success).length;
			const successRate = ((reportData.records.length - failedCount) / reportData.records.length * 100).toFixed(1);
			
			// 提取 API 路径进行分类
			const apiPaths = reportData.records.map(r => {
				try {
					const url = new URL(r.url);
					return url.pathname.split('/').slice(0, 4).join('/'); // 取前4段路径
				} catch {
					return 'unknown';
				}
			});
			const uniquePaths = [...new Set(apiPaths)];
			
			const delayTags = [
				...baseTags,
				`avg_duration:${Math.round(avgDuration)}ms`,
				`max_duration:${maxDuration}ms`,
				`success_rate:${successRate}%`,
				`total_requests:${reportData.records.length}`,
				`api_paths:${uniquePaths.slice(0, 3).join(',')}`
			];
			
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