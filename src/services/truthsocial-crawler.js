const StatisticsCrawler = require('./StatisticsCrawler');  // 确保继承 StatisticsCrawler
const { EXNews } = require('../models/sqlite-start');
function processElement(el) {
	// 提取标题文本并去除多余空格和换行
	const rawText = el.querySelector('.flex.flex-col.space-y-4')?.innerText?.trim();
	try {
		if (!rawText) return ''; // 如果没有找到文本，直接返回空字符串

		// 处理多余的空格和换行
		const cleanedText = rawText
			.replace(/\s+/g, ' ') // 将多个空格替换为单个空格
			.replace(/\n+/g, '\n') // 将多个换行替换为单个换行
			.trim(); // 去除首尾空白

		// 查找 video 标签及其子标签 source 的 src 属性
		const videoElements = el.querySelectorAll('video, video source');
		const videoSrcs = Array.from(videoElements)
			.map(videoEl => videoEl.src || videoEl.getAttribute('src')) // 获取 src 属性
			.filter(src => src); // 过滤掉空值

		// 组装最终文本
		let finalText = cleanedText;
		if (videoSrcs.length > 0) {
			const videoLinks = videoSrcs.map(src => `Video Source: ${src}`).join('\n');
			finalText += `\n\n${videoLinks}`;
		}

		return finalText;
	} catch (err) {
		return rawText;
	}
}

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
			const { browser, page, proxy } = await this.initProxyBrowserAndPage("japan");
			
			try {
				await page.goto(url, { timeout: 30000 });
				
				// 使用更可靠的选择器定义方式
				const containerSelector = 'div[data-test-id=\'virtuoso-item-list\']';
				await page.waitForSelector(containerSelector, { timeout: 30000 });
				
				// 用于存储完整数据的数组
				const announcements = [];
				const collectedIndices = new Set();
				// let lastMaxIndex = -1;
				let retryCount = 0;
				const maxRetries = 5;
				
				while (announcements.length < 5 && retryCount < maxRetries) {
					// 获取当前可见元素的数据和索引
					const newData = await page.evaluate(containerSelector => {
						return Array.from(document.querySelectorAll(
							`${containerSelector} div[data-index]`
						)).map(el => {
							const index = parseInt(el.getAttribute('data-index'));
							const title = processElement(el);
							return {
								index,
								title: title || null,
								// html: el.outerHTML // 保存完整HTML片段
							};
						});
					}, containerSelector);
					
					// 处理新数据
					newData.forEach(item => {
						if (!collectedIndices.has(item.index) && item.title) {
							collectedIndices.add(item.index);
							announcements.push({
								title: item.title,
								index: item.index,
								newsUrl: `https://truthsocial.com/@realDonaldTrump?key=${encodeURIComponent(item?.title).slice(0, 50)}`,
								type,
								crawlTime: Date.now()
							});
						}
					});
					
					retryCount++;
					
					// 智能滚动策略
					await page.evaluate(containerSelector => {
						const lastElement = document.querySelector(
							`${containerSelector} div[data-index]:last-child`
						);
						if (lastElement) {
							lastElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
						}
						setTimeout(() => {
							window.scrollBy({
								top: 500,
								behavior: 'smooth'
							});
						}, 500);
					}, containerSelector);
					
					// 等待元素渲染和网络请求
					await new Promise((resolve) => setTimeout(resolve, 1200));
				}
				
				for (const announcement of announcements) {
					const exists = await EXNews.findOne({ where: { newsUrl: announcement?.newsUrl } });
					if (!exists) {
						await EXNews.create(announcement);
						const msg = `${announcement.title} [🔗 Read More](${announcement.newsUrl})`;
						await StatisticsCrawler.sendMessageToGroupDev(msg);
						console.log(`New announcement sent: ${announcement.title}`);
						await new Promise((resolve) => setTimeout(resolve, 500));
					} else {
						// 忽略已经存在的公告
					}
				}
				console.log(`TruthsocialCrawler crawlNews done: ${announcements?.length}`);
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
