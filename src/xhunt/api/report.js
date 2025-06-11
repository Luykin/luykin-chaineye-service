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
			
			// 发送单次错误计数到 DataDog
			req.dataDog.increment('frontend.errors.batch', totalCount, errorTags);
			
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
		} else {
			// 如果没有 errors 数组，直接统计整个报告
			req.dataDog.increment('frontend.error_reports.empty', 1, baseTags);
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
 * 前端请求延迟统计接口
 * 接收前端接口延迟统计并转发给 DataDog
 * 校验宽松，前端传什么就上报什么
 */
router.post('/request-delay', [
	securityMiddleware,
	// 只做最基本的校验
	body('requests').optional().isArray(),
	body('sessionId').optional(),
	body('userAgent').optional(),
	body('timestamp').optional(),
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
		
		// 如果有 requests 数组，合并所有请求信息
		if (Array.isArray(reportData.requests) && reportData.requests.length > 0) {
			// 合并所有请求信息为一个大的message
			const requestMessages = reportData.requests.map((request, index) => {
				const parts = [];
				
				// 提取路径
				let path = 'unknown';
				try {
					if (request.url) {
						const urlStr = String(request.url);
						if (urlStr.startsWith('http')) {
							const urlObj = new URL(urlStr);
							path = urlObj.pathname;
						} else {
							path = urlStr.split('?')[0];
						}
					}
				} catch (e) {
					// 忽略URL解析错误
				}
				
				if (request.method) parts.push(`Method: ${request.method}`);
				parts.push(`Path: ${path}`);
				if (request.status) parts.push(`Status: ${request.status}`);
				if (request.duration !== undefined) parts.push(`Duration: ${request.duration}ms`);
				if (request.success !== undefined) parts.push(`Success: ${request.success}`);
				if (request.retryCount) parts.push(`Retries: ${request.retryCount}`);
				
				return `[Request ${index + 1}] ${parts.join(' | ')}`;
			}).join('\n');
			
			// 限制总长度
			const maxLength = 4000;
			const finalMessage = requestMessages.length > maxLength 
				? requestMessages.substring(0, maxLength - 20) + '...[truncated]'
				: requestMessages;
			
			// 统计汇总信息
			const totalRequests = reportData.requests.length;
			const successCount = reportData.requests.filter(r => r.success).length;
			const failedCount = totalRequests - successCount;
			const avgDuration = reportData.requests
				.filter(r => !isNaN(Number(r.duration)))
				.reduce((sum, r, _, arr) => sum + Number(r.duration) / arr.length, 0);
			const totalRetries = reportData.requests
				.reduce((sum, r) => sum + (Number(r.retryCount) || 0), 0);
			
			const delayTags = [
				...baseTags,
				`total_requests:${totalRequests}`,
				`success_count:${successCount}`,
				`failed_count:${failedCount}`,
				`avg_duration:${Math.round(avgDuration)}`,
				`total_retries:${totalRetries}`
			];
			
			// 发送单次批量统计
			req.dataDog.increment('frontend.requests.batch', totalRequests, delayTags);
			
			// 发送平均延迟
			if (!isNaN(avgDuration) && avgDuration > 0) {
				req.dataDog.histogram('frontend.request.avg_duration', avgDuration, delayTags);
			}
			
			// 发送失败统计
			if (failedCount > 0) {
				req.dataDog.increment('frontend.requests.batch_failed', failedCount, delayTags);
			}
			
			// 发送重试统计
			if (totalRetries > 0) {
				req.dataDog.increment('frontend.requests.batch_retries', totalRetries, delayTags);
			}
			
			// 发送详情事件
			req.dataDog.event(
				'Frontend Request Delay Batch',
				finalMessage,
				{
					alert_type: failedCount > totalRequests * 0.5 ? 'warning' : 'info',
					tags: delayTags,
					source_type_name: 'frontend',
					date_happened: reportData.timestamp ? Math.floor(Number(reportData.timestamp) / 1000) : undefined
				}
			);
		} else {
			// 如果没有 requests 数组，直接统计整个报告
			req.dataDog.increment('frontend.delay_reports.empty', 1, baseTags);
		}
		
		res.status(200).json({ 
			status: 'success'
		});
		
	} catch (error) {
		console.error('Request delay reporting failed:', error);
		res.status(500).json({ 
			status: 'error',
			message: '延迟统计处理失败'
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