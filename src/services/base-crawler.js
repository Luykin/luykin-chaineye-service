const puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');
const _devTgToken = '7369047814:AAHv7OQffIzszIdwKCTVzjP349ZhsItVpm0';
const _proTgToken = '7615998524:AAFLD25mHIeKKsW4ZJt2rmqY-AFWmwu1J6E';
const _devTgGroupChatIdList = [{
	group_id: "-1002198757776",
	message_thread_id: 2,
	name: "CH Test alert"
}];
const _proTgGroupChatIdList = [{
	group_id: "-1001580837317",
	message_thread_id: 69255,
	name: "CryptoHunt Pro - News"
}];
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
	{ 'ip': '163.5.243.247', 'port': '3581', 'username': 'user81794', 'password': '8ipjmd' },
	{ 'ip': '163.5.243.34', 'port': '3581', 'username': 'user81794', 'password': '8ipjmd' },
	{ 'ip': '163.5.243.242', 'port': '3581', 'username': 'user81794', 'password': '8ipjmd' },
	{ 'ip': '163.5.243.150', 'port': '3581', 'username': 'user81794', 'password': '8ipjmd' },
	{ 'ip': '163.5.243.135', 'port': '3581', 'username': 'user81794', 'password': '8ipjmd' }
];
/** 澳大利亚节点 **/
const ip3 = [
	// { ip: '172.102.218.149', port: '6049', username: '7RVICJwZQ1', password: 'xjSINDJecS' },
	// { ip: '103.53.219.131', port: '6224', username: '7RVICJwZQ1', password: 'xjSINDJecS' },
];
/** 台湾节点 **/
const ip4 = [
	{ ip: '185.176.93.171', port: '6868', username: 'user81794', password: '8ipjmd' },
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
	static #devTgBotInstance = null;
	static #proTgBotInstance = null;
	static #devTgToken = _devTgToken;
	static #proTgToken = _proTgToken;
	
	constructor() {
		this.browser = null;
		this.proxies = shuffle([...ip1, ...ip2, ...ip3, ...ip4]);
		this.proxyIndex = 0; // 当前代理索引
	}
	
	// dev测试机器人实例
	static #getDevTgBotInstance() {
		if (!BaseCrawler.#devTgBotInstance) {
			console.log('Initializing DEV TelegramBot instance...');
			BaseCrawler.#devTgBotInstance = new TelegramBot(BaseCrawler.#devTgToken || _devTgToken);
		}
		return BaseCrawler.#devTgBotInstance;
	}
	
	// pro正式机器人实例
	static #getProTgBotInstance() {
		if (!BaseCrawler.#proTgBotInstance) {
			console.log('Initializing PRO TelegramBot instance...');
			BaseCrawler.#proTgBotInstance = new TelegramBot(BaseCrawler.#proTgToken || _proTgToken);
		}
		return BaseCrawler.#proTgBotInstance;
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
		await this[key].setExtraHTTPHeaders({
			'Accept-Encoding': 'gzip',
			'Accept-Language': 'en;q=1.0',  // 设置英文优先
		});
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
	
	getRandomProxy(region) {
		// 根据 region 参数过滤对应地区的代理 IP
		let proxiesToUse = this.proxies;
		if (region === 'singapore') {
			proxiesToUse = ip1;
		} else if (region === 'japan') {
			proxiesToUse = ip2;
		} else if (region === 'australia') {
			proxiesToUse = ip3;
		} else if (region === 'taiwan') {
			proxiesToUse = ip4;
		}
		
		// 获取随机代理
		const proxy = proxiesToUse[this.proxyIndex];
		this.proxyIndex = (this.proxyIndex + 1) % proxiesToUse.length;
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
	async initProxyBrowserAndPage(region) {
		// 通过 region 获取相应的代理
		const proxy = this.getRandomProxy(region);
		const browser = await this.#initBrowserWithProxy(proxy);
		const page = await this.#initPageWithProxy(browser, proxy);
		return { browser, page, proxy };
	}
	
	// DEV 测试 发送消息到 Telegram 群组
	static async sendMessageToGroupDev(message) {
		await BaseCrawler.#sendMessageToGroup('dev', message);
	};
	
	// DEV 测试 发送消息到 Telegram 群组
	static async sendMessageToGroupPro(message) {
		await BaseCrawler.#sendMessageToGroup('pro', message);
	};
	// 发送消息到所有环境
	static async sendMessageToGroupAllEnv(message) {
		return Promise.all([BaseCrawler.#sendMessageToGroup('pro', message), BaseCrawler.#sendMessageToGroup('dev', message)]);
	};
	
	static async #sendMessageToGroup(env = 'dev', message) {
		let tgBot;
		if (env === 'pro') {
			tgBot = BaseCrawler.#getProTgBotInstance();
		} else {
			tgBot = BaseCrawler.#getDevTgBotInstance();
		}
		const group = env === 'pro' ? _proTgGroupChatIdList : _devTgGroupChatIdList;
		try {
			for (const tgGroupItem of (group || [])) {
				try {
					await tgBot.sendMessage(tgGroupItem.group_id, message, {
						parse_mode: 'Markdown',
						message_thread_id: tgGroupItem.message_thread_id
					});
					console.log(`Message sent successfully! ${env}; ${tgGroupItem.name}`);
				} catch (err) {
					console.log(err);
				}
			}
		} catch (error) {
			console.error(`Error sending message ${env}:`, error);
		}
	};
}

module.exports = BaseCrawler;
