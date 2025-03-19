const StatisticsCrawler = require('./StatisticsCrawler');  // 确保继承 StatisticsCrawler
const { EXNews } = require('../models/sqlite-start');

class TruthsocialCrawler extends StatisticsCrawler {
	constructor() {
		super();
	}
	
	async crawlNews() {
		const tabUrls = [
			{
				url: 'https://truthsocial.com/@realDonaldTrump',
				type: 'truthsocial_trump',
			},
		];
		
		for (const { url, type } of tabUrls) {
			const { browser, page, proxy } = await this.initProxyBrowserAndPage();
			
			try {
				await page.goto(url, { timeout: 30000 });
				await page.waitForSelector('div[data-test-id=\'virtuoso-item-list\']', { timeout: 30000 });
				
				// 获取Truthsocial数据
				let announcements = await page.evaluate((type) => {
					const links = document.querySelectorAll('div[data-test-id=\'virtuoso-item-list\'] div[data-index]') || [];
					const results = [];
					links.forEach((link, index) => {
						if (index >= 2) return; // 只取前两条
						const title = link.querySelector('.flex.flex-col.space-y-4')?.innerText?.trim() || '';
						const href = `https://truthsocial.com/@realDonaldTrump?key=${encodeURIComponent(title).slice(0, 50)}`;
						
						if (title && href) {
							results.push({
								title,
								newsUrl: href,
								type,
								crawlTime: +new Date()
							});
						}
					});
					return results;
				}, type);
				
				for (const announcement of announcements) {
					const exists = await EXNews.findOne({ where: { newsUrl: announcement?.newsUrl } });
					if (!exists) {
						await EXNews.create(announcement);
						const msg = `${announcement.title} [🔗 Read More](${announcement.newsUrl})`;
						await StatisticsCrawler.sendMessageToGroupDev(msg);
						console.log(`New announcement sent: ${announcement.title}`);
						await new Promise((resolve) => setTimeout(resolve, 60 * 1000)); // 爬取到东西，休息60秒
					} else {
						// 忽略已经存在的公告
					}
				}
				const isSuccess = Boolean(announcements?.length);
				this.report({
					key: `TruthsocialCrawler-${proxy.ip}`,
					ip: proxy.ip,
					isSuccess,
					error: isSuccess ? null : new Error(`TruthsocialCrawler error: 没拿到数据 ${proxy.ip}`),
				});
			} catch (error) {
				this.report({
					key: `TruthsocialCrawler-${proxy.ip}`,
					ip: proxy.ip,
					isSuccess: false,
					error: error?.message,
				});
				console.error(`TruthsocialCrawler error:`, error?.message, proxy.ip, Date.now());
			} finally {
				await browser.close(); // 每次爬取完成后关闭浏览器
			}
			
			await new Promise((resolve) => setTimeout(resolve, 5000)); // 延时5s
		}
	}
	
	async startCrawling() {
		while (true) {
			try {
				await this.crawlNews();
			} catch (error) {
				console.error('TruthsocialCrawler Error during startCrawling:', error, Date.now());
			}
		}
	}
}

module.exports = new TruthsocialCrawler();
