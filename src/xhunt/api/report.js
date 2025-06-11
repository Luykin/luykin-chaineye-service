const express = require('express');
const { body } = require('express-validator');
const { validateRequest } = require('../middleware/validate-request');
const { securityMiddleware } = require('../middleware/security');

const router = express.Router();

/**
 * POST /errors
 * 前端错误上报接口
 * 接收前端错误信息并转发给 DataDog
 */
router.post('/errors', [
	securityMiddleware,
	body('id').optional().isString().trim(),
	body('errors').isArray({ min: 1 }).withMessage('errors 必须是非空数组'),
	body('errors.*.message').isString().trim().notEmpty().withMessage('错误消息不能为空'),
	body('errors.*.stack').optional().isString().trim(),
	body('errors.*.source').optional().isString().trim(),
	body('errors.*.lineno').optional().isInt({ min: 0 }),
	body('errors.*.colno').optional().isInt({ min: 0 }),
	body('errors.*.filename').optional().isString().trim(),
	body('errors.*.timestamp').isInt({ min: 0 }).withMessage('时间戳必须是有效数字'),
	body('errors.*.userAgent').isString().trim().notEmpty(),
	body('errors.*.url').isString().trim().notEmpty(),
	body('errors.*.userId').optional().isString().trim(),
	body('errors.*.errorType').isIn(['javascript', 'promise', 'react', 'network', 'custom', 'async']),
	body('errors.*.componentStack').optional().isString().trim(),
	body('errors.*.errorBoundary').optional().isString().trim(),
	body('errors.*.priority').isIn(['low', 'medium', 'high', 'critical']),
	body('errors.*.count').isInt({ min: 1 }).withMessage('count 必须是正整数'),
	body('timestamp').isInt({ min: 0 }).withMessage('报告时间戳必须是有效数字'),
	body('userAgent').isString().trim().notEmpty(),
	body('url').isString().trim().notEmpty(),
	body('sessionId').isString().trim().notEmpty(),
	validateRequest
], async (req, res) => {
	try {
		const { errors, timestamp, userAgent, url, sessionId } = req.body;
		const version = req?.securityContext?.version || 'unknown';
		
		// 遍历每个错误并发送到 DataDog
		for (const error of errors) {
			const tags = [
				`error_type:${error.errorType}`,
				`priority:${error.priority}`,
				`version:${version}`,
				`user_id:${error.userId || 'anonymous'}`,
				`session_id:${sessionId}`,
				`source:${error.source || 'unknown'}`,
				`filename:${error.filename || 'unknown'}`,
				`component:${error.errorBoundary || 'unknown'}`
			];
			
			// 发送错误计数到 DataDog
			req.dataDog.increment('frontend.errors.total', error.count, tags);
			
			// 发送错误详情到 DataDog（作为事件）
			req.dataDog.event(
				'Frontend Error',
				error.message,
				{
					alert_type: error.priority === 'critical' ? 'error' : 
					           error.priority === 'high' ? 'warning' : 'info',
					tags: tags,
					source_type_name: 'frontend',
					aggregation_key: `${error.errorType}_${error.source}_${error.lineno}_${error.colno}`,
					date_happened: Math.floor(error.timestamp / 1000), // DataDog 需要秒级时间戳
					text: JSON.stringify({
						stack: error.stack,
						url: error.url,
						userAgent: error.userAgent,
						componentStack: error.componentStack,
						lineno: error.lineno,
						colno: error.colno
					})
				}
			);
		}
		
		// 发送报告级别的统计
		req.dataDog.increment('frontend.error_reports.total', 1, [
			`version:${version}`,
			`session_id:${sessionId}`,
			`error_count:${errors.length}`
		]);
		
		res.status(200).json({ 
			status: 'success',
			message: '错误报告已接收'
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
 */
router.post('/request-delay', [
	securityMiddleware,
	body('requests').isArray({ min: 1 }).withMessage('requests 必须是非空数组'),
	body('requests.*.url').isString().trim().notEmpty().withMessage('请求URL不能为空'),
	body('requests.*.method').isIn(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']).withMessage('无效的HTTP方法'),
	body('requests.*.duration').isFloat({ min: 0 }).withMessage('请求耗时必须是非负数'),
	body('requests.*.status').optional().isInt({ min: 100, max: 599 }).withMessage('HTTP状态码必须在100-599之间'),
	body('requests.*.timestamp').isInt({ min: 0 }).withMessage('时间戳必须是有效数字'),
	body('requests.*.success').isBoolean().withMessage('success 必须是布尔值'),
	body('requests.*.errorType').optional().isString().trim(),
	body('requests.*.retryCount').optional().isInt({ min: 0 }),
	body('requests.*.cacheHit').optional().isBoolean(),
	body('sessionId').isString().trim().notEmpty(),
	body('userAgent').isString().trim().notEmpty(),
	body('timestamp').isInt({ min: 0 }).withMessage('报告时间戳必须是有效数字'),
	validateRequest
], async (req, res) => {
	try {
		const { requests, sessionId, userAgent, timestamp } = req.body;
		const version = req?.securityContext?.version || 'unknown';
		
		// 遍历每个请求统计并发送到 DataDog
		for (const request of requests) {
			// 提取路径（去除查询参数和域名）
			let path = 'unknown';
			try {
				const urlObj = new URL(request.url);
				path = urlObj.pathname;
			} catch (e) {
				// 如果不是完整URL，直接使用
				path = request.url.split('?')[0];
			}
			
			const tags = [
				`method:${request.method}`,
				`path:${path}`,
				`status:${request.status || 'unknown'}`,
				`success:${request.success}`,
				`version:${version}`,
				`session_id:${sessionId}`,
				`cache_hit:${request.cacheHit || false}`,
				`retry_count:${request.retryCount || 0}`
			];
			
			// 如果有错误类型，添加到标签
			if (request.errorType) {
				tags.push(`error_type:${request.errorType}`);
			}
			
			// 发送请求延迟统计到 DataDog
			req.dataDog.histogram('frontend.request.duration', request.duration, tags);
			
			// 发送请求计数
			req.dataDog.increment('frontend.requests.total', 1, tags);
			
			// 如果请求失败，单独统计失败次数
			if (!request.success) {
				req.dataDog.increment('frontend.requests.failed', 1, tags);
			}
			
			// 如果有重试，统计重试次数
			if (request.retryCount && request.retryCount > 0) {
				req.dataDog.increment('frontend.requests.retries', request.retryCount, tags);
			}
		}
		
		// 发送批量报告统计
		req.dataDog.increment('frontend.delay_reports.total', 1, [
			`version:${version}`,
			`session_id:${sessionId}`,
			`request_count:${requests.length}`
		]);
		
		res.status(200).json({ 
			status: 'success',
			message: '延迟统计已接收'
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