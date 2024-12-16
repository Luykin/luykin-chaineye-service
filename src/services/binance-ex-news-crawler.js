const BaseCrawler = require('./base-crawler');
const { EXNews } = require('../models/sqlite-start');

function formatBinanceLink(link) {
	const baseUrl = 'https://www.binance.com';
	
	if (!link.startsWith('http')) {
		// 确保拼接时不会有重复的 /
		return `${baseUrl.replace(/\/$/, '')}/${link.replace(/^\//, '')}`;
	}
	
	return link;
}

class BinanceExNewsCrawler extends BaseCrawler {
	constructor() {
		super();
	}
	
	async crawlNews() {
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
				await page.goto(url, { timeout: 15000 });
				// 等待 links 元素加载
				await page.waitForSelector('#__APP', { timeout: 10000 });
				let announcements = await page.evaluate((type) => {
					const appWrapClass = '.bn-flex.flex-col.gap-6.px-4.py-6.tablet\\:px-10.tablet\\:py-6.rounded-xl.border.border-solid.border-Line';
					const appWrap = document.querySelector(appWrapClass);
					if (!appWrap) return [];
					
					const links = appWrap?.querySelectorAll('.bn-flex.flex-col.gap-1') || [];
					const results = [];
					links.forEach((link, index) => {
						if (index >= 2) return; // 只取前两条
						const title = link.querySelector('a h3')?.innerText?.trim() || '';
						const date = link.querySelector('div[class*="typography-caption1"]')?.innerText?.trim() || '-';
						const href = link.querySelector('a')?.getAttribute('href') || '';
						
						if (title && href) {
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
						await BaseCrawler.sendMessageToGroup(`${announcement.title} [🔗 Read More](${announcement.newsUrl})`);
						console.log(`New announcement sent: ${announcement.title}`);
					} else {
						// if (+new Date() < 1734363916566) {
						// 	console.log(`Announcement already exists: ${announcement.title}`);
						// }
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
				await this.crawlNews();
			} catch (error) {
				console.error('Error during startCrawling:', error);
			}
		}
	}
}

module.exports = new BinanceExNewsCrawler();
