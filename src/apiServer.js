const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const redis = require('redis');
const { setupDatabase } = require('./models');
const fundraisingRoutes = require('./routes/fundraising');
require('dotenv').config();

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

// 中间件传递 Redis 客户端
app.use((req, res, next) => {
	req.redisClient = redisClient;
	next();
});

// CORS 配置
const corsOptions = {
	origin: [
		'https://chaineye.tools', 'https://minibridge.chaineye.tools',
		'https://www.cryptohunt.ai', 'https://cryptohunt.ai',
		'http://cryptohunt.ai', 'http://www.cryptohunt.ai',
		'http://chaineye.tools', 'http://minibridge.chaineye.tools',
	],
	methods: ['GET', 'POST', 'PUT', 'DELETE'],
	allowedHeaders: ['Content-Type', 'Authorization'],
	credentials: false
};

app.use(cors(corsOptions));

// 安全和速率限制
app.use(helmet({
	contentSecurityPolicy: {
		directives: {
			...helmet.contentSecurityPolicy.getDefaultDirectives(),
			'script-src': ["'self'", "'unsafe-inline'"],
			'style-src': ["'self'", "'unsafe-inline'"],
		},
	},
}));
app.use(rateLimit({
	windowMs: 60 * 1000,
	max: 60,
	message: '请求过于频繁，请稍后再试。'
}));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json());
app.use(helmet.hidePoweredBy());
app.use(helmet.xssFilter());
app.use(helmet.noSniff());
app.use(express.json({ limit: '20kb' }));

// API 路由
app.use('/api/fundraising', fundraisingRoutes);

// 错误处理中间件
app.use((err, req, res, next) => {
	console.error(err.stack);
	res.status(500).json({ error: '服务器内部错误！' });
});

// 启动 API 服务
async function startAPIServer() {
	await setupDatabase();
	app.listen(PORT, () => console.log(`API 服务器运行在端口 ${PORT}`));
}

startAPIServer();
