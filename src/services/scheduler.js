const schedule = require('node-schedule');
const crawler = require('./crawler');
const { NewCrawlState, C_STATE_TYPE } = require('../models');
// const { Op } = require('sequelize');

class CrawlerScheduler {
	constructor() {
		this.morningJob = null;
		this.eveningJob = null;
		this.halfHourlyDetailJob = null;
	}
	
	async restartDetailCrawl(scheduledTask = false) {
		/**
		 * 开始detail crawl**/
		const state1 = await NewCrawlState.findOne({
			where: {
				...C_STATE_TYPE.detail,
			},
		});
		
		if (state1) {
			await state1.update({ status: 'idle', error: null, otherInfo: null });
			// needRestartDetails = true;
		}
		/**
		 * 开始sub details crawl**/
		const state2 = await NewCrawlState.findOne({
			where: {
				...C_STATE_TYPE.detail2,
			}
		});
		if (state2) {
			await state2.update({ status: 'idle', error: null, otherInfo: null });
			// needRestartDetails2 = true;
		}
		const stateSpare = await NewCrawlState.findOne({
			where: {
				...C_STATE_TYPE.spare,
			}
		});
		if (stateSpare) {
			await stateSpare.update({ status: 'idle', error: null, otherInfo: null });
		}
		await crawler.forceClose();
		console.log('等待浏览器完全关闭，上一次的任务结束...');
		await new Promise(resolve => setTimeout(resolve, scheduledTask ? 60000 : 2000));
		console.log('等待完毕，开始重新执行');
		crawler.detailsCrawl();
		// crawler.subDetailsCrawl();
	}
	
	startScheduler() {
		// 每天北京时间上午 7:10（对应 UTC 时间晚上 11:10）
		this.morningJob = schedule.scheduleJob('10 23 * * *', async () => {
			console.log('Starting morning quick update...');
			try {
				await crawler.quickUpdate();
				console.log('Morning quick update completed');
			} catch (error) {
				console.error('Morning quick update failed:', error);
			}
		});

		// 每天北京时间晚上 6:10（对应 UTC 时间早上 10:10）
		this.eveningJob = schedule.scheduleJob('10 10 * * *', async () => {
			console.log('Starting evening quick update...');
			try {
				await crawler.quickUpdate();
				console.log('Evening quick update completed');
			} catch (error) {
				console.error('Evening quick update failed:', error);
			}
		});
		
		// this.halfHourlyDetailJob = schedule.scheduleJob('*/30 * * * *', async () => {
		// 	console.log('Starting half-hourly restartDetailCrawl...');
		// 	try {
		// 		// await this.restartDetailCrawl(true);
		// 		console.log('Half-hourly restartDetailCrawl completed');
		// 	} catch (error) {
		// 		console.error('Half-hourly restartDetailCrawl failed:', error);
		// 	}
		// });
		
		this.restartDetailCrawl();
	}
	
	stopScheduler() {
		if (this.morningJob) {
			this.morningJob.cancel();
		}
		if (this.eveningJob) {
			this.eveningJob.cancel();
		}
		if (this.halfHourlyDetailJob) {
			this.halfHourlyDetailJob.cancel();
		}
	}
}

module.exports = new CrawlerScheduler();
