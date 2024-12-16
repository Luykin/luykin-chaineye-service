const BaseCrawler = require('./base-crawler');
const { EXNews } = require('../models/sqlite-start');
function formatOkxLink(link) {
	const baseUrl = 'https://www.okx.com';
	
	if (!link.startsWith('http')) {
		// 确保拼接时不会有重复的 /
		return `${baseUrl.replace(/\/$/, '')}/${link.replace(/^\//, '')}`;
	}
	
	return link;
}

class OkxExNewsCrawler extends BaseCrawler {
	constructor() {
		super();
	}
	
	async crawlNews() {
		const tabUrls = [
			// {
			// 	url: 'https://www.okx.com/zh-hans/help/section/announcements-new-listings',
			// 	type: 'okx_cryptocurrency',
			// },
			{
				url: "https://www.okx.com/help/section/announcements-new-listings",
				type: 'okx_cryptocurrency',
			}
		];
		
		for (const { url, type } of tabUrls) {
			const { browser, page, proxy } = await this.initProxyBrowserAndPage();
			
			try {
				await page.goto(url, { timeout: 15000 });
				// 等待 links 元素加载
				await page.waitForSelector('.home-container', { timeout: 10000 });
				let announcements = await page.evaluate((type) => {
					const appWrap = document.querySelector("ul[class*='index_list__']");
					if (!appWrap) return [];
					
					const links = appWrap?.querySelectorAll('li') || [];
					const results = [];
					links.forEach((link, index) => {
						if (index >= 2) return; // 只取前两条
						const title = link.querySelector('div[class*="index_articleTitle"]')?.innerText?.trim() || '';
						const date = link.querySelector('span')?.innerText?.trim() || '-';
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
					newsUrl: formatOkxLink(_?.newsUrl)
				}));
				for (const announcement of announcements) {
					const exists = await EXNews.findOne({ where: { newsUrl: announcement?.newsUrl } });
					if (!exists) {
						await EXNews.create(announcement);
						await BaseCrawler.sendMessageToGroup(`${announcement.title} [🔗 Read More](${announcement.newsUrl})`);
						console.log(`New announcement sent: ${announcement.title}`);
					} else {
						if (+new Date() < 1734367067972) {
							console.log(`Announcement already exists: ${announcement.title}`);
						}
					}
				}
			} catch (error) {
				console.log(`error: ${proxy.ip}:`, error.message);
			} finally {
				await browser.close(); // 每次爬取完成后关闭浏览器
			}
			
			await new Promise((resolve) => setTimeout(resolve, 3000)); // 延时3000ms
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

module.exports = new OkxExNewsCrawler();
