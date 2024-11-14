/**
 * apiServer.js
 *
 * 用途: 用于启动用户访问的 API 服务。该服务处理客户端的 HTTP 请求。
 *
 * 建议运行模式:
 * - 使用 PM2 的多线程 (cluster 模式): `pm2 start apiServer.js -i max --name api-server`
 * - 在多核服务器上使用多线程可以提升并发性能。
 *
 * 说明:
 * - 由于 API 路由服务通常要响应较多的客户端请求，cluster 模式能够充分利用服务器的多核资源，确保高并发下仍然能快速响应。
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const { setupDatabase } = require('./models');
const fundraisingRoutes = require('./routes/fundraising');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8090;

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
			'script-src': ['\'self\'', '\'unsafe-inline\''],
			'style-src': ['\'self\'', '\'unsafe-inline\''],
		},
	},
}));
app.use(rateLimit({
	windowMs: 60 * 1000, // 1 分钟
	max: 60,             // 每分钟最多 60 个请求
	message: '请求过于频繁，请稍后再试。'
}));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json());
app.use(helmet.hidePoweredBy()); // 隐藏 X-Powered-By 头
app.use(helmet.xssFilter());      // 防止 XSS 攻击
app.use(helmet.noSniff());        // 防止 MIME 类型嗅探
app.use(express.json({ limit: '20kb' })); // 限制请求体大小为 20KB

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
