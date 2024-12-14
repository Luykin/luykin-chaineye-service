const puppeteer = require('puppeteer');

class BaseCrawler {
	constructor() {
		this.browser = null;
	}
	
	async initBrowser() {
		if (!this.browser) {
			console.log('初始化浏览器...');
			this.browser = await puppeteer.launch({
				headless: 'new',
				args: [
					'--no-sandbox',
					'--disable-setuid-sandbox'
				]
			});
		}
	}
	
	/**
	 * 强制关闭浏览器
	 * **/
	async forceClose() {
		try {
			await this.browser?.close?.();
			this.browser = null;
			console.log('已经强制关闭浏览器...');
		} catch (err) {
			console.error('Error closing browser:', err);
		}
	}
	
	async safeInitPage(key) {
		if (!key) {
			throw new Error('safeInitPage 没有填写key');
		}
		await this.initBrowser();
		if (this[key] && this[key]?.close) {
			try {
				this[key]?.close?.();
				this[key] = null;
			} catch (err) {
				this[key] = null;
			}
		}
		console.log(`安全的初始化浏览器网页${key}, 请等待...`);
		this[key] = await this.browser.newPage();
		await this[key].setExtraHTTPHeaders({
			'Accept-Encoding': 'gzip' // 使用gzip压缩让数据传输更快
		});
		const userAgent = getRandomUserAgent();
		await this[key].setUserAgent(userAgent);
		await this[key].setCacheEnabled(false);
		return this[key];
	}
}

module.exports = BaseCrawler;

function getRandomUserAgent() {
	// 随机生成浏览器版本号
	const majorVersion = Math.floor(Math.random() * 20) + 90; // Chrome 版本号 (90-110)
	const minorVersion = Math.floor(Math.random() * 3000) + 1000; // 次版本号 (1000-4000)
	const patchVersion = Math.floor(Math.random() * 100); // 补丁版本 (0-99)
	
	// 随机生成平台
	const platforms = [
		`(Windows NT ${Math.floor(Math.random() * 5) + 10}.0; Win64; x64)`, // Windows 10+
		`(Macintosh; Intel Mac OS X 10_${Math.floor(Math.random() * 4) + 12}_${Math.floor(Math.random() * 10)})`, // macOS 10.12+
		`(X11; Linux x86_64)`, // Linux
		`(Linux; Android ${Math.floor(Math.random() * 3) + 9}; Pixel ${Math.floor(Math.random() * 6) + 3})`, // Android 9+
		`(iPhone; CPU iPhone OS ${Math.floor(Math.random() * 4) + 13}_0 like Mac OS X)` // iOS 13+
	];
	const platform = platforms[Math.floor(Math.random() * platforms.length)];
	
	// 构造 User-Agent 字符串
	return `Mozilla/5.0 ${platform} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion}.${minorVersion}.${patchVersion} Safari/537.36`;
}
