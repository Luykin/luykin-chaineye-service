const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// 速率限制中间件
const rateLimiter = rateLimit({
	windowMs: 10 * 60 * 1000, // 10分钟窗口
	max: 400, // 限制请求次数
	standardHeaders: true,
	legacyHeaders: false,
	handler: (req, res) => {
		res.status(429).json({
			error: '请求过于频繁，请稍后再试'
		});
	}
});

// 基于设备指纹的速率限制
const fingerprintLimiter = rateLimit({
	windowMs: 10 * 60 * 1000,
	max: 600,
	standardHeaders: true,
	legacyHeaders: false,
	keyGenerator: (req) => req.headers['x-device-fingerprint'] || req.ip,
	handler: (req, res) => {
		res.status(429).json({
			error: '设备请求过于频繁，请稍后再试'
		});
	}
});

// 验证时间戳是否在有效期内（5分钟）
const isTimestampValid = (timestamp) => {
	const now = Date.now();
	const fiveMinutes = 5 * 60 * 1000;
	return Math.abs(now - timestamp) <= fiveMinutes;
};

// 验证指纹格式
const isValidFingerprint = (fingerprint) => {
	// FingerprintJS 生成的指纹是一个32位的十六进制字符串
	const fingerprintRegex = /^[a-f0-9]{32}$/i;
	return fingerprintRegex.test(fingerprint);
};

// 验证请求ID格式
const isValidRequestId = (requestId) => {
	// UUID v4 格式
	const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidV4Regex.test(requestId);
};

// 生成签名
const generateSignature = (method, path, timestamp, body, fingerprint) => {
	const payload = [
		method.toUpperCase(),
		path.endsWith("/") ? path.slice(0, -1) : path,
		timestamp,
		fingerprint,
		JSON.stringify(body || {})
	].join('|');
	return crypto
		.createHmac('sha256', process.env.XHUNT_API_SECRET)
		.update(payload)
		.digest('hex');
};

// 安全中间件
const securityMiddleware = (req, res, next) => {
	try {
		// 检查必要的请求头
		const requestId = req.headers['x-request-id'];
		const timestamp = parseInt(req.headers['x-request-timestamp']);
		const fingerprint = req.headers['x-device-fingerprint'];
		const signature = req.headers['x-request-signature'];
		const version = req.headers['x-extension-version'];
		
		// 验证请求头是否存在
		if (!requestId || !timestamp || !fingerprint || !signature || !version) {
			return res.status(400).json({ error: '400' });
		}
		
		// 验证指纹格式
		if (!isValidFingerprint(fingerprint)) {
			return res.status(400).json({ error: '400-1' });
		}
		
		// 验证请求ID格式
		if (!isValidRequestId(requestId)) {
			return res.status(400).json({ error: '400-2' });
		}
		
		// 验证时间戳
		if (!isTimestampValid(timestamp)) {
			return res.status(400).json({ error: '400-3' });
		}
		// 验证签名
		const expectedSignature = generateSignature(
			req.method,
			req.baseUrl + req.path,
			timestamp,
			req.body,
			fingerprint
		);
		if (signature !== expectedSignature) {
			return res.status(411).json({ error: '411' });
		}
		// 将验证后的信息添加到请求对象中
		req.securityContext = {
			requestId,
			timestamp,
			fingerprint,
			version
		};
		next();
	} catch (error) {
		console.error('Security middleware error:', error);
		res.status(500).json({ error: 'securityMiddleware 500' });
	}
};

module.exports = {
	rateLimiter,
	fingerprintLimiter,
	securityMiddleware,
	generateSignature // 导出用于测试
};
