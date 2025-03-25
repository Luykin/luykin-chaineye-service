const puppeteer = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
const AnonymizeUA = require('puppeteer-extra-plugin-anonymize-ua');
// const FontSize = require('puppeteer-extra-plugin-font-size');

// 加载顺序建议：基础插件 -> 功能增强插件
puppeteer.use(Stealth());
puppeteer.use(AnonymizeUA());
const TelegramBot = require('node-telegram-bot-api');
const _devTgToken = '7369047814:AAHv7OQffIzszIdwKCTVzjP349ZhsItVpm0';
const _proTgToken = '7615998524:AAFLD25mHIeKKsW4ZJt2rmqY-AFWmwu1J6E';
const _devTgGroupChatIdList = [{
	group_id: '-1002198757776',
	message_thread_id: 2,
	name: 'CH Test alert'
}];
const _proTgGroupChatIdList = [{
	group_id: '-1001580837317',
	message_thread_id: 69255,
	name: 'CryptoHunt Pro - News'
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

const puppeteerArgs = [
	'--no-sandbox',// 禁用沙盒模式
	'--disable-dev-shm-usage',// 禁用 /dev/shm 使用
	'--disable-setuid-sandbox',
	'--disable-breakpad', // 禁用崩溃报告
	'--disable-component-extensions-with-background-pages',// 禁用带后台页面的扩展组件
	'--disable-extensions', // 禁用所有扩展
	'--disable-sync', // 禁用同步功能
	'--disable-blink-features=AutomationControlled', // 禁用自动化特性
	'--no-first-run',// 跳过首次运行体验
	'--no-default-browser-check',// 禁用默认浏览器检查
	'--no-pings',// 禁用 <a ping> 请求
	'--disable-popup-blocking',// 禁用弹出窗口拦截
	'--disable-notifications',// 禁用通知功能
	'--disable-translate'// 禁用翻译提示
]

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
	
	/**
	 * 从proxies删除某个ip*/
	banIp(oneIp) {
		const index = this.proxies.findIndex(proxy => proxy.ip === oneIp);
		if (index !== -1) {
			this.proxies.splice(index, 1);
			console.log(`已ban掉IP: ${oneIp}`);
		} else {
			console.log(`未找到IP: ${oneIp}`);
		}
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
	
	async forceClose() {
		try {
			await this.browser?.close?.();
			this.browser = null;
			console.log('已经强制关闭浏览器...');
		} catch (err) {
			console.error('Error closing browser:', err);
		}
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
		if (!Array.isArray(proxiesToUse) || proxiesToUse.length === 0) {
			throw new Error('No proxies available.');
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
				...puppeteerArgs,
			],
		});
	}
	
	async #initBrowser() {
		return await puppeteer.launch({
			headless: 'new',
			args: [
				...puppeteerArgs,
			],
		});
	}
	
	async #initPageWithProxy(browser, proxy) {
		const page = await browser.newPage();
		await page.authenticate({ username: proxy.username, password: proxy.password });
		await page.setExtraHTTPHeaders({ 'Accept-Encoding': 'gzip' });
		await page.setCacheEnabled(false);
		return page;
	}
	
	async #initPage(browser) {
		const page = await browser.newPage();
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
	
	async initBrowserAndPage() {
		const browser = await this.#initBrowser();
		const page = await this.#initPage(browser);
		const proxy = { ip: '127.0.0.1', port: 'none', 'username': 'none', 'password': 'nne' };
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
