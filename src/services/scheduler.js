const schedule = require('node-schedule');
const crawler = require('./crawler');
const { NewCrawlState, C_STATE_TYPE } = require('../models');

class CrawlerScheduler {
	constructor() {
		this.dailyJob = null;
		this.halfHourlyDetailJob = null;
	}
	
	async restartDetailCrawl() {
		await crawler.forceClose();
		/**
		 * 开始detail crawl**/
		const state1 = await NewCrawlState.findOne({
			where: C_STATE_TYPE.detail
		});
		
		if (state1) {
			await state1.update({ status: 'idle', error: null });
			crawler.detailsCrawl();
		}
		/**
		 * 开始sub details crawl**/
		const state2 = await NewCrawlState.findOne({
			where: C_STATE_TYPE.detail2
		});
		if (state2) {
			await state2.update({ status: 'idle', error: null });
			crawler.subDetailsCrawl();
		}
	}
	
	startScheduler() {
		this.dailyJob = schedule.scheduleJob('0 5 * * *', async () => {
			console.log('Starting daily quick update...');
			try {
				await crawler.quickUpdate();
				console.log('Daily quick update completed');
			} catch (error) {
				console.error('Daily quick update failed:', error);
			}
		});
		
		this.halfHourlyDetailJob = schedule.scheduleJob('*/30 * * * *', async () => {
			console.log('Starting half-hourly restartDetailCrawl...');
			try {
				await this.restartDetailCrawl();
				console.log('Half-hourly restartDetailCrawl completed');
			} catch (error) {
				console.error('Half-hourly restartDetailCrawl failed:', error);
			}
		});
		
		this.restartDetailCrawl();
	}
	
	stopScheduler() {
		if (this.dailyJob) {
			this.dailyJob.cancel();
		}
		if (this.halfHourlyDetailJob) {
			this.halfHourlyDetailJob.cancel();
		}
	}
}

module.exports = new CrawlerScheduler();
