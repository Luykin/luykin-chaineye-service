const StatisticsCrawler = require('./StatisticsCrawler');  // 确保继承 StatisticsCrawler
const { EXNews } = require('../models/sqlite-start');

class UpbitExNewsCrawler extends StatisticsCrawler {
	constructor() {
		super();
	}
	
	async crawlNews() {
		const tabUrls = [
			{
				url: 'https://api-manager.upbit.com/api/v1/announcements/search?search=Market%20Support%20for&page=1&per_page=20&category=all&os=web',
				type: 'upbit_cryptocurrency',
			},
		];
		
		for (const { url, type } of tabUrls) {
			const { browser, page, proxy } = await this.initProxyBrowserAndPage();
			
			try {
				await page.goto(url, { timeout: 30000 });
				await page.waitForSelector('body', { timeout: 30000 });
				
				// 获取Upbit的公告数据
				let announcements = await page.evaluate((type) => {
					const appWrap = document.querySelector('body');
					let ret = {};
					try {
						ret = JSON.parse(appWrap.innerText);
					} catch (err) {
						ret = {
							success: false, data: {
								notices: [],
							}
						};
					}
					return ret?.data?.notices || [];
				}, type);
				
				// 格式化链接
				announcements = announcements.filter(_ => !!_?.id).map(_ => ({
					title: _.title,
					timestamp: _.listed_at,
					newsUrl: `https://upbit.com/service_center/notice?id=${_?.id}`,
					type,
					crawlTime: +new Date()
				})).slice(0, 2);
				for (const announcement of announcements) {
					const exists = await EXNews.findOne({ where: { newsUrl: announcement?.newsUrl } });
					if (!exists) {
						await EXNews.create(announcement);
						const msg = `${announcement.title} [🔗 Read More](${announcement.newsUrl})`;
						await StatisticsCrawler.sendMessageToGroupDev(msg);
						console.log(`New announcement sent: ${announcement.title}`);
						// await new Promise((resolve) => setTimeout(resolve, 30 * 1000)); // 爬取到东西，休息30秒
					} else {
						// 忽略已经存在的公告
					}
				}
				const isSuccess = Boolean(announcements?.length);
				this.report({
					key: `UpbitExNewsCrawler-${proxy.ip}`,
					ip: proxy.ip,
					isSuccess,
					error: isSuccess ? null : new Error(`UpbitExNewsCrawler error: 没拿到数据 ${proxy.ip}`),
				});
			} catch (error) {
				this.report({
					key: `UpbitExNewsCrawler-${proxy.ip}`,
					ip: proxy.ip,
					isSuccess: false,
					error: error?.message,
				});
				console.error(`UpbitExNewsCrawler error:`, error?.message, proxy.ip, Date.now());
			} finally {
				await browser.close(); // 每次爬取完成后关闭浏览器
			}
			
			await new Promise((resolve) => setTimeout(resolve, 1000)); // 延时1s
		}
	}
	
	async startCrawling() {
		while (true) {
			try {
				await this.crawlNews();
			} catch (error) {
				console.error('UpbitExNewsCrawler Error during startCrawling:', error, Date.now());
			}
		}
	}
}

module.exports = new UpbitExNewsCrawler();
