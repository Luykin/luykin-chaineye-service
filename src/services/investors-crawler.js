const retry = require('async-retry');
const { NewCrawlState, Fundraising, C_STATE_TYPE } = require('../models/sqlite-start');
const { v4: uuidv4 } = require('uuid');
const { Op, literal } = require('sequelize');
const BaseCrawler = require('./base-crawler');
const baseRootDataURL = 'https://www.rootdata.com';

class InvestorsCrawler extends BaseCrawler {
	constructor() {
		super();
	}
	
	/**
	 * 【爬虫】每一页的操作，爬取项目列表页面，包括等待页面加载，输入页数量，数据构建等
	 * **/
	async crawlPage(pageNum) {
		const { browser, page: pageInstance } = await this.initBrowserAndPage();
		try {
			console.log('开始爬取', pageNum, '的 vc 数据');
			if (!pageInstance || pageInstance.isClosed()) {
				throw new Error('pageInstance not found');
			}
			const url = `https://www.rootdata.com/Investors?page=${pageNum}`;
			// console.log('正在打开网页', url);
			await pageInstance?.goto(url, {
				waitUntil: 'networkidle0',
				timeout: 20000 // 设置超时
			});
			// 确保主容器加载完成
			await pageInstance.waitForSelector('.main_container', { timeout: 10000 });
			// 定位分页输入框并输入页码
			const inputSelector = 'div.el-input.el-pagination__editor.is-in-pagination input';
			await pageInstance.waitForSelector(inputSelector, { timeout: 10000 });
			try {
				await pageInstance.waitForFunction(
					(selector, expectedValue) => {
						const input = document.querySelector(selector);
						return input && input.value === expectedValue;
					},
					{ timeout: 3000 },
					inputSelector,
					String(pageNum)
				);
				console.log('页数对应上了，等待会儿继续', pageNum);
				await new Promise(resolve => setTimeout(resolve, 1000));
			} catch (err) {
				console.log('页面BUG了，页面page对应不上');
				// 步骤2：直接操作DOM清空并设置值（核心逻辑）
				await pageInstance.evaluate((selector, newValue) => {
					const input = document.querySelector(selector);
					if (!input) throw new Error('输入框未找到');
					
					// 清空并设置新值
					input.value = newValue;
					
					// 触发必要事件（兼容Vue/React/Angular）
					const events = ['input', 'change', 'keydown', 'keyup'];
					events.forEach(eventName =>
						input.dispatchEvent(new Event(eventName, { bubbles: true }))
					);
				}, inputSelector, String(pageNum));
				
				// 步骤3：模拟回车键（双重保障）
				await pageInstance.keyboard.press('Enter');
				
				// 步骤4：验证输入结果（关键！）
				await pageInstance.waitForFunction(
					(selector, expectedValue) => {
						const input = document.querySelector(selector);
						return input && input.value === expectedValue;
					},
					{ timeout: 3000 },
					inputSelector,
					String(pageNum)
				);
				await new Promise(resolve => setTimeout(resolve, 500)); // 设置间隔
				
				// 自定义轮询函数（每300ms检查一次，最多60秒）
				async function waitForLoadingComplete() {
					const startTime = Date.now();
					const timeout = 60000; // 60秒超时
					const interval = 1000; // 1s检查间隔
					
					return new Promise((resolve, reject) => {
						const check = async () => {
							try {
								// 检查DOM状态
								const result = await pageInstance.evaluate(() => {
									const container = document.querySelector(
										'.watermusk_center.table-compat-sort.table-compat-sticky.table-responsive'
									);
									return !container?.classList.contains('el-loading-parent--relative');
								});
								
								console.log('轮训查看DOM状态', result);
								if (result) {
									clearInterval(timer);
									resolve();
								} else if (Date.now() - startTime > timeout) {
									clearInterval(timer);
									reject(new Error('轮询超时：加载状态未消失'));
								}
							} catch (error) {
								clearInterval(timer);
								reject(error);
							}
						};
						
						// 启动轮询
						const timer = setInterval(check, interval);
						check(); // 立即首次检查
					});
				}
				
				try {
					//等待DOM加载状态消失（el-loading-parent--relative被移除）
					await waitForLoadingComplete();
				} catch (error) {
					console.log('精确等待失败:', error);
					await new Promise(resolve => setTimeout(resolve, 10000));
				}
			}
			
			// 提取并格式化数据（保持原有逻辑不变）
			const fundraisingData = await pageInstance.evaluate(async () => {
				const rows = document.querySelectorAll('.main_container tr');
				return Array.from(rows).slice(1).map(row => {
					const cells = row.querySelectorAll('td');
					// const projectElement = cells[0]?.querySelector('.name .list_name');
					const projectName = cells[0]?.textContent?.trim();
					return {
						logo: cells[0]?.querySelector('a img')?.src || '',
						projectName: projectName,
						projectLink: cells[0]?.querySelector("a").href,
						description: `VC-${projectName}`,
						// round: cells[1]?.textContent?.trim(),
						// amount: cells[2]?.textContent?.trim(),
						// valuation: cells[3]?.textContent?.trim(),
						// date: cells[4]?.textContent?.trim(),
						isInitial: true,
						isVcListed: true,
					};
				});
			});
			
			console.log('爬取完毕, vc得到', fundraisingData.length);
			if (!fundraisingData || !fundraisingData.length || fundraisingData.length <= 1) {
				throw new Error('本次爬取页面没有找到数据, vc');
			}
			return fundraisingData.map(item => ({
				...item,
				projectLink: joinUrl(item.projectLink, item.projectName),
				vcListPage: Number(pageNum)
			}));
			
		} catch (error) {
			console.error(`Error crawling page ${pageNum}:`, error?.message);
			throw error;
		} finally {
			browser && await browser?.close();
		}
	}
	
