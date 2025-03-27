const BaseCrawler = require('./base-crawler');
const { NewsStatistics } = require('../models/sqlite-start');
/**
 * 把错误对象转换为字符串
 * @param value 错误对象
 * @returns
 */
const formatErrorString = (value) => {
	if (value instanceof Error) {
		return JSON.stringify(value, Object.getOwnPropertyNames(value));
	}
	return JSON.stringify(value);
};

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
		this.lastSucTime = '-';
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
		if (isSuccess) {
			this.lastSucTime = new Date().toISOString();
		}
		const orgObj = this.statisticalObj?.[key] || {};
		const _totalCount = Number(orgObj?.['totalCrawlCount'] || 0);
		const _successCount = Number(orgObj?.['successCrawlCount'] || 0);
		const _failedCount = Number(orgObj?.['failedCrawlCount'] || 0);
		this.statisticalObj[key] = {
			...orgObj,
			...{
				'totalCrawlCount': _totalCount + 1,
				'successCrawlCount': _successCount + Number(isSuccess),
				'failedCrawlCount': _failedCount + Number(!isSuccess),
				'failedErrorAry': [
					...(orgObj?.['failedErrorAry'] || []),
					...(error ? [formatErrorString(error)] : [])
				].slice(-10),
			}
		};
		let isBanned = false;
		/**
		 * 十次都失败的ip，从ip里面拿掉，仅限于这个实例*/
		if (_totalCount >= 5 && _failedCount === _totalCount) {
			this.banIp(ip);
			isBanned = true;
		}
		try {
			(async () => {
				/** 每180秒 更新一次数据库 **/
				if (+new Date() > this.updateDatabaseTime + 1000 * 180) {
					this.updateDatabaseTime = +new Date();
					
					// 检查数据库中是否已存在该 key 的记录
					const existingRecord = await NewsStatistics.findOne({ where: { key } });
					
					// 构造要保存的数据
					const dataToSave = {
						key: key,
						ip: ip,
						mainInfo: this.statisticalObj?.[key] || {},
						moreInfo: {
							lastSucTime:this.lastSucTime,
							isBanned,
							'successRate': (this.statisticalObj?.[key]?.['successCrawlCount'] || 0) / (this.statisticalObj?.[key]?.['totalCrawlCount'] || 0),
						},
						timestamp: String(+new Date()),
					};
					
					if (existingRecord) {
						// 如果记录已存在，则更新记录
						await NewsStatistics.update(dataToSave, { where: { key } });
					} else {
						// 如果记录不存在，则创建新记录
						await NewsStatistics.create(dataToSave);
					}
					
					// console.log('statisticsCrawler report', updateItem)
				}
			})();
		} catch (e) {
			console.log('statisticsCrawler report error', e);
		}
	}
}

module.exports = StatisticsCrawler;
