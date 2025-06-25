const express = require('express');
const { body } = require('express-validator');
const { validateRequest } = require('../middleware/validate-request');
const { securityMiddleware } = require('../middleware/security');

const router = express.Router();

/**
 * 检测用户是否使用代理
 * @param {Object} req - 请求对象
 * @param {Object} ipInfo - IP信息对象
 * @returns {Object} - 代理检测结果
 */
function detectProxy(req, ipInfo) {
	const proxyIndicators = [];
	let proxyScore = 0;
	
	// 1. 检查代理相关的请求头
	const proxyHeaders = [
		'x-forwarded-for',
		'x-real-ip',
		'x-forwarded-proto',
		'x-forwarded-host',
		'x-forwarded-port',
		'x-original-forwarded-for',
		'x-cluster-client-ip',
		'cf-connecting-ip', // Cloudflare
		'true-client-ip',
		'x-client-ip',
		'forwarded',
		'via'
	];
	
	const foundProxyHeaders = proxyHeaders.filter(header => req.headers[header]);
	if (foundProxyHeaders.length > 0) {
		proxyIndicators.push(`Headers: ${foundProxyHeaders.join(', ')}`);
		proxyScore += foundProxyHeaders.length * 10;
	}
	
	// 2. 检查 X-Forwarded-For 是否包含多个IP
	const xForwardedFor = req.headers['x-forwarded-for'];
	if (xForwardedFor && xForwardedFor.includes(',')) {
		const ips = xForwardedFor.split(',').map(ip => ip.trim());
		proxyIndicators.push(`XFF Chain: ${ips.length} IPs`);
		proxyScore += ips.length * 5;
	}
	
	// 3. 检查 Via 头（代理服务器标识）
	const viaHeader = req.headers['via'];
	if (viaHeader) {
		proxyIndicators.push(`Via: ${viaHeader.substring(0, 50)}`);
		proxyScore += 20;
	}
	
	// 4. 检查 User-Agent 是否包含代理特征
	const userAgent = req.headers['user-agent'] || '';
	const proxyUAPatterns = [
		/proxy/i,
		/squid/i,
		/nginx/i,
		/apache/i,
		/cloudflare/i,
		/fastly/i,
		/varnish/i
	];
	
	const foundUAPatterns = proxyUAPatterns.filter(pattern => pattern.test(userAgent));
	if (foundUAPatterns.length > 0) {
		proxyIndicators.push('UA: Proxy signatures');
		proxyScore += 15;
	}
	
	// 5. 检查IP信息中的ISP是否为已知代理服务商
	if (ipInfo?.isp) {
		const proxyISPs = [
			/cloudflare/i,
			/fastly/i,
			/amazon/i,
			/google/i,
			/microsoft/i,
			/digitalocean/i,
			/linode/i,
			/vultr/i,
			/ovh/i,
			/hetzner/i,
			/proxy/i,
			/vpn/i,
			/hosting/i,
			/datacenter/i,
			/server/i,
			/cloud/i
		];
		
		const foundISPPatterns = proxyISPs.filter(pattern => pattern.test(ipInfo.isp));
		if (foundISPPatterns.length > 0) {
			proxyIndicators.push(`ISP: ${ipInfo.isp}`);
			proxyScore += 25;
		}
	}
	
	// 6. 检查IP地址类型（私有IP、本地IP等）
	const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
	                 req.headers['x-real-ip'] ||
	                 req.connection.remoteAddress ||
	                 req.socket.remoteAddress ||
	                 req.ip ||
	                 'unknown';
	
	// 检查是否为私有IP或本地IP
	const privateIPPatterns = [
		/^10\./,
		/^172\.(1[6-9]|2[0-9]|3[0-1])\./,
		/^192\.168\./,
		/^127\./,
		/^::1$/,
		/^fc00:/,
		/^fe80:/
	];
	
	if (privateIPPatterns.some(pattern => pattern.test(clientIP))) {
		proxyIndicators.push(`Private IP: ${clientIP}`);
		proxyScore += 30;
	}
	
	// 7. 检查端口信息
	const forwardedPort = req.headers['x-forwarded-port'];
	if (forwardedPort && forwardedPort !== '80' && forwardedPort !== '443') {
		proxyIndicators.push(`Port: ${forwardedPort}`);
		proxyScore += 10;
	}
	
	// 判断代理可能性
	let proxyLikelihood = 'No';
	if (proxyScore >= 50) {
		proxyLikelihood = 'High';
	} else if (proxyScore >= 25) {
		proxyLikelihood = 'Medium';
	} else if (proxyScore >= 10) {
		proxyLikelihood = 'Low';
	}
	
	return {
		isProxy: proxyScore >= 10,
		likelihood: proxyLikelihood,
		score: proxyScore,
		indicators: proxyIndicators,
		clientIP
	};
}

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
 * 检查是否为重复上报
 * @param {Object} req - 请求对象
 * @param {string} clientIP - 客户端IP
 * @returns {Promise<boolean>} - 是否为重复上报
 */
