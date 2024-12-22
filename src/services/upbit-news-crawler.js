const BaseCrawler = require('./base-crawler');  // 确保继承 BaseCrawler
const { EXNews } = require('../models/sqlite-start');

class UpbitExNewsCrawler extends BaseCrawler {
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
				await page.goto(url, { timeout: 20000 });
				await page.waitForSelector('body', { timeout: 10000 });
				
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
						await BaseCrawler.sendMessageToGroupDev(msg);
						console.log(`New announcement sent: ${announcement.title}`);
						await new Promise((resolve) => setTimeout(resolve, 30 * 1000)); // 爬取到东西，休息30秒
					} else {
						// 忽略已经存在的公告
					}
				}
			} catch (error) {
				console.error(`UpbitExNewsCrawler error:`, error, proxy.ip, Date.now());
			} finally {
				await browser.close(); // 每次爬取完成后关闭浏览器
			}
			
			await new Promise((resolve) => setTimeout(resolve, 3000)); // 延时3s
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
