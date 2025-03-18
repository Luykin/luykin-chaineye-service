const BaseCrawler = require('./base-crawler');
const { NewsStatistics } = require('../models/sqlite-start');

class StatisticsCrawler extends BaseCrawler {
	
	constructor() {
		super();
		this.statisticalObj = {
			'key': {
				'totalCrawlCount': 0,
				'successCrawlCount': 0,
				'failedCrawlCount': 0,
				'failedErrorAry': [],
			}
		};
		this.updateDatabaseTime = 0;
	}
	
	/**
	 * 报告爬虫统计信息
	 * 此函数用于更新统计爬虫的成功和失败次数以及失败原因
	 * @param {Object} info - 包含爬虫操作信息的对象，包括key（标识符）、isSuccess（操作是否成功）和error（错误信息）
	 */
	report(info) {
		const {
			key,
			ip,
			isSuccess,
			error
		} = info || {};
		if (!key) {
			return;
		}
		const orgObj = this.statisticalObj?.[key] || {};
		this.statisticalObj[key] = {
			...orgObj,
			...{
				'totalCrawlCount': (orgObj?.['totalCrawlCount'] || 0) + 1,
				'successCrawlCount': (orgObj?.['successCrawlCount'] || 0) + Number(isSuccess),
				'failedCrawlCount': (orgObj?.['failedCrawlCount'] || 0) + Number(!isSuccess),
				'failedErrorAry': [
					...(orgObj?.['failedErrorAry'] || []),
					...(error ? error : {})
				].slice(-10),
			}
		};
		try {
			(async () => {
				/** 每五分钟 更新一次数据库 **/
				if (+new Date() > this.updateDatabaseTime + 1000 * 300) {
					this.updateDatabaseTime = +new Date();
					await NewsStatistics.create({
						key: key,
						ip: ip,
						mainInfo: this.statisticalObj?.[key] || {},
						moreInfo: {
							'successRate': (this.statisticalObj?.[key]?.['successCrawlCount'] || 0) / (this.statisticalObj?.[key]?.['totalCrawlCount'] || 0),
						},
						timestamp: String(+new Date()),
					});
					// console.log('statisticsCrawler report', updateItem)
				}
			})();
		} catch (e) {
			console.log('statisticsCrawler report error', e);
		}
	}
}

module.exports = StatisticsCrawler;
