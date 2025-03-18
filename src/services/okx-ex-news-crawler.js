const StatisticsCrawler = require('./StatisticsCrawler');
const { EXNews } = require('../models/sqlite-start');
function formatOkxLink(link) {
	const baseUrl = 'https://www.okx.com';
	
	if (!link.startsWith('http')) {
		// 确保拼接时不会有重复的 /
		return `${baseUrl.replace(/\/$/, '')}/${link.replace(/^\//, '')}`;
	}
	
	return link;
}
function validateTitle(title) {
	// 清除首尾空格，并将多个连续空格替换成单个空格，然后转换为小写
	const normalizedTitle = title.trim().replace(/\s+/g, ' ').toLowerCase();
	
	// 定义匹配的前缀
	const validPrefixes = [
		'list'
	];
	
	// 检查标题是否以指定的前缀之一开头
	for (let prefix of validPrefixes) {
		if (normalizedTitle.includes(prefix)) {
			return true;
		}
	}
	
	return false;
}

class OkxExNewsCrawler extends StatisticsCrawler {
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
			const { browser, page, proxy } = await this.initProxyBrowserAndPage('japan');
			// console.log(`Crawling ${url} with proxy ${proxy.ip}`);
			try {
				await page.goto(url, { timeout: 30000 });
				// 等待 links 元素加载
				await page.waitForSelector('.home-container', { timeout: 30000 });
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
					if (!exists && validateTitle(announcement.title)) {
						await EXNews.create(announcement);
						const msg = `${announcement.title} [🔗 Read More](${announcement.newsUrl})`;
						await StatisticsCrawler.sendMessageToGroupAllEnv(msg);
						console.log(`New announcement sent: ${announcement.title}`);
						await new Promise((resolve) => setTimeout(resolve, 30 * 1000)); // 爬取到东西，休息30秒
					} else {
						// console.log(`Announcement already exists: ${announcement.title}`);
					}
				}
				const isSuccess = Boolean(announcements?.length);
				this.report({
					key: `OkxExNewsCrawler-${proxy.ip}`,
					ip: proxy.ip,
					isSuccess,
					error: isSuccess ? null : new Error(`OkxExNewsCrawler error: 没拿到数据 ${proxy.ip}`),
				});
			} catch (error) {
				this.report({
					key: `OkxExNewsCrawler-${proxy.ip}`,
					ip: proxy.ip,
					isSuccess: false,
					error: error?.message,
				});
				console.error(`OkxExNewsCrawler error:`, error?.message, proxy.ip, Date.now());
			} finally {
				await browser.close(); // 每次爬取完成后关闭浏览器
			}
			
			await new Promise((resolve) => setTimeout(resolve, 1000)); // 延时1000ms
		}
	}
	
	async startCrawling() {
		while (true) {
			try {
				await this.crawlNews();
			} catch (error) {
				console.error('OkxExNewsCrawler Error during startCrawling:', error, Date.now());
			}
		}
	}
}

module.exports = new OkxExNewsCrawler();
