const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const { setupDatabase } = require('./models');
const fundraisingRoutes = require('./routes/fundraising');
const scheduler = require('./services/scheduler');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8090;
// 配置 CORS 选项
const corsOptions = {
	origin: [
		'https://chaineye.tools',
		'https://minibridge.chaineye.tools',
		'https://www.cryptohunt.ai',
		'https://cryptohunt.ai',
		'http://cryptohunt.ai',
		'http://www.cryptohunt.ai',
		'http://chaineye.tools',
		'http://minibridge.chaineye.tools',
	],
	methods: ['GET', 'POST', 'PUT', 'DELETE'], // 允许的 HTTP 方法
	allowedHeaders: ['Content-Type', 'Authorization'], // 允许的请求头
	credentials: false // 如果需要发送凭证（如 cookies），设置为 true
};

// 使用 CORS 中间件
app.use(cors(corsOptions));

// 安全中间件
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", "'unsafe-inline'"],
            "style-src": ["'self'", "'unsafe-inline'"],
        },
    },
}));
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:8080',
    methods: ['GET', 'POST']
}));

// 速率限制
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 100 // 限制每个IP 15分钟内最多100个请求
});
app.use('/api/', limiter);

// 实用中间件
app.use(compression()); // 启用 gzip 压缩
app.use(morgan('combined')); // 日志记录
app.use(express.json());

// API 路由
app.use('/api/fundraising', fundraisingRoutes);

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: '服务器内部错误！' });
});

// 初始化数据库并启动服务器
async function startServer() {
    try {
        await setupDatabase();
        app.listen(PORT, () => {
            console.log(`服务器运行在端口 ${PORT}`);
            // 启动爬虫调度器
            scheduler.startScheduler();
        });
    } catch (error) {
        console.error('启动服务器失败:', error);
        process.exit(1);
    }
}

// 优雅关闭
process.on('SIGTERM', async () => {
    console.log('收到 SIGTERM 信号，正在优雅关闭...');
    scheduler.stopScheduler();
    process.exit(0);
});

startServer();
