require('dotenv').config({ path: `${process.env.NODE_ENV === 'development' ? '.env-dev' : '.env-pro'}` });
console.log(process.env.NODE_ENV, 'process.env.NODE_ENV运行环境');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const redis = require('redis');
const { setupSqlite } = require('./models/sqlite-start');
const { setupPostgres } = require('./models/postgres-start');
const fundraisingRoutes = require('./routes/fundraising');
const cryptoRoutes = require('./routes/cryptohunt-tg');
const proxyRoutes = require('./routes/proxy');
const newsRoutes = require('./routes/ex-news');
const xHuntAuthRoutes = require('./xhunt/api/auth');
const xHuntProxyRoutes = require('./xhunt/api/proxy');
const xHuntReviewsRoutes = require('./xhunt/api/reviews');
const { securityMiddleware, fingerprintLimiter, rateLimiter } = require('./xhunt/middleware/security');
const StatsD = require('hot-shots');
const dataDog = new StatsD();

const app = express();
const PORT = process.env.PORT || 8090;

// 初始化 Redis 客户端
const redisClient = redis.createClient({
	socket: {
		host: '127.0.0.1', // Redis 地址
		port: 6379,        // Redis 端口
	},
	// password: process.env.REDIS_PASSWORD // 如果有密码
});

// 连接 Redis
(async () => {
	try {
		await redisClient.connect();
		console.log('Redis 连接成功');
	} catch (error) {
		console.error('Redis 连接失败:', error);
	}
})();

app.use((req, res, next) => {
	req.redisClient = redisClient;
	req.dataDog = dataDog;
	next();
});

/** https://us5.datadoghq.com/integrations?search=node&integrationId=node 性能统计 **/
app.use((req, res, next) => {
	const startTime = Date.now();
	
	// 劫持原生的 .json()/.send() 方法，捕获错误信息
	const originalSend = res.send;
	res.send = function (body) {
		// 在响应前记录错误详情（仅限 500 状态码）
		if (res.statusCode === 500) {
			const errorTags = [
				`status:500`,
				`path:${req.path}`,
				`method:${req.method}`,
				`error_message:${body.error?.substring(0, 100) || 'unknown'}`.replace(/[:=]/g, '_'), // 移除标签分隔符
				// `stack_hash:${crypto.createHash('md5').update(body.stack || '').digest('hex')}`      // 堆栈哈希（避免 PII 泄露）
			];
			
			dataDog.increment('requests.errors.total', 1, errorTags);
		}
		originalSend.call(this, body);
	};
	
	res.on('finish', () => {
		const latency = Date.now() - startTime;
		
		// 基础指标
		dataDog.increment('requests.total', 1, [
			`status:${res.statusCode}`,
			`path:${req.path}`,
			`method:${req.method}`,
			`version:${req?.securityContext?.version || "unknown"}`
		]);
		
		dataDog.histogram('requests.latency', latency, [
			`status:${res.statusCode}`,
			`path:${req.path}`
		]);
	});
	next();
});

// CORS 配置
const corsOptions = {
	origin: [
		'https://chaineye.tools',
		'https://minibridge.chaineye.tools',
		'https://www.cryptohunt.ai',
		'https://cryptohunt.ai',
		'https://dev.cryptohunt.ai',
		'http://cryptohunt.ai',
		'http://www.cryptohunt.ai',
		'http://dev.cryptohunt.ai',
		'http://chaineye.tools',
		'http://minibridge.chaineye.tools',
		'http://localhost',
		'http://localhost:3000',
		'http://127.0.0.1',
		'http://127.0.0.1:3000',
		'https://x.com',
		'chrome-extension://pkabfgfgebpmcjgfkjfjapgfemfomlie'
	],
	methods: ['GET', 'POST', 'PUT', 'OPTIONS'], // 包括 OPTIONS
	allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Timestamp', 'x-request-id', 'x-request-timestamp', 'x-device-fingerprint', 'x-request-signature', 'x-extension-version'],
	credentials: true,
};

app.set('trust proxy', 1); // 仅信任最靠近 Express 的一层代理
app.use(cors(corsOptions));
// 安全和速率限制
app.use(helmet({
	contentSecurityPolicy: {
		directives: {
			...helmet.contentSecurityPolicy.getDefaultDirectives(),
			'script-src': ['\'self\'', '\'unsafe-inline\''],
			'style-src': ['\'self\'', '\'unsafe-inline\''],
		},
	},
}));
// 全局速率限制
app.use(rateLimiter);
app.use(compression());
app.use(morgan('combined'));
app.use(helmet.hidePoweredBy());
app.use(helmet.xssFilter());
app.use(helmet.noSniff());
app.use(express.json({ limit: '20kb' }));

// API 路由
app.use('/api/fundraising', fundraisingRoutes);
app.use('/api/crypto', cryptoRoutes);
app.use('/api/proxy', proxyRoutes);
app.use('/api/news', newsRoutes);

app.use(
	'/api/xhunt/auth',
	fingerprintLimiter,
	securityMiddleware,
	xHuntAuthRoutes
);

app.use(
	'/api/xhunt/proxy',
	fingerprintLimiter,
	securityMiddleware,
	xHuntProxyRoutes
);

app.use(
	'/api/xhunt/reviews',
	fingerprintLimiter,
	securityMiddleware,
	xHuntReviewsRoutes
);

// 错误处理中间件
app.use((err, req, res, next) => {
	console.error(err.stack);
	res.status(500).json({ error: '服务器内部错误！' });
});

// 启动 API 服务
async function startAPIServer() {
	await setupSqlite();
	await setupPostgres();
	app.listen(PORT, () => console.log(`API 服务器运行在端口 ${PORT}`));
}

startAPIServer().then(r => r);
