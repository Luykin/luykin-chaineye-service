const puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');
const tgToken = '7369047814:AAHv7OQffIzszIdwKCTVzjP349ZhsItVpm0';
const tgGroupChatIdList = ['-1002295668714', '-4640840749'];
/** 新加坡节点 **/
const ip1 = [
	{ ip: '185.232.47.106', port: '7446', username: 'user81794', password: '8ipjmd' },
	{ ip: '216.10.9.111', port: '7446', username: 'user81794', password: '8ipjmd' },
	{ ip: '185.232.47.101', port: '7446', username: 'user81794', password: '8ipjmd' },
	{ ip: '216.10.9.234', port: '7446', username: 'user81794', password: '8ipjmd' },
	{ ip: '185.232.47.233', port: '7446', username: 'user81794', password: '8ipjmd' },
];
/** 日本节点 **/
const ip2 = [
	// { ip: '64.137.75.57', port: '5977', username: '7RVICJwZQ1', password: 'xjSINDJecS' },
	// { ip: '45.114.12.152', port: '5220', username: '7RVICJwZQ1', password: 'xjSINDJecS' },
];
/** 澳大利亚节点 **/
const ip3 = [
	// { ip: '172.102.218.149', port: '6049', username: '7RVICJwZQ1', password: 'xjSINDJecS' },
	// { ip: '103.53.219.131', port: '6224', username: '7RVICJwZQ1', password: 'xjSINDJecS' },
];

function shuffle(array) {
	for (let i = array.length - 1; i > 0; i--) {
		// 生成 0 到 i 之间的随机索引
		const j = Math.floor(Math.random() * (i + 1));
		// 交换元素
		[array[i], array[j]] = [array[j], array[i]];
	}
	return array;
}

class BaseCrawler {
	// 静态属性：存储单例 tgBot
	static #tgBotInstance = null;
	
	constructor() {
		this.browser = null;
		this.proxies = shuffle([...ip1, ...ip2, ...ip3]);
		this.proxyIndex = 0; // 当前代理索引
	}
	
	// 静态方法：获取 tgBot 实例
	static #getTgBotInstance() {
		if (!BaseCrawler.#tgBotInstance) {
			console.log('Initializing TelegramBot instance...');
			BaseCrawler.#tgBotInstance = new TelegramBot(tgToken);
		}
		return BaseCrawler.#tgBotInstance;
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
		if (!key) throw new Error('safeInitPage 没有填写key');
		await this.initBrowser();
		if (this[key] && this[key]?.close) {
			try {
				await this[key]?.close();
				this[key] = null;
			} catch {
				this[key] = null;
			}
		}
		console.log(`安全的初始化浏览器网页${key}, 请等待...`);
		this[key] = await this.browser.newPage();
		await this[key].setExtraHTTPHeaders({ 'Accept-Encoding': 'gzip' });
		const userAgent = this.#getRandomUserAgent();
		await this[key].setUserAgent(userAgent);
		await this[key].setCacheEnabled(false);
		return this[key];
	}
	
	#getRandomUserAgent() {
		const majorVersion = Math.floor(Math.random() * 20) + 90;
		const minorVersion = Math.floor(Math.random() * 3000) + 1000;
		const patchVersion = Math.floor(Math.random() * 100);
		
		const platforms = [
			`(Windows NT ${Math.floor(Math.random() * 5) + 10}.0; Win64; x64)`,
			`(Macintosh; Intel Mac OS X 10_${Math.floor(Math.random() * 4) + 12}_${Math.floor(Math.random() * 10)})`,
			`(X11; Linux x86_64)`,
			`(Linux; Android ${Math.floor(Math.random() * 3) + 9}; Pixel ${Math.floor(Math.random() * 6) + 3})`,
			`(iPhone; CPU iPhone OS ${Math.floor(Math.random() * 4) + 13}_0 like Mac OS X)`,
		];
		const platform = platforms[Math.floor(Math.random() * platforms.length)];
		return `Mozilla/5.0 ${platform} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion}.${minorVersion}.${patchVersion} Safari/537.36`;
	}
	
	#getRandomProxy() {
		const proxy = this.proxies[this.proxyIndex];
		this.proxyIndex = (this.proxyIndex + 1) % this.proxies.length;
		return proxy;
	}
	
	async #initBrowserWithProxy(proxy) {
		return await puppeteer.launch({
			headless: 'new',
			args: [
				`--proxy-server=${proxy.ip}:${proxy.port}`,
				'--no-sandbox',
				'--disable-setuid-sandbox',
			],
		});
	}
	
	async #initPageWithProxy(browser, proxy) {
		const page = await browser.newPage();
		await page.authenticate({ username: proxy.username, password: proxy.password });
		const userAgent = this.#getRandomUserAgent();
		await page.setUserAgent(userAgent);
		await page.setExtraHTTPHeaders({ 'Accept-Encoding': 'gzip' });
		await page.setCacheEnabled(false);
		return page;
	}
	
	// 新增封装方法：初始化代理浏览器和页面
	async initProxyBrowserAndPage() {
		const proxy = this.#getRandomProxy();
		const browser = await this.#initBrowserWithProxy(proxy);
		const page = await this.#initPageWithProxy(browser, proxy);
		return { browser, page, proxy };
	}
	
	// 发送消息到 Telegram 群组
	static async sendMessageToGroup(message) {
		const tgBot = BaseCrawler.#getTgBotInstance(); // 获取单例 tgBot
		try {
			for (const tgGroupChatId of tgGroupChatIdList) {
				await tgBot.sendMessage(tgGroupChatId, message, {
					parse_mode: 'Markdown',
					message_thread_id: 2
				});
			}
			console.log('Message sent successfully!');
		} catch (error) {
			console.error('Error sending message:', error);
		}
	};
}

module.exports = BaseCrawler;
