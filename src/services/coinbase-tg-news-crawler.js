const BaseCrawler = require('./base-crawler'); // 复用你现有的基础爬虫类
const { EXNews } = require('../models/sqlite-start');

class TwitterUserCrawler extends BaseCrawler {
	constructor() {
		super();
		this.authToken = '7dd17ca8557dfa0ba000259867d44475777c696b'; // 替换为实际 auth_token
	}
	
	// 设置 auth_token 登录状态
	async setAuthToken(page) {
		const cookie = {
			name: 'auth_token',
			value: this.authToken,
			domain: '.twitter.com',
			path: '/',
			expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7天有效期
			httpOnly: true,
			secure: true,
		};
		await page.setCookie(cookie);
	}
	
	// 爬取推文数据
	async crawlTweets() {
		const url = `https://x.com/CoinbaseAssets`;
		const { browser, page, proxy } = await this.initProxyBrowserAndPage();
		console.log('Using proxy:', proxy, url)
		try {
			await this.setAuthToken(page); // 设置登录状态
			await page.goto(url, { timeout: 35000, waitUntil: 'networkidle2' });
			await page.waitForSelector('article', { timeout: 10000 }); // 等待推文加载
			
			// 提取推文内容
			const tweets = await page.evaluate(() => {
				const results = [];
				document.querySelectorAll('article').forEach((tweet, index) => {
					if (index >= 2) return; // 只取前两条
					const textElement = tweet.querySelector('[data-testid="tweetText"]');
					const timeElement = tweet.querySelector('time');
					const linkElement = tweet.querySelector('a[href*="/status/"]');
					
					const text = textElement?.innerText?.trim() || '';
					const time = timeElement?.getAttribute('datetime') || '';
					const url = linkElement?.href || '';
					
					if (text && url) {
						results.push({
							text,
							timestamp: time,
							newsUrl: url,
							type: 'twitter_post',
							crawlTime: +new Date(),
						});
					}
				});
				return results;
			});
			console.log('Tweets:', tweets);
			// 数据存储到数据库并发送消息
			for (const tweet of tweets) {
				const exists = await EXNews.findOne({ where: { newsUrl: tweet?.newsUrl } });
				if (!exists) {
					await EXNews.create(tweet);
					await BaseCrawler.sendMessageToGroup(
						`📢 ${tweet.text} [🔗 阅读详情](${tweet.newsUrl})`
					);
					console.log(`New tweet saved: ${tweet.text}`);
				} else {
					console.log(`Tweet already exists: ${tweet.newsUrl}`);
				}
			}
		} catch (error) {
			console.error(`Error crawling tweets with proxy ${proxy?.ip}:`, error.message);
		} finally {
			await browser.close();
		}
	}
	
	// 启动爬取任务，间隔10秒
	async startCrawling() {
		while (true) {
			try {
				await this.crawlTweets();
			} catch (error) {
				console.error('Error during startCrawling:', error.message);
			}
			await new Promise((resolve) => setTimeout(resolve, 10 * 1000)); // 2分钟间隔
		}
	}
}

module.exports = new TwitterUserCrawler();
