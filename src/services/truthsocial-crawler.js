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
			const { browser, page, proxy } = await this.initProxyBrowserAndPage('japan');
			
			try {
				await page.goto(url, { timeout: 30000 });
				
				// 使用更可靠的选择器定义方式
				const containerSelector = 'div[data-test-id="virtuoso-item-list"]';
				await page.waitForSelector(containerSelector, { timeout: 30000 });
				
				// 优化后的自动滚动加载逻辑
				const loadedItems = await page.evaluate((containerSelector) => {
					const collectedItems = new Map();
					let lastItemCount = 0;
					let retryCount = 0;
					
					const scrollContainer = document.querySelector(containerSelector);
					if (!scrollContainer) throw new Error('Scroll container not found');
					
					return new Promise(resolve => {
						const checkInterval = setInterval(() => {
							// 获取当前所有可见元素
							const elements = Array.from(
								scrollContainer.querySelectorAll('div[data-index]')
							);
							
							// 收集新元素
							elements.forEach(el => {
								const index = el.getAttribute('data-index');
								if (!collectedItems.has(index)) {
									collectedItems.set(index, el.outerHTML);
								}
							});
							
							// 满足条件时终止
							if (collectedItems.size >= 5 || retryCount >= 20) {
								clearInterval(checkInterval);
								resolve(Array.from(collectedItems.values()).slice(0, 5));
							}
							
							// 智能滚动策略
							if (elements.length > lastItemCount) {
								lastItemCount = elements.length;
								retryCount = 0; // 重置重试计数器
								// 滚动到当前最后一个元素的底部
								elements[elements.length - 1].scrollIntoView({
									behavior: 'smooth',
									block: 'end'
								});
							} else {
								retryCount++;
							}
							
						}, 1000); // 每秒检查一次
					});
					
				}, containerSelector); // 注意这里参数传递方式的修正
				
				// 处理收集到的元素
				let announcements = await page.evaluate((itemsHTML, type) => {
					const parser = new DOMParser();
					return itemsHTML.map(html => {
						const doc = parser.parseFromString(html, 'text/html');
						const title = doc.querySelector('.flex.flex-col.space-y-4')?.innerText?.trim();
						if (!title) return null;
						
						return {
							title,
							newsUrl: `https://truthsocial.com/@realDonaldTrump?key=${encodeURIComponent(title).slice(0, 50)}`,
							type,
							crawlTime: Date.now()
						};
					}).filter(item => item !== null);
					
				}, loadedItems, type);
				
				for (const announcement of announcements) {
					const exists = await EXNews.findOne({ where: { newsUrl: announcement?.newsUrl } });
					if (!exists) {
						await EXNews.create(announcement);
						const msg = `${announcement.title} [🔗 Read More](${announcement.newsUrl})`;
						await StatisticsCrawler.sendMessageToGroupDev(msg);
						console.log(`New announcement sent: ${announcement.title}`);
					} else {
						// 忽略已经存在的公告
					}
				}
				console.log(`TruthsocialCrawler crawlNews done: ${announcements?.length}`, JSON.stringify(announcements));
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
