const schedule = require('node-schedule');
const crawler = require('./crawler');
const { NewCrawlState, C_STATE_TYPE } = require('../models');
const { Op } = require('sequelize');

class CrawlerScheduler {
	constructor() {
		this.dailyJob = null;
		this.halfHourlyDetailJob = null;
	}
	
	async restartDetailCrawl(scheduledTask = false) {
		let needRestartDetails = false;
		let needRestartDetails2 = false;
		/**
		 * 开始detail crawl**/
		const state1 = await NewCrawlState.findOne({
			where: {
				...C_STATE_TYPE.detail,
				...(scheduledTask ? {
					/**
					 * 如果是定时任务，查找不等于running的
					 * 是running的，不处理
					 * **/
					status: { [Op.ne]: 'running' }
				} : {})
			},
		});
		
		if (state1) {
			await state1.update({ status: 'idle', error: null });
			needRestartDetails = true;
		}
		/**
		 * 开始sub details crawl**/
		const state2 = await NewCrawlState.findOne({
			where: {
				...C_STATE_TYPE.detail2,
				...(scheduledTask ? {
					/**
					 * 如果是定时任务，查找不等于running的
					 * 是running的，不处理
					 * **/
					status: { [Op.ne]: 'running' }
				} : {})
			}
		});
		if (state2) {
			await state2.update({ status: 'idle', error: null });
			needRestartDetails2 = true;
		}
		if (needRestartDetails || needRestartDetails2) {
			await new Promise(resolve => setTimeout(resolve, 2000));
			console.log('发现需要重启浏览器,重启任务', needRestartDetails, needRestartDetails2)
			await crawler.forceClose();
			console.log('等待浏览器完全关闭，上一次的任务结束, 等30s');
			await new Promise(resolve => setTimeout(resolve, scheduledTask ? 30000 : 3000));
			console.log('30s等待完毕，开始重新执行!!!!');
			needRestartDetails && crawler.detailsCrawl();
			needRestartDetails2 && crawler.subDetailsCrawl();
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
				await this.restartDetailCrawl(true);
				console.log('Half-hourly restartDetailCrawl completed');
			} catch (error) {
				console.error('Half-hourly restartDetailCrawl failed:', error);
			}
		});
		
		// this.restartDetailCrawl();
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
