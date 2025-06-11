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
 * 纯转发模式，前端传什么就上报什么
 */
router.post('/request-delay', [
	securityMiddleware,
	// 只做最基本的校验，前端传什么都接受
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
		
		// 直接转发前端计算好的数据
		// 前端可能发送的字段：avgDuration, totalRequests, maxDuration, minDuration 等
		const delayTags = [...baseTags];
		
		// 添加前端传来的统计数据作为标签
		if (reportData.avgDuration !== undefined) {
			delayTags.push(`avg_duration:${Math.round(Number(reportData.avgDuration) || 0)}`);
		}
		if (reportData.totalRequests !== undefined) {
			delayTags.push(`total_requests:${Number(reportData.totalRequests) || 0}`);
		}
		if (reportData.maxDuration !== undefined) {
			delayTags.push(`max_duration:${Math.round(Number(reportData.maxDuration) || 0)}`);
		}
		if (reportData.minDuration !== undefined) {
			delayTags.push(`min_duration:${Math.round(Number(reportData.minDuration) || 0)}`);
		}
		
		// 发送延迟统计到 DataDog
		req.dataDog.increment('frontend.delay_reports', 1, delayTags);
		
		// 如果前端提供了平均延迟，发送直方图
		if (reportData.avgDuration !== undefined && !isNaN(Number(reportData.avgDuration))) {
			req.dataDog.histogram('frontend.request.avg_duration', Number(reportData.avgDuration), delayTags);
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