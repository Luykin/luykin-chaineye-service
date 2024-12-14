const { EXNews } = require('../models/sqlite-start');
const BaseCrawler = require('./base-crawler');
const TelegramBot = require('node-telegram-bot-api');
const useProxy = require('@lem0-packages/puppeteer-page-proxy');

// Telegram 配置
const tgToken = '7369047814:AAHv7OQffIzszIdwKCTVzjP349ZhsItVpm0';
const tgGroupChatIdList = ['-1002295668714', '-4640840749'];
const tgBot = new TelegramBot(tgToken);

// 代理列表
const proxies = [
	'http://user81794:8ipjmd@185.232.47.106:7446',
	'http://user81794:8ipjmd@216.10.9.111:7446',
	'http://user81794:8ipjmd@185.232.47.101:7446',
	'http://user81794:8ipjmd@216.10.9.234:7446',
	'http://user81794:8ipjmd@185.232.47.233:7446',
];

// 发送消息到 Telegram 群组
const sendMessageToGroup = async (message) => {
	try {
		for (const tgGroupChatId of tgGroupChatIdList) {
			await tgBot.sendMessage(tgGroupChatId, message, { parse_mode: 'Markdown' });
		}
		console.log('Message sent successfully!');
	} catch (error) {
		console.error('Error sending message:', error);
	}
};

class ExNewsCrawler extends BaseCrawler {
	constructor() {
		super();
		this.proxyIndex = 0; // 当前代理索引
	}
	
	// 获取当前代理
	getCurrentProxy() {
		const proxy = proxies[this.proxyIndex];
		this.proxyIndex = (this.proxyIndex + 1) % proxies.length; // 轮换代理
		return proxy;
	}
	
	// 主爬取逻辑
	async crawlBinanceNews(pageInstance) {
		try {
			const tabUrls = [
				{
					url: 'https://www.binance.com/en/support/announcement/new-fiat-listings?c=50&navId=50',
					type: 'binance_listings',
				},
			];
			
			for (const { url, type } of tabUrls) {
				// 设置代理
				const proxy = this.getCurrentProxy();
				await useProxy(pageInstance, proxy);
				console.log(`Crawling: ${type} from ${url} using proxy: ${proxy}`);
				
				// 访问目标页面
				try {
					await pageInstance.goto(url, {
						waitUntil: 'networkidle0',
						timeout: 8000,
					});
				} catch (error) {
					console.error(`Failed to navigate to ${url}:`, error.message);
					continue; // 跳过当前 URL，继续下一个
				}
				
				// 提取页面数据
				const announcements = await pageInstance.evaluate((type) => {
					const appWrap = document.querySelector('#__APP');
					if (!appWrap) return [];
					
					const links = appWrap.querySelectorAll('div[class="bn-flex flex-col gap-1 noH5:gap-2"]');
					const results = [];
					links.forEach((link, index) => {
						if (index >= 2) return; // 只取前两条
						const title = link.querySelector('a h3')?.innerText.trim();
						const date = link.querySelector('div[class*="typography-caption1"]')?.innerText.trim();
						const href = link.querySelector('a').getAttribute('href');
						
						if (title && date && href) {
							results.push({
								title,
								timestamp: date,
								newsUrl: href,
								type,
								crawledTime: +new Date(),
							});
						}
					});
					
					return results;
				}, type);
				console.log(announcements, 'announcements')
				// 处理提取到的公告
				for (const announcement of announcements) {
					const exists = await EXNews.findOne({
						where: { newsUrl: announcement.newsUrl },
					});
					
					if (!exists) {
						// 保存到数据库
						await EXNews.create(announcement);
						
						// 发送 Telegram 通知
						await sendMessageToGroup(
							`${announcement.title} [🔗 Read More](https://www.binance.com${announcement.newsUrl})`
						);
						console.log(`New announcement sent: ${announcement.title}`);
					} else {
						console.log(`Announcement already exists: ${announcement.title}`);
					}
				}
				
				// 延时 500ms，避免频率过高
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		} catch (err) {
			console.error('Error during crawling:', err);
		}
	}
	
	// 无限循环执行爬取任务
	async startCrawling() {
		let whileCount = 0;
		let pageInstance = await this.safeInitPage('binancePage');
		
		while (true) {
			try {
				await this.crawlBinanceNews(pageInstance);
				whileCount++;
				
				if (whileCount > 10) {
					console.log('Reinitializing browser and page after 10 iterations...');
					await pageInstance.close();
					pageInstance = await this.safeInitPage('binancePage'); // 重新初始化页面
					whileCount = 0;
				}
			} catch (error) {
				console.error('Error during startCrawling:', error);
				
				// 强制重启浏览器
				await this.forceClose();
				pageInstance = await this.safeInitPage('binancePage');
			}
		}
	}
}

module.exports = new ExNewsCrawler();