async function isDuplicateReport(req, clientIP) {
	try {
		const cacheKey = `high_delay_report:${clientIP}`;
		const lastReportTime = await req.redisClient.get(cacheKey);
		
		if (lastReportTime) {
			const timeDiff = Date.now() - parseInt(lastReportTime, 10);
			const tenMinutes = 10 * 60 * 1000; // 10分钟
			
			if (timeDiff < tenMinutes) {
				// 记录重复上报统计
				if (req.dataDog) {
					req.dataDog.increment('high_delay_report.duplicate', 1, [
						`ip:${clientIP}`,
						`time_since_last:${Math.round(timeDiff / 1000)}s`
					]);
				}
				return true;
			}
		}
		
		// 设置新的上报时间（10分钟过期）
		await req.redisClient.setEx(cacheKey, 10 * 60, Date.now().toString());
		return false;
	} catch (redisError) {
		console.error('Redis error in duplicate check:', redisError);
		// Redis 出错时不阻止上报，但记录错误
		if (req.dataDog) {
			req.dataDog.increment('high_delay_report.redis_error', 1, [
				`error:${redisError.message.substring(0, 50)}`
			]);
		}
		return false;
	}
}

/**
 * POST /high-delay
 * 前端高延迟请求上报接口
 * 接收前端高延迟请求信息（6秒以上）并转发给 DataDog
 * 🆕 添加重复上报防护：同一IP 10分钟内只能上报一次
 * 🆕 添加代理检测功能
 */
