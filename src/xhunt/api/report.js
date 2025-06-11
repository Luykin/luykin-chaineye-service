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
		
		// 如果有 errors 数组，遍历处理
		if (Array.isArray(reportData.errors)) {
			for (const error of reportData.errors) {
				const errorTags = [
					...baseTags,
					`error_type:${error.errorType || 'unknown'}`,
					`priority:${error.priority || 'unknown'}`,
					`source:${error.source || 'unknown'}`
				];
				
				// 发送错误计数到 DataDog
				const count = Number(error.count) || 1;
				req.dataDog.increment('frontend.errors.total', count, errorTags);
				
				// 发送错误详情事件（如果有消息）
				if (error.message) {
					req.dataDog.event(
						'Frontend Error',
						String(error.message).substring(0, 500), // 限制长度
						{
							alert_type: error.priority === 'critical' ? 'error' : 
							           error.priority === 'high' ? 'warning' : 'info',
							tags: errorTags,
							source_type_name: 'frontend',
							date_happened: error.timestamp ? Math.floor(Number(error.timestamp) / 1000) : undefined,
							text: JSON.stringify({
								stack: error.stack,
								url: error.url,
								userAgent: error.userAgent,
								filename: error.filename,
								lineno: error.lineno,
								colno: error.colno
							}).substring(0, 4000) // 限制长度
						}
					);
				}
			}
			
			// 发送报告级别的统计
			req.dataDog.increment('frontend.error_reports.total', 1, [
				...baseTags,
				`error_count:${reportData.errors.length}`
			]);
		} else {
			// 如果没有 errors 数组，直接统计整个报告
			req.dataDog.increment('frontend.error_reports.total', 1, baseTags);
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
		
		// 如果有 requests 数组，遍历处理
		if (Array.isArray(reportData.requests)) {
			for (const request of reportData.requests) {
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
				
				const requestTags = [
					...baseTags,
					`method:${request.method || 'unknown'}`,
					`path:${path}`,
					`status:${request.status || 'unknown'}`,
					`success:${Boolean(request.success)}`
				];
				
				// 发送请求延迟统计
				const duration = Number(request.duration);
				if (!isNaN(duration) && duration >= 0) {
					req.dataDog.histogram('frontend.request.duration', duration, requestTags);
				}
				
				// 发送请求计数
				req.dataDog.increment('frontend.requests.total', 1, requestTags);
				
				// 如果请求失败，单独统计
				if (!request.success) {
					req.dataDog.increment('frontend.requests.failed', 1, requestTags);
				}
				
				// 如果有重试次数
				const retryCount = Number(request.retryCount);
				if (!isNaN(retryCount) && retryCount > 0) {
					req.dataDog.increment('frontend.requests.retries', retryCount, requestTags);
				}
			}
			
			// 发送批量报告统计
			req.dataDog.increment('frontend.delay_reports.total', 1, [
				...baseTags,
				`request_count:${reportData.requests.length}`
			]);
		} else {
			// 如果没有 requests 数组，直接统计整个报告
			req.dataDog.increment('frontend.delay_reports.total', 1, baseTags);
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