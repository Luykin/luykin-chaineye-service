const schedule = require('node-schedule');
const rootDataCrawler = require('./rootdata-crawler');
const exCrawler = require('./ex-news-crawler');
const { NewCrawlState, C_STATE_TYPE } = require('../models/sqlite-start');

class CrawlerScheduler {
	constructor() {
		this.morningJob = null;
		this.eveningJob = null;
	}
	
	async startScheduler() {
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
		
		await this.resetAllState();
		this.startRootDataCrawl().then(() => {
			console.log('首次启动任务执行完: startRootDataCrawl')
		}).catch(err => console.log(err));
		this.startExNewsCrawl().then(() => {
			console.log('首次启动任务执行完: startExNewsCrawl')
		}).catch(err => console.log(err));
	}
	
	stopScheduler() {
		if (this.morningJob) {
			this.morningJob.cancel();
		}
		if (this.eveningJob) {
			this.eveningJob.cancel();
		}
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
		await rootDataCrawler.forceClose();
		await rootDataCrawler.quickUpdate();
		await rootDataCrawler.detailsCrawl();
		await rootDataCrawler.subDetailsCrawl();
	}
	/**
	 * 中性化交易所公告爬取
	 * 包含： 币安,OKX
	 * **/
	async startExNewsCrawl() {
		await exCrawler.forceClose();
		await exCrawler.startCrawling();
	}
}

module.exports = new CrawlerScheduler();