router.post('/high-delay', [
	securityMiddleware,
	// 🆕 增加数据量验证和限制
	body('records')
		.optional()
		.isArray()
		.custom((records) => {
			if (Array.isArray(records) && records.length > 10) {
				throw new Error('单次上报记录数不能超过10条');
			}
			return true;
		}),
	body('timestamp').optional(),
	body('sessionId').optional(),
	body('reportType').optional(),
	validateRequest
], async (req, res) => {
	try {
		// 🆕 获取客户端真实IP（考虑代理情况）
		const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
		                 req.headers['x-real-ip'] ||
		                 req.connection.remoteAddress ||
		                 req.socket.remoteAddress ||
		                 req.ip ||
		                 'unknown';
		
		// 🆕 检查是否为重复上报
		const isDuplicate = await isDuplicateReport(req, clientIP);
		if (isDuplicate) {
			return res.status(429).json({
				status: 'duplicate',
				message: '上报过于频繁，请10分钟后再试',
				retryAfter: 600 // 10分钟后重试
			});
		}
		
		const reportData = req.body;
		const version = req?.securityContext?.version || 'unknown';
		const fingerprint = req?.securityContext?.fingerprint || 'unknown';
		
		// 处理高延迟记录
		if (Array.isArray(reportData.records) && reportData.records.length > 0) {
			// 提取 IP 信息（从第一条记录中获取，通常所有记录的 IP 都相同）
			const firstRecord = reportData.records[0];
			const ipInfo = firstRecord?.deviceInfo?.ipInfo;
			
			// 🆕 检测代理使用情况
			const proxyDetection = detectProxy(req, ipInfo);
			
			// 构建 IP 和代理信息前缀
			let ipPrefix = '';
			if (ipInfo?.ip || proxyDetection.isProxy) {
				const ipParts = [];
				
				// IP 基础信息
				if (ipInfo?.ip) ipParts.push(`IP: ${ipInfo.ip}`);
				if (ipInfo?.country) ipParts.push(`Country: ${ipInfo.country}`);
				if (ipInfo?.region) ipParts.push(`Region: ${ipInfo.region}`);
				if (ipInfo?.city) ipParts.push(`City: ${ipInfo.city}`);
				if (ipInfo?.isp) ipParts.push(`ISP: ${ipInfo.isp}`);
				if (ipInfo?.timezone) ipParts.push(`Timezone: ${ipInfo.timezone}`);
				
				// 🆕 代理检测信息
				if (proxyDetection.isProxy) {
					ipParts.push(`Proxy: ${proxyDetection.likelihood} (Score: ${proxyDetection.score})`);
					if (proxyDetection.indicators.length > 0) {
						ipParts.push(`Indicators: ${proxyDetection.indicators.slice(0, 3).join(', ')}`);
					}
				}
				
				ipPrefix = `[${ipParts.join(' | ')}]\n\n`;
			}
			
			// 🆕 限制处理的记录数量，防止过大数据
			const maxRecords = 5; // 最多处理15条记录
			const recordsToProcess = reportData.records.slice(0, maxRecords);
			
			// 合并所有高延迟请求信息
			const delayMessages = recordsToProcess.map((record, index) => {
				const parts = [];
				
				// 基础请求信息（截断过长内容）
				if (record.url) {
					const shortUrl = record.url.length > 70 ?
						record.url.substring(0, 40) + '...' + record.url.substring(-30) : record.url;
					parts.push(`URL: ${shortUrl}`);
				}
				if (record.method) parts.push(`Method: ${record.method}`);
				if (record.duration) parts.push(`Duration: ${record.duration}ms`);
				if (record.success !== undefined) parts.push(`Success: ${record.success}`);
				if (record.statusCode) parts.push(`Status: ${record.statusCode}`);
				if (record.errorMessage) {
					const shortError = record.errorMessage.length > 70 ?
						record.errorMessage.substring(0, 70) + '...' : record.errorMessage;
					parts.push(`Error: ${shortError}`);
				}
				
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
					parts.push(`Device: ${device.platform || 'unknown'} ${device.userAgent ? device.userAgent.slice(0, 30) : ''}`);
				}
				
				return `[HighDelay ${index + 1}] ${parts.join(' | ')}`;
			}).join('\n');
			
			// 拼接 IP 和代理信息到最前面
			const fullMessage = ipPrefix + delayMessages;
			
			// 🆕 更严格的长度限制
			const maxLength = 2500; // 减少到2500字符
			const finalMessage = fullMessage.length > maxLength
				? fullMessage.substring(0, maxLength - 20) + '...[truncated]'
				: fullMessage;
			
			// 基础标签
			const baseTags = [
				`version:${version}`,
				`fingerprint:${fingerprint.slice(0, 8)}`,
				`client_ip:${clientIP}`,
				`total_requests:${recordsToProcess.length}`
			];
			
			// 添加 IP 相关标签
			if (ipInfo?.country) {
				baseTags.push(`country:${ipInfo.country}`);
			}
			if (ipInfo?.isp) {
				baseTags.push(`isp:${ipInfo.isp.replace(/[:=]/g, '_')}`); // 移除标签分隔符
			}
			
			// 🆕 添加代理相关标签
			if (proxyDetection.isProxy) {
				baseTags.push(`proxy:${proxyDetection.likelihood.toLowerCase()}`);
				baseTags.push(`proxy_score:${proxyDetection.score}`);
			}
			
			// 🆕 如果原始记录数超过处理数，添加标记
			if (reportData.records.length > maxRecords) {
				baseTags.push(`truncated:true`);
				baseTags.push(`original_count:${reportData.records.length}`);
			}
			
			// 计算平均延迟用于判断严重程度
			const avgDuration = recordsToProcess.reduce((sum, r) => sum + (Number(r.duration) || 0), 0) / recordsToProcess.length;
			
			// 发送高延迟事件
			req.dataDog.event(
				'Frontend High Delay Report',
				finalMessage,
				{
					alert_type: avgDuration > 10000 ? 'error' : 'warning', // 10秒以上为错误级别
					tags: baseTags,
					source_type_name: 'frontend',
					date_happened: reportData.timestamp ? Math.floor(Number(reportData.timestamp) / 1000) : undefined
				}
			);
			
			// 🆕 记录成功上报的统计
			if (req.dataDog) {
				req.dataDog.increment('high_delay_report.success', 1, [
					`ip:${clientIP}`,
					`records_count:${recordsToProcess.length}`,
					`avg_duration:${Math.round(avgDuration)}ms`,
					`proxy:${proxyDetection.isProxy ? proxyDetection.likelihood.toLowerCase() : 'no'}`
				]);
			}
		}
		
		res.status(200).json({
			status: 'success'
		});
		
	} catch (error) {
		console.error('High delay reporting failed:', error);
		
		// 🆕 记录失败统计
		if (req.dataDog) {
			req.dataDog.increment('high_delay_report.error', 1, [
				`error:${error.message.substring(0, 50)}`
			]);
		}
		
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
