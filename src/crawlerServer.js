/**
 * crawlerServer.js
 *
 * 用途: 用于启动爬虫服务，负责数据爬取和处理。
 *
 * 建议运行模式:
 * - 使用 PM2 的单线程模式 (fork 模式): `pm2 start crawlerServer.js --name crawler-server --watch`
 * - 在 fork 模式下，爬虫服务可以避免并发冲突，防止多个线程同时执行爬虫任务。
 *
 * 说明:
 * - 爬虫任务通常不适合多线程并发执行，因为这可能导致数据冲突和过度请求目标服务器。
 * - 将爬虫服务与 API 服务分离可以确保用户请求和数据爬取任务互不影响。
 */

const { setupDatabase } = require('./models');
const scheduler = require('./services/scheduler');
require('dotenv').config();

async function startCrawlerService() {
	try {
		await setupDatabase();
		console.log('启动爬虫调度器...');
		scheduler.startScheduler();
	} catch (error) {
		console.error('启动爬虫服务失败:', error);
		process.exit(1);
	}
}

// 优雅关闭
process.on('SIGTERM', async () => {
	console.log('收到 SIGTERM 信号，正在优雅关闭...');
	scheduler.stopScheduler();
	process.exit(0);
});

startCrawlerService();