	/**
	 * 【爬虫】项目详情页的爬取逻辑，包括投资人，投资轮次，社交媒体等信息 */
	async crawlDetails(crawlStateType, crawlQueryOptions, crawlType, filterFunction) {
		const state = await NewCrawlState.findOne({ where: crawlStateType }) || await NewCrawlState.create(crawlStateType);
		if (state && state.status === 'running') {
			throw new Error(`${crawlType} crawl already in progress`);
		}
		try {
			// console.log(`开始爬取【${crawlType}】项目详情数据`);
			// 查询项目列表
			let projectsToCrawl = await Fundraising.Project.findAll({
				...crawlQueryOptions  // 使用展开运算符
			});
			// 应用层过滤
			if (filterFunction && typeof filterFunction === 'function') {
				projectsToCrawl = projectsToCrawl.filter(filterFunction);
				console.log(`${crawlType} - 经过过滤后剩余 ${projectsToCrawl.length || 0} 项目待爬取`);
			}
			
			state.status = 'running';
			state.error = null;
			state.lastUpdateTime = new Date();
			state.otherInfo = {
				total: projectsToCrawl.length,
				filterFunction: typeof filterFunction === 'function'
			};
			await state.save();
			
			let remainingCount = projectsToCrawl.length;
			let failedCount = 0;
			for (const project of projectsToCrawl) {
				const { browser, page: pageInstance } = await this.initBrowserAndPage();
				try {
					await retry(
						async () => {
							return await this.scrapeAndUpdateProjectDetails(project, pageInstance);
						},
						{
							retries: 3,
							minTimeout: 1000,
						}
					);
				} catch (err) {
					console.log(`${crawlType} - ${err}`, '详情抓取失败了,继续下一个');
					failedCount++;
					state.otherInfo = {
						...(state.otherInfo || {}),
						failed: failedCount
					};
				} finally {
					browser && await browser?.close?.();
				}
				remainingCount--;
				state.lastUpdateTime = new Date();
				state.otherInfo = {
					...(state.otherInfo || {}),
					remaining: remainingCount,
					projectLink: project?.projectLink,
				};
				await state.save();
				await new Promise(resolve => setTimeout(resolve, 2000)); // 设置间隔
			}
			
			// 完成爬取
			state.lastUpdateTime = new Date();
			state.status = 'completed';
			await state.save();
			
		} catch (error) {
			state.status = 'failed';
			state.error = error.message;
			await state.save();
			throw error;
		}
	}
	
