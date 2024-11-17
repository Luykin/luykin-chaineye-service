const { EXNews } = require('../models');
const BaseCrawler = require('./base-crawler');
class ExNewsCrawler extends BaseCrawler {
	constructor() {
		super();
		this.browser = null;
		this.binancePage = null; // 爬取币安公告
	}
	async crawlBinanceNews() {
		try {
			const pageInstance = await this.safeInitPage('binancePage');
			const url = `https://www.binance.com/en/support/announcement/new-cryptocurrency-listing?c=48&navId=48&hl=en`;
			console.log('正在打开网页', url);
			await pageInstance?.goto(url, {
				waitUntil: 'networkidle0',
				timeout: 20000 // 设置超时
			});
			const is404 = await pageInstance.evaluate(() => {
				return !!document.querySelector('.not-fount-container .not-fount-image');
			});
			if (is404) {
				console.log('找不到公告，返回空数组');
				return [];
			}
			await pageInstance.waitForSelector('#app-wrap');
			// 从 #app-wrap 开始提取内容
			const announcements = await pageInstance.evaluate(() => {
				const appWrap = document.querySelector('#app-wrap');
				if (!appWrap) return [];
				
				// 获取所有公告链接
				const links = appWrap.querySelectorAll('section a[data-bn-type="link"]');
				const results = [];
				
				links.forEach(link => {
					const title = link.querySelector('div[data-bn-type="text"]')?.innerText.trim();
					const date = link.querySelector('h6[data-bn-type="text"]')?.innerText.trim();
					const href = link.getAttribute('href');
					
					if (title && date && href) {
						results.push({
							title,
							timestamp: date,
							newsUrl: href,
							type: 'binance_cryptocurrency'
						});
					}
				});
				
				return results;
			});
			console.log('Announcements:', announcements.length);
			// 批量存储到数据库
			await bulkStoreAnnouncements(announcements);
		} catch (err) {
			console.log(err);
		}
	}
}
// 批量存储公告数据到数据库
async function bulkStoreAnnouncements(data) {
	try {
		await EXNews.bulkCreate(data, {
			updateOnDuplicate: ['title', 'timestamp', 'newsUrl', 'type'], // 指定需要更新的字段
		});
		
		console.log('Announcements saved successfully');
	} catch (error) {
		console.error('Error saving announcements:', error);
	}
}
module.exports = new ExNewsCrawler();
