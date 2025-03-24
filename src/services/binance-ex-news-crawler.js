const { EXNews } = require('../models/sqlite-start');
const StatisticsCrawler = require('./StatisticsCrawler');

function formatBinanceLink(link) {
	const baseUrl = 'https://www.binance.com';
	
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
		'binance will list',
		'binance futures will launch',
		'hodler airdrops',
		'introducing',
		'binance launchpool',
		'binance Pool supports'
	];
	
	// 检查标题是否以指定的前缀之一开头
	for (let prefix of validPrefixes) {
		if (normalizedTitle.includes(prefix)) {
			return true;
		}
	}
	
	return false;
}

class BinanceExNewsCrawler extends StatisticsCrawler {
	constructor() {
		super();
	}
	
	// https://www.binance.com/bapi/apex/v1/public/apex/cms/article/list/query?type=1&pageNo=3&pageSize=10&catalogId=48
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
			const { browser, page, proxy } = await this.initProxyBrowserAndPage("singapore");
			try {
				await page.goto(url, { timeout: 30000 });
				// 等待 links 元素加载
				await page.waitForSelector('.bn-flex.flex-col.gap-6.px-4.py-6', { timeout: 30000 });
				let announcements = await page.evaluate((type) => {
					const appWrapClass = '.bn-flex.flex-col.gap-6.px-4.py-6';
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
					if (!exists && validateTitle(announcement.title)) {
						await EXNews.create(announcement);
						const msg = `${announcement.title} [🔗 Read More](${announcement.newsUrl})`;
						await StatisticsCrawler.sendMessageToGroupAllEnv(msg);
						console.log(`New announcement sent: ${announcement.title}`);
					} else {
						// if (+new Date() < 1734363916566) {
						// 	console.log(`Announcement already exists: ${announcement.title}`);
						// }
					}
				}
				const isSuccess = Boolean(announcements?.length);
				this.report({
					key: `BinanceExNewsCrawler-${proxy.ip}`,
					ip: proxy.ip,
					isSuccess,
					error: isSuccess ? null : new Error(`BinanceExNewsCrawler error: 没拿到数据 ${proxy.ip}`),
				});
			} catch (error) {
				this.report({
					key: `BinanceExNewsCrawler-${proxy.ip}`,
					ip: proxy.ip,
					isSuccess: false,
					error: error?.message,
				});
				console.error(`BinanceExNewsCrawler error:`, error?.message, proxy.ip, Date.now());
			} finally {
				await browser.close(); // 每次爬取完成后关闭浏览器
			}
			
			await new Promise((resolve) => setTimeout(resolve, 1000)); // 延时500ms
		}
	}
	
	async startCrawling() {
		while (true) {
			try {
				await this.crawlNews();
			} catch (error) {
				console.error('BinanceExNewsCrawler Error during startCrawling:', error, Date.now());
			}
		}
	}
	
	// https://www.binance.com/bapi/apex/v1/public/apex/cms/article/list/query?type=1&pageNo=3&pageSize=10&catalogId=48
	// generateBinanceUrl(title, uniqueId) {
	// 	const baseUrl = "https://www.binance.com/en/support/announcement/";
	// 	// 将标题转换为小写并替换空格、特殊字符等
	// 	const slug = title
	// 		.trim()
	// 		.toLowerCase()
	// 		.replace(/[^a-z0-9\s]/g, "") // 移除非字母数字的字符
	// 		.replace(/\s+/g, "-"); // 替换空格为短横线
	//
	// 	// 拼接最终的 URL
	// 	return `${baseUrl}${slug}-${uniqueId}`;
	// }
}

module.exports = new BinanceExNewsCrawler();
