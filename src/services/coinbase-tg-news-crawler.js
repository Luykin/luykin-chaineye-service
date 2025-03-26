const StatisticsCrawler = require('./StatisticsCrawler'); // 复用你现有的基础爬虫类
const { EXNews } = require('../models/sqlite-start');

class TwitterUserCrawler extends StatisticsCrawler {
	constructor() {
		super();
		this.authTokens = [
			'128cc3db75c84a4e0283c422f88b161bac148fed',
			'ee0812d03101cb9da6b86a45dd09a50f56b6e4ac',
			// '2a886be958787c0ab07621ad1feeae2a8ef3d338',
			'1bf3e515e18b784a907ebb26eac492555641afe3',
			'ec759e4eb590399ad7c838cd95b48181ac1ac6dc',
			'7dd17ca8557dfa0ba000259867d44475777c696b' // 自己的某个账号
		];
		this.currentTokenIndex = 0; // 当前 token 索引
	}
	
	// 设置 auth_token 登录状态
	async setAuthToken(page) {
		const token = this.authTokens[this.currentTokenIndex];
		const cookie = {
			name: 'auth_token',
			value: token,
			domain: '.twitter.com',
			path: '/',
			expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7天有效期
			httpOnly: true,
			secure: true,
		};
		await page.setCookie(cookie);
		// console.log(`Using auth token: ${token}`);
	}
	
	// 爬取推文数据
	async crawlTweets() {
		const url = `https://x.com/CoinbaseAssets`;
		const { browser, page, proxy } = await this.initProxyBrowserAndPage();
		try {
			await this.setAuthToken(page); // 设置登录状态
			await page.goto(url, { timeout: 35000, waitUntil: 'networkidle2' });
			await page.waitForSelector('article', { timeout: 30000 }); // 等待推文加载
			
			// 提取推文内容
			const tweets = await page.evaluate(() => {
				const results = [];
				document.querySelectorAll('article').forEach((tweet, index) => {
					if (index >= 2) return; // 只取前两条
					const textElement = tweet.querySelector('[data-testid="tweetText"]');
					const timeElement = tweet.querySelector('time');
					const linkElement = tweet.querySelector('a[href*="/status/"]');
					
					let text = textElement?.innerText?.trim() || '';
					const time = timeElement?.getAttribute('datetime') || '';
					const url = linkElement?.href || '';
					// 去除 text 中的换行符和多余空格
					text = text.replace(/[\n\r]+/g, ' ').trim();
					if (text && url) {
						results.push({
							text,
							timestamp: time,
							newsUrl: url + '/#',
							type: 'coinbase_support',
							crawlTime: +new Date(),
						});
					}
				});
				return results;
			});
			// 数据存储到数据库并发送消息
			for (const tweet of tweets) {
				if (containsCoinbaseSupport(tweet.text)) {
					const exists = await EXNews.findOne({ where: { newsUrl: tweet?.newsUrl } });
					if (!exists) {
						await EXNews.create(tweet);
						const msg = `${tweet.text} [🔗 Read More](${tweet.newsUrl})`;
						await StatisticsCrawler.sendMessageToGroupAllEnv(msg);
						console.log(`New tweet saved: ${tweet.text}`);
						// await new Promise((resolve) => setTimeout(resolve, 30 * 1000)); // 爬取到东西，休息30秒
					} else {
						console.log(`Tweet already exists: ${tweet.newsUrl}`);
					}
				}
			}
			const isSuccess = Boolean(tweets?.length);
			this.report({
				key: `CoinBase-TwitterUserCrawler-${proxy.ip}`,
				ip: proxy.ip,
				isSuccess,
				error: isSuccess ? null : new Error(`CoinBase-TwitterUserCrawler error: 没拿到数据 ${proxy.ip}`),
			});
		} catch (error) {
			this.report({
				key: `CoinBase-TwitterUserCrawler-${proxy.ip}`,
				ip: proxy.ip,
				isSuccess: false,
				error: error?.message,
			});
			console.error(`CoinBase-TwitterUserCrawler error:`, error?.message, proxy.ip, this.authTokens[this.currentTokenIndex], Date.now());
		} finally {
			await browser.close();
			this.switchAuthToken();
		}
		await new Promise((resolve) => setTimeout(resolve, 15 * 1000)); // 15s间隔
	}
	
	// 切换到下一个 auth_token
	switchAuthToken() {
		this.currentTokenIndex = (this.currentTokenIndex + 1) % this.authTokens.length;
		// console.log(`Switched to next auth token: ${this.authTokens[this.currentTokenIndex]}`);
	}
	
	// 启动爬取任务，间隔10分钟
	async startCrawling() {
		while (true) {
			try {
				await this.crawlTweets();
			} catch (error) {
				console.error('CoinBase-TwitterUserCrawler Error during startCrawling:', error, Date.now());
				await new Promise((resolve) => setTimeout(resolve, 1000)); // 延时500ms
			}
		}
	}
}

// function containsCoinbaseSupport(str) {
// 	// if (Date.now() < 1734969996644) {
// 	// 	return true;
// 	// }
// 	// 去除所有空格并忽略大小写
// 	const normalizedStr = str.replace(/\s+/g, '').toLowerCase();
// 	return /coinbasewilladdsupport/.test(normalizedStr);
// }
function containsCoinbaseSupport(str) {
	// 去除所有空格并忽略大小写
	const normalizedStr = str.replace(/\s+/g, '').toLowerCase();
	
	// 检查是否以 'coinbasewill' 开头
	return normalizedStr.startsWith('coinbasewilladdsupport');
}

module.exports = new TwitterUserCrawler();
