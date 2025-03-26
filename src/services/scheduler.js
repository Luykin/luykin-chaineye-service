const schedule = require('node-schedule');
const rootDataCrawler = require('./rootdata-crawler');
const BinanceExNewsCrawler = require('./binance-ex-news-crawler');
const OkxExNewsCrawler = require('./okx-ex-news-crawler');
const CoinBaseTgNewsCrawler = require('./coinbase-tg-news-crawler');
const UpbitExNewsCrawler = require('./upbit-news-crawler');
const TruthsocialCrawler = require('./truthsocial-crawler');
const { NewCrawlState, C_STATE_TYPE } = require('../models/sqlite-start');
const { exec } = require('child_process');

const BaseCrawler = require('./base-crawler');

class CrawlerScheduler {
	constructor() {
		this.morningJob = null;
		this.eveningJob = null;
	}
	
	async startScheduler() {
		this.scheduleTmpPuppeteerCleanup();
		// 每天北京时间上午 7:10（对应 UTC 时间晚上 11:10）
		this.morningJob = schedule.scheduleJob('10 23 * * *', async () => {
			console.log('Starting morning quick update...');
			try {
				await this.startRootDataCrawl();
				console.log('Morning quick update completed');
			} catch (error) {
				console.error('Morning quick update failed:', error);
			}
		});

		// 每天北京时间晚上 6:10（对应 UTC 时间早上 10:10）
		this.eveningJob = schedule.scheduleJob('10 10 * * *', async () => {
			console.log('Starting evening quick update...');
			try {
				await this.startRootDataCrawl();
				console.log('Evening quick update completed');
			} catch (error) {
				console.error('Evening quick update failed:', error);
			}
		});
		await new Promise((resolve) => setTimeout(resolve, 2000)); // 延时2s
		await this.resetAllState();
		/** 每次重启没必要执行一次 rootData 的更新 start ============ **/
		// /** 开始RootData爬虫 **/
		// this.startRootDataCrawl().then(() => {
		// 	console.log('首次启动任务执行完: startRootDataCrawl');
		// }).catch(err => console.log(err));
		// await new Promise((resolve) => setTimeout(resolve, 2000)); // 延时2s
		/** 每次重启没必要执行一次 rootData 的更新 end ============== **/
		/** 开始币安 公告**/
		this.startBinanceExNewsCrawl().then(r => r);
		await new Promise((resolve) => setTimeout(resolve, 2000)); // 延时2s
		/** 开始OKX 公告 **/
		this.startOkxExNewsCrawl().then(r => r);
		await new Promise((resolve) => setTimeout(resolve, 2000)); // 延时2s
		/** 开始coinbase 推特爬取 **/
		this.startCoinBaseTgNewsCrawler().then(r => r);
		await new Promise((resolve) => setTimeout(resolve, 2000)); // 延时2s
		/** 开始Upbit 公告 **/
		this.startUpbitExNewsCrawler().then(r => r);
		await new Promise((resolve) => setTimeout(resolve, 2000)); // 延时2s
		/** 开始Truthsocial 公告 **/
		this.startTruthsocialCrawler().then(r => r);
	}
	
	stopScheduler() {
		if (this.morningJob) {
			this.morningJob.cancel();
		}
		if (this.eveningJob) {
			this.eveningJob.cancel();
		}
	}
	
	/** 清理配置文件 **/
	scheduleTmpPuppeteerCleanup() {
		// 每20分钟执行（cron 表达式：分钟 小时 日 月 星期）
		schedule.scheduleJob('*/25 * * * *', () => {
			const cleanupCommand = 'find /tmp -name "puppeteer_dev_profile-*" -mmin +25 -exec rm -rf {} +';
			exec(cleanupCommand, (err) => {
				if (err) {
					console.error('【浏览器配置文件定时清理】Puppeteer Cleanup failed:', err);
				} else {
					console.log(`【浏览器配置文件定时清理】Puppeteer Cleanup succeeded at ${new Date().toISOString()}`);
				}
			});
		});
	}
	
	/**
	 * 重置所有状态为 idle
	 * **/
	async resetAllState() {
		try {
			await NewCrawlState.update(
				{ status: 'idle', error: null, otherInfo: null }, // 更新的字段和值
				{ where: {} } // 空条件，表示更新所有记录
			);
			console.log('所有状态已更新为 idle');
		} catch (error) {
			console.error('更新状态时出错:', error);
		}
	}
	
	/**
	 * rootData 爬取启动
	 * 包含每日爬取前两页的项目数据，以及爬取详情数据
	 * **/
	async startRootDataCrawl() {
		await rootDataCrawler.quickUpdate();
		await rootDataCrawler.detailsCrawl();
		await rootDataCrawler.subDetailsCrawl();
	}
	
	/**
	 * 币安交易所公告爬取
	 * **/
	async startBinanceExNewsCrawl() {
		await BinanceExNewsCrawler.startCrawling();
	}
	
	/**
	 * OKX交易所公告爬取
	 * **/
	async startOkxExNewsCrawl() {
		await OkxExNewsCrawler.startCrawling();
	}
	
	/**
	 * CoinBaseTg公告爬取
	 * **/
	async startCoinBaseTgNewsCrawler() {
		await CoinBaseTgNewsCrawler.startCrawling();
	}
	
	/**
	 * Upbit公告爬取
	 * **/
	async startUpbitExNewsCrawler() {
		await UpbitExNewsCrawler.startCrawling();
	}
	
	/**
	 * Truthsocial公告爬取
	 * **/
	async startTruthsocialCrawler() {
		await TruthsocialCrawler.startCrawling();
	}
}

module.exports = new CrawlerScheduler();