	/**
	 * 【爬取类型：全量项目基础信息爬取】全量更新列表机构，包括页面的控制递增，
	 * 状态控制
	 * **/
	async fullCrawl(startPage = 1) {
		const state = await NewCrawlState.findOne({ where: C_STATE_TYPE.full }) || await NewCrawlState.create(C_STATE_TYPE.full);
		if (state && state.status === 'running') {
			throw new Error('fullCrawl already in progress');
		}
		let currentPage = startPage;
		let hasMoreData = true;
		let failedPages = [];
		// const pageInstance = await this.safeInitPage('listPage');
		try {
			state.status = 'running';
			await state.save();
			
			while (hasMoreData) {
				// if (!pageInstance || pageInstance?.isClosed?.()) {
				// 	throw new Error('pageInstance not found');
				// }
				console.log(`开始爬取第 ${currentPage} 页的===== vc ======机构数据`);
				let data = [];
				try {
					data = await retry(
						async () => {
							return await this.crawlPage(currentPage);
						},
						{
							retries: 3,
							minTimeout: 1000,
						}
					);
				} catch (err) {
					console.log('爬取第 ' + currentPage + ' 页失败');
					data = [];
					failedPages = [...failedPages, currentPage];
				}
				
				if ((!data || (data || [])?.length === 0) && currentPage >= 278) {
					hasMoreData = false;
					continue;
				}
				
				// // 获取所有字段，排除不需要更新的字段
				// const fieldsToUpdate = Object.keys(Fundraising.Project.rawAttributes).filter(field =>
				// 	!['id', 'projectLink', 'createdAt', 'updatedAt'].includes(field)
				// );
				await Fundraising.Project.bulkCreate(data, {
					updateOnDuplicate: ["isVcListed", "vcListPage"]
				});
				
				state.otherInfo = {
					...(state.otherInfo || {}),
					currentPage: currentPage,
					failedPages: failedPages
				};
				state.lastUpdateTime = new Date();
				await state.save();
				currentPage++;
				// Add delay between requests
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
			
			state.status = 'completed';
			await state.save();
			console.log('全量爬取项目任务完成，Crawling completed.');
		} catch (error) {
			state.status = 'failed';
			state.error = error.message;
			await state.save();
			console.error('全量爬取项目任务失败.', error.message);
			throw error;
		}
	}
}

module.exports = new InvestorsCrawler();

function joinUrl(path, projectName) {
	// 如果 path 包含无效的 'javascript:void(0)' 链接，替换为唯一标识符
	if (String(path).includes('javascript:void(0)')) {
		return `javascript:void(0)/${projectName || uuidv4()}`;
	}
	
	// 如果 path 没有协议，拼接 baseRootDataURL
	if (!/^https?:\/\//i.test(path)) {
		const base = baseRootDataURL.replace(/\/+$/, ''); // 移除 base 末尾的多余斜杠
		path = path.replace(/^\/+/, ''); // 移除 path 开头的多余斜杠
		path = `${base}/${path}`;
	}
	
	// 去除多余的斜杠，确保中间只有一个斜杠
	path = path.replace(/([^:]\/)\/+/g, '$1');
	
	// 清理重复的 URL 参数
	const url = new URL(path);
	const params = new URLSearchParams();
	url.searchParams.forEach((value, key) => {
		if (!params.has(key)) params.append(key, value);
	});
	url.search = params.toString();
	
	// 清理重复的锚点
	if (url.hash) {
		const uniqueHash = Array.from(new Set(url.hash.split('#'))).join('');
		url.hash = uniqueHash;
	}
	
	return url.toString();
}

function parseAmount(valueStr) {
	if (!valueStr || valueStr === '--') return null;
	
	// 移除所有美元符号、空格以及中英文单位
	valueStr = valueStr
		.replace(/\$/g, '')          // 移除美元符号
		.replace(/美元/g, '')        // 移除中文美元
		.replace(/,/g, '')          // 移除数字中的逗号
		.replace(/ /g, '')          // 移除空格
		.trim();
	
	// 空值检查
	if (valueStr === '') return null;
	
	let multiplier = 1;
	const units = [
		// 中文大单位优先
		{ pattern: /十亿/g, val: 1e9 },
		{ pattern: /亿/g, val: 1e8 },
		{ pattern: /万/g, val: 1e4 },
		
		// 英文单位（不区分大小写）
		{ pattern: /billion/i, val: 1e9 },
		{ pattern: /million/i, val: 1e6 },
		{ pattern: /thousand/i, val: 1e3 },
		
		// 单字母后缀（严格匹配末尾）
		{ pattern: /B$/i, val: 1e9 },
		{ pattern: /M$/i, val: 1e6 },
		{ pattern: /K$/i, val: 1e3 }
	];
	
	// 循环匹配单位
	for (const unit of units) {
		if (unit.pattern.test(valueStr)) {
			multiplier = unit.val;
			valueStr = valueStr.replace(unit.pattern, '').trim();
			break; // 匹配到第一个单位后退出
		}
	}
	
	// 解析数值（支持负数和科学计数法）
	const value = parseFloat(valueStr);
	return Number.isFinite(value) ? value * multiplier : null;
}

function parseDate(dateStr) {
	if (!dateStr) return null;
	
	const currentYear = new Date().getFullYear();
	let formattedDateStr;
	
	// 英文日期格式处理
	if (/^[A-Za-z]{3} \d{2}, \d{4}$/.test(dateStr)) {
		formattedDateStr = dateStr;
	} else if (/^[A-Za-z]{3}, \d{4}$/.test(dateStr)) {
		formattedDateStr = `01 ${dateStr.replace(',', '')}`;
	} else if (/^[A-Za-z]{3} \d{2}$/.test(dateStr)) {
		formattedDateStr = `${dateStr}, ${currentYear}`;
	}
	
	// 中文日期格式处理
	else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
		// 格式为 "2022-11-08"
		formattedDateStr = dateStr;
	} else if (/^\d{2}-\d{2}$/.test(dateStr)) {
		// 格式为 "11-08"，无年份
		formattedDateStr = `${currentYear}-${dateStr}`;
	}
	
	// 格式化为时间戳
	const timestamp = Date.parse(formattedDateStr);
	return isNaN(timestamp) ? null : timestamp;
}
