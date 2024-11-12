const schedule = require('node-schedule');
const crawler = require('./crawler');
const { CrawlState } = require('../models');

class CrawlerScheduler {
	constructor() {
		this.dailyJob = null;
		this.halfHourlyDetailJob = null;
	}
	
	async resumeIncompleteFullCrawl() {
		const state = await CrawlState.findOne({
			where: {
				isFullCrawl: true,
				status: ['running', 'failed']
			}
		});
		
		if (state) {
			// 先将状态设为空闲
			await state.update({ status: 'idle', error: null });
			
			console.log(`Resuming full crawl from page ${state.lastPage}`);
			crawler.fullCrawl(state.lastPage);
		}
	}
	
	async resumeIncompleteDetailCrawl() {
		crawler.forceClose();
		const state = await CrawlState.findOne({
			where: {
				isFullCrawl: false,
				isDetailCrawl: true,
			}
		});
		
		if (state) {
			// 先将状态设为空闲
			await state.update({ status: 'idle', error: null });
			
			console.log(`Resuming detail crawl`);
			crawler.fetchProjectDetails();
		}
	}
	
	startScheduler() {
		// Schedule daily quick update at 5 AM
		this.dailyJob = schedule.scheduleJob('0 5 * * *', async () => {
			console.log('Starting daily quick update...');
			try {
				await crawler.quickUpdate();
				console.log('Daily quick update completed');
			} catch (error) {
				console.error('Daily quick update failed:', error);
			}
		});
		
		// Schedule fetchProjectDetails to run every 30 minutes
		this.halfHourlyDetailJob = schedule.scheduleJob('*/30 * * * *', async () => {
			console.log('Starting half-hourly fetchProjectDetails...');
			try {
				await this.resumeIncompleteDetailCrawl();
				console.log('Half-hourly fetchProjectDetails completed');
			} catch (error) {
				console.error('Half-hourly fetchProjectDetails failed:', error);
			}
		});
		
		// Resume any incomplete full crawl on startup
		// this.resumeIncompleteFullCrawl();
		this.resumeIncompleteDetailCrawl();
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
