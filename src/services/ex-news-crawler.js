const { EXNews } = require('../models');
const BaseCrawler = require('./base-crawler');

class ExNewsCrawler extends BaseCrawler {
	constructor() {
		super();
		this.browser = null;
		this.binancePage = null; // 爬取币安公告页面
	}

	// 判断当前是否在高频爬取时间范围
	isInHighFrequencyPeriod() {
		const now = new Date();
		const minutes = now.getMinutes();
		const seconds = now.getSeconds();

		/**
		 * 整10分 前后各30s 启动高频爬取模式
		 * **/
		return (
			(minutes % 10 === 9 && seconds >= 30) ||
			(minutes % 10 === 0 && seconds <= 30)
		);
	}

	// 主爬取逻辑
	async crawlBinanceNews() {
		try {
			// 初始化页面
			const pageInstance = await this.safeInitPage('binancePage');

			// 定义爬取的 Tab 和类型
			const tabUrls = [
				{
					url: 'https://www.binance.com/en/support/announcement/c-48?navId=48',
					type: 'binance_cryptocurrency',
				},
				{
					url: 'https://www.binance.com/en/support/announcement/c-51?navId=51&hl=en',
					type: 'binance_api',
				},
				{
					url: 'https://www.binance.com/en/support/announcement/c-128?navId=128&hl=en',
					type: 'binance_airdrop',
				},
			];

			// 遍历每个 Tab 页面
			for (const { url, type } of tabUrls) {
				console.log(type, `正在打开网页: ${url}`);
				await pageInstance?.goto(url, {
					waitUntil: 'networkidle0',
					timeout: 20000, // 设置超时
				});

				const is404 = await pageInstance.evaluate(() => {
					return !!document.querySelector('.not-fount-container .not-fount-image');
				});

				if (is404) {
					console.log(`找不到 ${type} 公告，跳过`);
					continue;
				}

				await pageInstance.waitForSelector('#app-wrap');

				// 从 #app-wrap 开始提取内容
				const announcements = await pageInstance.evaluate((type) => {
					const appWrap = document.querySelector('#app-wrap');
					if (!appWrap) return [];

					// 获取所有公告链接
					const links = appWrap.querySelectorAll('section a[data-bn-type="link"]');
					const results = [];

					links.forEach((link) => {
						const title = link.querySelector('div[data-bn-type="text"]')?.innerText.trim();
						const date = link.querySelector('h6[data-bn-type="text"]')?.innerText.trim();
						const href = link.getAttribute('href');

						if (title && date && href) {
							results.push({
								title,
								timestamp: date,
								newsUrl: href,
								type,
							});
						}
					});

					return results;
				}, type);

				console.log(`从 ${type} 爬取到 ${announcements.length} 条公告`);

				// 批量存储到数据库
				await bulkStoreAnnouncements(announcements);
			}
		} catch (err) {
			console.error('Error during crawling:', err);
		}
	}

	// 无限循环执行爬取任务
	async startCrawling() {
		while (true) {
			const isFastMode = this.isInHighFrequencyPeriod();

			console.log(isFastMode ? '快速模式：500ms 一次' : '普通模式：5s 一次');

			await this.crawlBinanceNews(); // 执行爬取任务

			// 根据模式设置不同的间隔
			const delay = isFastMode ? 500 : 5000;
			await new Promise((resolve) => setTimeout(resolve, delay));
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
