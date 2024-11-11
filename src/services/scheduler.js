const schedule = require('node-schedule');
const crawler = require('./crawler');
const { CrawlState } = require('../models');

class CrawlerScheduler {
	constructor() {
		this.dailyJob = null;
	}
	
	async resumeIncompleteFullCrawl() {
		const state = await CrawlState.findOne({
			where: {
				isFullCrawl: true,
				status: ['running', 'failed']
			}
		});
		
		if (state) {
			console.log(`Resuming full crawl from page ${state.lastPage}`);
			crawler.fullCrawl(state.lastPage);
		}
	}
	
	async resumeIncompleteDetailCrawl() {
		const state = await CrawlState.findOne({
			where: {
				isFullCrawl: false,
				isDetailCrawl: true,
				status: ['running', 'failed']
			}
		});
		
		if (state) {
			console.log(`Resuming detailCrawl`);
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
				await crawler.fetchProjectDetails();
				console.log('Daily fetchProjectDetails completed');
			} catch (error) {
				console.error('Daily quick update failed:', error);
			}
		});
		
		// // Resume any incomplete full crawl on startup
		this.resumeIncompleteFullCrawl();
		this.resumeIncompleteDetailCrawl();
	}
	
	stopScheduler() {
		if (this.dailyJob) {
			this.dailyJob.cancel();
		}
	}
}

module.exports = new CrawlerScheduler();
