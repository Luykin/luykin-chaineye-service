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

// 检测是否为浏览器环境
const isBrowserEnvironment = (userAgent, windowLocationHref) => {
	if (!userAgent || !windowLocationHref) {
		return false;
	}
	
	// 检查 User-Agent 是否包含常见浏览器标识
	const browserPatterns = [
		// 主流桌面浏览器
		/Chrome\/\d+/i,
		/Firefox\/\d+/i,
		/Safari\/\d+/i,
		/Edge\/\d+/i,
		/Opera\/\d+/i,
		/Chromium\/\d+/i,
		
		// 移动端浏览器
		/Mobile.*Safari/i,
		/Android.*Chrome/i,
		/iPhone.*Safari/i,
		/iPad.*Safari/i,
		/Mobile.*Firefox/i,
		/SamsungBrowser\/\d+/i,
		/UCBrowser\/\d+/i,
		/MiuiBrowser\/\d+/i,
		/QQBrowser\/\d+/i,
		/BaiduBrowser\/\d+/i,
		/SogouMobileBrowser\/\d+/i,
		
		// 其他常见浏览器
		/Vivaldi\/\d+/i,
		/Brave\/\d+/i,
		/DuckDuckGo\/\d+/i,
		/Yandex\/\d+/i,
		/OPR\/\d+/i,        // Opera 的另一种标识
		/Edg\/\d+/i,        // Edge 的另一种标识
		/EdgA\/\d+/i,       // Edge Android
		/EdgiOS\/\d+/i,     // Edge iOS
		/CriOS\/\d+/i,      // Chrome iOS
		/FxiOS\/\d+/i,      // Firefox iOS
		/Version\/.*Safari/i, // Safari 的标准格式
		
		// WebView 和嵌入式浏览器
		/WebView/i,
		/wv\)/i,            // Android WebView
		/Version\/.*Mobile.*Safari/i, // 移动端 Safari WebView
		
		// 国产浏览器
		/360SE/i,           // 360安全浏览器
		/360EE/i,           // 360极速浏览器
		/Maxthon/i,         // 傲游浏览器
		/TencentTraveler/i, // 腾讯TT浏览器
		/TheWorld/i,        // 世界之窗浏览器
		/LBBROWSER/i,       // 猎豹浏览器
		/2345Explorer/i,    // 2345浏览器
		/115Browser/i,      // 115浏览器
		
		// 其他可能的浏览器标识
		/Mozilla\/\d+.*Gecko/i, // 基于 Gecko 的浏览器
		/AppleWebKit\/\d+/i,    // 基于 WebKit 的浏览器
		/KHTML.*like.*Gecko/i   // 类似 Gecko 的浏览器
	];
	
	const hasBrowserUA = browserPatterns.some(pattern => pattern.test(userAgent));
	
	// 检查是否包含脚本特征（常见的脚本 User-Agent）
	const scriptPatterns = [
		/curl/i,
		/wget/i,
		/python/i,
		/node/i,
		/axios/i,
		/fetch/i,
		/postman/i,
		/insomnia/i,
		/httpie/i,
		/bot/i,
		/crawler/i,
		/spider/i,
		/scraper/i,
		/automation/i,
		/headless/i,
		/phantom/i,
		/selenium/i,
		/webdriver/i,
		/puppeteer/i,
		/playwright/i
	];
	
	const hasScriptUA = scriptPatterns.some(pattern => pattern.test(userAgent));
	
	// 检查 window.location.href 格式是否合理
	const isValidUrl = /^https?:\/\/.+/.test(windowLocationHref);
	
	// 必须有浏览器特征，没有脚本特征，且有有效的 URL
	return hasBrowserUA && !hasScriptUA && isValidUrl;
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

// 浏览器环境检测中间件
const browserOnlyMiddleware = (req, res, next) => {
	try {
		const userAgent = req.headers['user-agent'];
		const windowLocationHref = req.headers['x-window-location-href'];
		
		if (!isBrowserEnvironment(userAgent, windowLocationHref)) {
			return res.status(403).json({ error: '403' });
		}
		
		next();
	} catch (error) {
		console.error('Browser detection middleware error:', error);
		res.status(500).json({ error: 'browserOnlyMiddleware 500' });
	}
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
	browserOnlyMiddleware,
	generateSignature // 导出用于测试
};