const { EXNews } = require('../models');
const BaseCrawler = require('./base-crawler');
const TelegramBot = require('node-telegram-bot-api');
// 替换为你的 API Token 和群组 Chat ID
const tgToken = '7369047814:AAHv7OQffIzszIdwKCTVzjP349ZhsItVpm0';
const tgGroupChatId = '-1002295668714';

const tgBot = new TelegramBot(tgToken);

function formatBinanceLink(link) {
	const baseUrl = 'https://www.binance.com';
	
	if (!link.startsWith('http')) {
		// 确保拼接时不会有重复的 /
		return `${baseUrl.replace(/\/$/, '')}/${link.replace(/^\//, '')}`;
	}
	
	return link;
}

const sendMessageToGroup = async (message, form = {}) => {
	try {
		await tgBot.sendMessage(tgGroupChatId, message, form);
		console.log('Message sent successfully!');
	} catch (error) {
		console.error('Error sending message:', error);
	}
};

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
	async crawlBinanceNews(pageInstance) {
		try {
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
				// console.log(type, `正在打开网页: ${url}`);
				await pageInstance?.goto(url, {
					waitUntil: 'networkidle0',
					timeout: 20000, // 设置超时
				});
				
				const is404 = await pageInstance.evaluate(() => {
					return !!document.querySelector('.not-fount-container .not-fount-image');
				});
				
				if (is404) {
					// console.log(`找不到 ${type} 公告，跳过`);
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
				
				// 批量存储到数据库
				await bulkStoreAnnouncements(announcements);
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		} catch (err) {
			console.error('Error during crawling:', err);
		}
	}
	
	// 无限循环执行爬取任务
	async startCrawling() {
		let whileCount = 0;
		let pageInstance = await this.safeInitPage('binancePage');
		while (true) {
			const isFastMode = this.isInHighFrequencyPeriod();
			
			await this.crawlBinanceNews(pageInstance); // 执行爬取任务
			whileCount++;
			if (whileCount > 10) {
				pageInstance = await this.safeInitPage('binancePage');
				whileCount = 0;
			}
			/**
			 * 7 - 17秒随机的一个值
			 * **/
			const delay = isFastMode ? 400 : Math.floor(Math.random() * (17000 - 7000 + 1) + 7000);
			await new Promise((resolve) => setTimeout(resolve, delay));
			console.log(`等待${delay}ms完毕，下一次开始执行`, isFastMode);
		}
	}
}

async function bulkStoreAnnouncements(data) {
	try {
		// 获取所有已经存在的 newsUrl
		const existingUrls = await EXNews.findAll({
			where: {
				newsUrl: data.map(item => item.newsUrl),
			},
			attributes: ['newsUrl'],
		});
		
		const existingUrlSet = new Set(existingUrls.map(record => record.newsUrl));
		
		// 筛选出未存在于数据库的记录
		const newRecords = data.filter(item => !existingUrlSet.has(item.newsUrl));
		
		// 如果没有新记录，直接返回
		if (newRecords.length === 0) {
			// console.log('No new announcements to save.');
			return;
		}
		
		// 筛选出需要更新的字段
		const fieldsToUpdate = ['title', 'timestamp', 'type', 'newsUrl'];
		
		await EXNews.bulkCreate(newRecords, {
			updateOnDuplicate: fieldsToUpdate, // 指定在冲突时需要更新的字段
		});
		
		// 获取新记录中时间戳最大的记录作为最新记录
		const latestRecord = newRecords.reduce((latest, record) => {
			return new Date(record.timestamp) > new Date(latest.timestamp) ? record : latest;
		}, newRecords[0]);
		if (latestRecord && latestRecord?.title) {
			const message = `🚀 <b>${latestRecord.title}</b>`;
			const formattedLink = formatBinanceLink(latestRecord.newsUrl);
			await sendMessageToGroup(message, {
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '🔗 Read More',
								url: formattedLink,
							},
						],
					],
				},
			});
		}
	} catch (error) {
		console.error('Error saving announcements:', error);
		throw error; // 抛出错误以便调用方处理
	}
}

module.exports = new ExNewsCrawler();
