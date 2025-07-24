const express = require('express');
const path = require('path');
const { getFullStats, getSimpleStats } = require('../services/statsService');
const expressStatic = require('express');

const router = express.Router();

/**
 * 格式化数字（添加千分位分隔符）
 */
function formatNumber(num) {
	return num.toLocaleString();
}

/**
 * 格式化日期时间（中国时区）
 */
function formatDateTime(date = new Date()) {
	return date.toLocaleString('zh-CN', {
		timeZone: 'Asia/Shanghai',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});
}

/**
 * 基础认证中间件
 * 最简单的用户名密码验证
 */
function basicAuth(req, res, next) {
	// 从环境变量获取认证信息，如果没有则使用默认值
	const STATS_USERNAME = process.env.STATS_USERNAME || 'admin';
	const STATS_PASSWORD = process.env.STATS_PASSWORD || 'xhunt2024';
	
	const authHeader = req.headers.authorization;
	
	if (!authHeader || !authHeader.startsWith('Basic ')) {
		// 返回401状态码，浏览器会自动弹出登录框
		res.setHeader('WWW-Authenticate', 'Basic realm="XHunt Stats"');
		return res.status(401).send(`
			<!DOCTYPE html>
			<html>
			<head>
				<title>需要认证</title>
				<meta charset="UTF-8">
			</head>
			<body style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px;">
				<h2>🔐 访问受限</h2>
				<p>请输入用户名和密码访问统计页面</p>
			</body>
			</html>
		`);
	}
	
	// 解码 Base64 编码的用户名密码
	const base64Credentials = authHeader.split(' ')[1];
	const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
	const [username, password] = credentials.split(':');
	
	// 验证用户名密码
	if (username === STATS_USERNAME && password === STATS_PASSWORD) {
		next(); // 认证成功，继续处理请求
	} else {
		// 认证失败
		res.setHeader('WWW-Authenticate', 'Basic realm="XHunt Stats"');
		return res.status(401).send(`
			<!DOCTYPE html>
			<html>
			<head>
				<title>认证失败</title>
				<meta charset="UTF-8">
			</head>
			<body style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px;">
				<h2>❌ 认证失败</h2>
				<p>用户名或密码错误，请重试</p>
				<button onclick="window.location.reload()">重新登录</button>
			</body>
			</html>
		`);
	}
}

/**
 * 退出登录接口
 * 通过返回401状态码来清除浏览器的认证缓存
 */
router.get('/logout', (req, res) => {
	// 设置WWW-Authenticate头来触发浏览器清除认证
	res.setHeader('WWW-Authenticate', 'Basic realm="XHunt Stats"');
	res.status(401).send(`
		<!DOCTYPE html>
		<html>
		<head>
			<title>已退出登录</title>
			<meta charset="UTF-8">
			<meta http-equiv="refresh" content="2;url=/api/xhunt/stats">
		</head>
		<body style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px;">
			<h2>✅ 已成功退出登录</h2>
			<p>正在跳转到登录页面...</p>
			<p><a href="/api/xhunt/stats">点击这里立即跳转</a></p>
		</body>
		</html>
	`);
});

/**
 * GET /stats
 * 获取产品数据统计（需要认证）
 */
router.get('/', basicAuth, async (req, res) => {
	try {
		// 设置静态文件服务（在每次请求时设置）
		const app = req.app;
		const staticPath = path.join(__dirname, '../../public/static');
		app.use('/static', expressStatic.static(staticPath));
		
		// 获取统计数据
		const stats = await getFullStats(req.redisClient);

		// 将统计数据传递给前端JavaScript（用于下载功能）
		const statsDataScript = `<script>window.statsData = ${JSON.stringify(stats)};</script>`;

		// 设置 EJS 模板引擎
		app.set('view engine', 'ejs');
		app.set('views', path.join(__dirname, '../views'));

		// 渲染模板，传递所有需要的辅助函数和数据
		const renderedHtml = await new Promise((resolve, reject) => {
			app.render('stats', {
				stats,
				formatNumber,
				formatDateTime
			}, (err, html) => {
				if (err) reject(err);
				else resolve(html);
			});
		});

		// 在HTML中注入统计数据脚本
		const finalHtml = renderedHtml.replace('</body>', `${statsDataScript}</body>`);
		
		res.send(finalHtml);

	} catch (error) {
		console.error('Error fetching stats:', error);
		res.status(500).json({ error: '获取统计数据失败' });
	}
});

/**
 * GET /stats/json
 * 获取JSON格式的统计数据（用于API调用，也需要认证）
 */
router.get('/json', basicAuth, async (req, res) => {
	try {
		const stats = await getSimpleStats();

		res.json({
			success: true,
			data: stats
		});

	} catch (error) {
		console.error('Error fetching JSON stats:', error);
		res.status(500).json({
			success: false,
			error: '获取统计数据失败'
		});
	}
});

/**
 * GET /health
 * 健康检查接口（无需认证）
 */
router.get('/health', (req, res) => {
	res.json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		service: 'xhunt-stats-api'
	});
});

module.exports = router;