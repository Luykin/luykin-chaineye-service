const BaseCrawler = require('./base-crawler');
const { EXNews } = require('../models/sqlite-start');
const TelegramBot = require('node-telegram-bot-api');

// Telegram 配置
const tgToken = '7369047814:AAHv7OQffIzszIdwKCTVzjP349ZhsItVpm0';
const tgGroupChatIdList = ['-1002295668714', '-4640840749'];
const tgBot = new TelegramBot(tgToken);

function formatBinanceLink(link) {
	const baseUrl = 'https://www.binance.com';
	
	if (!link.startsWith('http')) {
		// 确保拼接时不会有重复的 /
		return `${baseUrl.replace(/\/$/, '')}/${link.replace(/^\//, '')}`;
	}
	
	return link;
}

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
	}
	
	async crawlBinanceNews() {
		const tabUrls = [
			// {
			// 	url: 'https://www.binance.com/en/support/announcement/new-fiat-listings?c=50&navId=50',
			// 	type: 'binance_listings',
			// },
			{
				url: 'https://www.binance.com/en/support/announcement/new-cryptocurrency-listing?c=48&navId=48',
				type: 'binance_cryptocurrency',
			},
		];
		
		for (const { url, type } of tabUrls) {
			const { browser, page, proxy } = await this.initProxyBrowserAndPage();
			
			try {
				// console.log(`Crawling: ${type} from ${url} using proxy: ${proxy.ip}:${proxy.port}`);
				await page.goto(url, { timeout: 25000 });
				// 等待 links 元素加载
				await page.waitForSelector('#__APP div.bn-flex.flex-col.gap-1.noH5\\:gap-2', { timeout: 15000 });
				
				let announcements = await page.evaluate((type) => {
					const appWrap = document.querySelector('#__APP');
					if (!appWrap) return [];
					
					const links = appWrap?.querySelectorAll('div[class="bn-flex flex-col gap-1 noH5:gap-2"]') || [];
					const results = [];
					links.forEach((link, index) => {
						if (index >= 2) return; // 只取前两条
						const title = link.querySelector('a h3')?.innerText?.trim() || '';
						const date = link.querySelector('div[class*="typography-caption1"]')?.innerText?.trim() || '';
						const href = link.querySelector('a')?.getAttribute('href') || '';
						
						if (title && date && href) {
							results.push({
								title,
								timestamp: date,
								newsUrl: href,
								type,
								crawlTime: +new Date()
							});
						}
					});
					return results;
				}, type);
				announcements = announcements.map(_ => ({
					..._,
					newsUrl: formatBinanceLink(_?.newsUrl)
				}));
				for (const announcement of announcements) {
					const exists = await EXNews.findOne({ where: { newsUrl: announcement?.newsUrl } });
					if (!exists) {
						await EXNews.create(announcement);
						await sendMessageToGroup(`${announcement.title} [🔗 Read More](${announcement.newsUrl})`);
						console.log(`New announcement sent: ${announcement.title}`);
					} else {
						// console.log(`Announcement already exists: ${announcement.title}`);
					}
				}
			} catch (error) {
				console.log(`error: ${proxy.ip}:`, error.message);
			} finally {
				await browser.close(); // 每次爬取完成后关闭浏览器
			}
			
			await new Promise((resolve) => setTimeout(resolve, 500)); // 延时500ms
		}
	}
	
	async startCrawling() {
		while (true) {
			try {
				await this.crawlBinanceNews();
			} catch (error) {
				console.error('Error during startCrawling:', error);
			}
		}
	}
}

module.exports = new ExNewsCrawler();
