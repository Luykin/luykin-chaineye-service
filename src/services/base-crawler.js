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
			this[key]?.close?.();
			this[key] = null;
		}
		console.log(`安全的初始化浏览器网页${key}, 请等待...`);
		this[key] = await this.browser.newPage();
		await this[key].setExtraHTTPHeaders({
			'Accept-Encoding': 'gzip' // 使用gzip压缩让数据传输更快
		});
		// await this[key].setCacheEnabled(false); // 禁用缓存
		return this[key];
	}
}
module.exports = BaseCrawler;
