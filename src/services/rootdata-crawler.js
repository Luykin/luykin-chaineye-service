const retry = require('async-retry');
const { NewCrawlState, Fundraising, C_STATE_TYPE } = require('../models/sqlite-start');
const { v4: uuidv4 } = require('uuid');
const { Op, literal } = require('sequelize');
const BaseCrawler = require('./base-crawler');
const baseRootDataURL = 'https://www.rootdata.com';

class FundraisingCrawler extends BaseCrawler {
	constructor() {
		super();
	}
	
	/**
	 * 【爬虫】每一页的操作，爬取项目列表页面，包括等待页面加载，输入页数量，数据构建等
	 * **/
	async crawlPage(pageNum) {
		const { browser, page: pageInstance } = await this.initBrowserAndPage();
		try {
			console.log('开始爬取', pageNum, '的数据');
			if (!pageInstance || pageInstance.isClosed()) {
				throw new Error('pageInstance not found');
			}
			const url = `https://www.rootdata.com/Fundraising?page=${pageNum}`;
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
			const nowPage = await pageInstance.waitForFunction(
				(selector, expectedValue) => {
					const input = document.querySelector(selector);
					return input && input.value === expectedValue;
				},
				{ timeout: 3000 },
				inputSelector,
				String(pageNum)
			);
			if (String(nowPage) !== String(pageNum)) {
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
			} else {
				console.log('页数对应上了，等待会儿继续', pageNum);
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
			
			// 提取并格式化数据（保持原有逻辑不变）
			const fundraisingData = await pageInstance.evaluate(async () => {
				const rows = document.querySelectorAll('.main_container tr');
				return Array.from(rows).slice(1).map(row => {
					const cells = row.querySelectorAll('td');
					const projectElement = cells[0]?.querySelector('.name .list_name');
					return {
						logo: cells[0]?.querySelector('a img')?.src || '',
						projectName: projectElement?.childNodes[0]?.textContent?.trim(),
						projectLink: projectElement?.href,
						description: cells[0]?.textContent?.trim().replace(projectElement?.textContent?.trim(), '').trim(),
						round: cells[1]?.textContent?.trim(),
						amount: cells[2]?.textContent?.trim(),
						valuation: cells[3]?.textContent?.trim(),
						date: cells[4]?.textContent?.trim(),
						isInitial: true
					};
				});
			});
			
			console.log('爬取完毕, 得到', fundraisingData.length);
			if (!fundraisingData || !fundraisingData.length || fundraisingData.length <= 1) {
				throw new Error('本次爬取页面没有找到数据');
			}
			return fundraisingData.map(item => ({
				...item,
				projectLink: joinUrl(item.projectLink, item.projectName),
				formattedAmount: parseAmount(item.amount),
				formattedValuation: parseAmount(item.valuation),
				fundedAt: parseDate(item.date),
				originalPageNumber: Number(pageNum)
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
				console.log(`开始爬取第 ${currentPage} 页的机构数据`);
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
				
				// 获取所有字段，排除不需要更新的字段
				const fieldsToUpdate = Object.keys(Fundraising.Project.rawAttributes).filter(field =>
					!['id', 'projectLink', 'createdAt', 'updatedAt'].includes(field)
				);
				await Fundraising.Project.bulkCreate(data, {
					updateOnDuplicate: fieldsToUpdate
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
	
	/**
	 * 【爬取类型：第一页项目基础信息爬取】快速更新列表机构，每日更新第一页
	 * **/
	async quickUpdate() {
		const state = await NewCrawlState.findOne({ where: C_STATE_TYPE.quick }) || await NewCrawlState.create(C_STATE_TYPE.quick);
		if (state && state.status === 'running') {
			throw new Error('quickUpdate already in progress');
		}
		// const pageInstance = await this.safeInitPage('listPage');
		let updateNum = 0;
		try {
			state.status = 'running';
			state.error = null;
			await state.save();
			// Only crawl first 3 pages for quick updates
			for (let page = 1; page <= 1; page++) {
				// if (!pageInstance || pageInstance?.isClosed?.()) {
				// 	throw new Error('quickUpdate: Page instance not initialized');
				// }
				const data = await this.crawlPage(page);
				const existingLinks = await Fundraising.Project.findAll({
					attributes: ['projectLink'],
					where: {
						projectLink: data.map(item => item.projectLink)
					}
				}).then(projects => projects.map(project => project.projectLink));
				const newData = data.filter(item => !existingLinks.includes(item.projectLink));
				
				if (newData.length > 0) {
					// 获取所有字段，排除不需要更新的字段
					const fieldsToUpdate = Object.keys(Fundraising.Project.rawAttributes).filter(field =>
						!['id', 'projectLink', 'createdAt', 'updatedAt'].includes(field)
					);
					// 执行 bulkCreate 时使用动态字段列表
					await Fundraising.Project.bulkCreate(newData, {
						updateOnDuplicate: fieldsToUpdate
					});
					updateNum = updateNum + newData.length;
				} else {
					console.log('No new data found on page', page);
				}
				//除了更新项目本身，要去更新这一页的项目详情
				const totalCount = existingLinks?.length;
				let hadUpdateCount = 0;
				console.log(`第 ${page} 页的机构数据有${totalCount}个详情页数据还需要再爬取一遍`);
				for (const project of existingLinks) {
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
						console.log('前两页更新逻辑：详情抓取失败了,继续下一个');
					} finally {
						hadUpdateCount++;
						state.otherInfo = {
							detailUpdateNum: hadUpdateCount
						};
						await state.save();
						browser && await browser?.close?.();
						await new Promise(resolve => setTimeout(resolve, 1000));
					}
				}
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
			
			state.lastUpdateTime = new Date();
			state.status = 'completed';
			state.otherInfo = {
				updateNum: updateNum
			};
			await state.save();
		} catch (error) {
			console.error('Quick update error:', error);
			state.status = 'failed';
			state.error = error.message;
			state.otherInfo = {
				updateNum: updateNum
			};
			await state.save();
			// throw error;
		} finally {
			console.log('quickUpdate finally: 关闭浏览器');
			// pageInstance && pageInstance?.close?.();
		}
	}
	
	/**
	 * 【爬取类型：项目详情】更新2天前的详情页需要更新的项目
	 * **/
	async detailsCrawl() {
		// 获取当前时间的时间戳（毫秒）
		const now = Date.now();
		const daysAgo1 = now - 2.5 * 24 * 60 * 60 * 1000; // 2 天前的时间戳
		// 计算 2 天前的时间戳
		const daysAgo2 = now - 2 * 24 * 60 * 60 * 1000; // 1 天前的时间戳
		
		const crawlQueryOptions = {
			where: {
				isInitial: true,
				// 合并条件：如果满足以下条件之一
				[Op.or]: [
					{ '$investmentsReceived.id$': null },  // investmentsReceived 为空
					{ socialLinks: { [Op.eq]: null } },    // socialLinks 为空
					{ fundedAt: { [Op.gte]: daysAgo1 } }  // fundedAt 在最近 3 天内
				],
				// 其他的限制条件
				detailFailuresNumber: { [Op.lte]: 8 },
				projectLink: { [Op.like]: 'http%' },    // 确保 projectLink 以 http 开头
				
				// detailFetchedAt 的条件：要么是 null，要么是超过 2 天前的
				detailFetchedAt: {
					[Op.or]: [
						{ [Op.is]: null },            // detailFetchedAt 为 null
						{ [Op.lt]: daysAgo2 }         // detailFetchedAt 小于 2 天前
					]
				}
			},
			include: [
				{
					model: Fundraising.InvestmentRelationships,
					as: 'investmentsReceived',
					required: false,
					attributes: ['id']
				}
			],
			order: [
				[
					literal('CASE WHEN "originalPageNumber" IS NULL THEN 1 ELSE 0 END'),
					'ASC'
				],
				['originalPageNumber', 'ASC']
			]
		};
		
		await this.crawlDetails(C_STATE_TYPE.detail, crawlQueryOptions, 'detailPage');
	}
	
	/**
	 * 【爬取类型：项目详情】查漏补缺
	 * **/
	async detailsCrawlCheckMissing() {
		// 获取当前时间的时间戳（毫秒）
		const now = Date.now();
		// 计算 3 天前的时间戳
		const daysAgo3 = now - 3 * 24 * 60 * 60 * 1000; // 3 天前的时间戳
		
		// 计算 2 天前的时间戳
		const daysAgo2 = now - 2 * 24 * 60 * 60 * 1000; // 1 天前的时间戳
		
		const crawlQueryOptions = {
			where: {
				isInitial: true,  // 只筛选 isInitial 为 true 的项目
				[Op.or]: [
					{ '$investmentsReceived.id$': null },  // investmentsReceived 为空
					{ socialLinks: { [Op.eq]: null } },    // socialLinks 为空
					// { fundedAt: { [Op.gte]: daysAgo1 } }  // fundedAt 在最近 3 天内
				],
				// fundedAt: {
				// 	[Op.lt]: daysAgo3  // 排除最近 3 天内的 fundedAt
				// },
				// originalPageNumber: {
				// 	[Op.lt]: 50  // 限制 originalPageNumber 小于 50
				// },
				projectLink: { [Op.like]: 'http%' },    // 确保 projectLink 以 http 开头
				detailFetchedAt: {
					[Op.or]: [
						{ [Op.is]: null },            // detailFetchedAt 为 null
						{ [Op.lt]: daysAgo2 }         // detailFetchedAt 小于 2 天前
					]
				},
				[Op.or]: [  // 添加 OR 条件，满足其中一个即可
					{
						detailFailuresNumber: {
							[Op.lt]: 16  // detailFailuresNumber 小于 8
						}
					},
					{
						detailFailuresNumber: {
							[Op.gte]: 99  // detailFailuresNumber 大于等于 99
						}
					}
				]
			},
			order: [
				['originalPageNumber', 'DESC']  // originalPageNumber 越大的在前面
			]
		};
		
		console.log('开始全量查漏补缺 ======');
		
		await this.crawlDetails(C_STATE_TYPE.detail, crawlQueryOptions, 'detailPage');
	}
	
	/**
	 * 【爬取类型：二层子项目项目详情】子项目详情
	 * **/
	async subDetailsCrawl() {
		const crawlQueryOptions = {
			where: {
				isInitial: false,
				detailFailuresNumber: { [Op.lte]: 8 },
				socialLinks: null,
				projectLink: { [Op.like]: 'http%' }  // 确保 projectLink 以 http 开头
			}
		};
		await this.crawlDetails(C_STATE_TYPE.detail2, crawlQueryOptions, 'socialPage');
	}
	
	async scrapeAndUpdateProjectDetails(project, _page) {
		try {
			if (!_page || _page.isClosed()) {
				throw new Error('网页不见了，Detail page not initialized');
			}
			
			// 访问项目详情页
			await _page.goto(project.projectLink, {
				waitUntil: 'networkidle0',
				timeout: 20000
			});
			await _page.waitForSelector('.base_info', { timeout: 20000 });
			
			// 第一阶段：点击展开更多按钮并抓取基础投资者数据
			await this.clickExpandButtons(_page);
			const initialInvestors = await this.scrapeInitialInvestors(_page);
			// 第二阶段：点击rounds按钮并抓取轮次数据
			let roundsInvestors = [];
			if (project.isInitial) {
				await this.clickRoundsButton(_page);
				roundsInvestors = await this.processRounds(_page);
			}
			if (initialInvestors?.length !== roundsInvestors?.length) {
				console.log('一二阶段爬取机构数量不一致', initialInvestors?.length, roundsInvestors?.length, project.projectLink);
			}
			// 合并投资者数据（轮次数据优先）
			const mergedInvestors = this.mergeInvestorData(initialInvestors, roundsInvestors);
			// 抓取基础信息
			const details = await _page.evaluate(() => {
				const socialLinks = {};
				document.querySelectorAll('.base_info .links a').forEach(link => {
					const type = link.querySelector('span')?.textContent?.trim().toLowerCase();
					if (type) socialLinks[type] = link.href;
				});
				
				const teamMembers = Array.from(document.querySelectorAll('.team_member .item')).map(member => ({
					name: member.querySelector('.content h2')?.textContent?.trim(),
					position: member.querySelector('.content p')?.textContent?.trim(),
					avatar: member.querySelector('.logo-wraper img')?.src || '',
					profileLink: member.querySelector('.card')?.href || ''
				}));
				
				return {
					socialLinks,
					teamMembers,
					projectName: document.querySelector('.detail_info_head h1.name')?.textContent?.trim(),
					logo: document.querySelector('.detail_info_head .logo')?.src || ''
				};
			});
			
			// 更新项目基础信息
			const isCrawlSuccess = details.projectName && details.logo && Object.keys(details.socialLinks).length > 0;
			await project.update({
				projectName: details.projectName,
				logo: details.logo,
				socialLinks: details.socialLinks,
				teamMembers: details.teamMembers,
				detailFetchedAt: isCrawlSuccess ? new Date() : null,
				detailFailuresNumber: isCrawlSuccess ? (mergedInvestors.length ? 0 : 99) : (Number(project.detailFailuresNumber) || 0) + 1
			});
			
			let updateRelationshipsLength = 0;
			// 保存投资关系数据
			if (mergedInvestors.length > 0) {
				updateRelationshipsLength = await this.updateInvestmentRelationships(project, mergedInvestors);
			}
			
			console.log(`抓取详情成功 ${project.projectName} ${project.isInitial ? `${updateRelationshipsLength}个数据关联成功` : '不需要关联'}`);
			return true;
			
		} catch (error) {
			console.error(`抓取失败 ${project.projectName}:`, error);
			await project.update({ detailFailuresNumber: project.detailFailuresNumber + 1 });
			throw error;
		}
	}

// 点击展开更多按钮（不点击rounds按钮）
	async clickExpandButtons(_page) {
		await _page.evaluate(() => {
			document.querySelectorAll('button').forEach(button => {
				if (/expand\s*more/i.test(button.textContent)) {
					button.click();
				}
			});
		});
		await new Promise(resolve => setTimeout(resolve, 1000)); // 设置间隔
	}

// 抓取初始投资者数据（无轮次信息）
	async scrapeInitialInvestors(_page) {
		return _page.evaluate(() => {
			return Array.from(document.querySelectorAll('.investor .row .item')).map(item => {
				const link = item.querySelector('a');
				return {
					projectLink: link.href,
					projectName: link.querySelector('h2')?.textContent?.trim(),
					lead: !!item.querySelector('.status_icon.status_position'),
					source: 'initial'
				};
			});
		});
	}

// 点击rounds按钮
	async clickRoundsButton(_page) {
		await _page.evaluate(() => {
			document.querySelectorAll('button').forEach(button => {
				if (/rounds/i.test(button.textContent)) {
					button.click();
				}
			});
		});
		await new Promise(resolve => setTimeout(resolve, 1000)); // 设置间隔
	}

// 处理轮次数据
	async processRounds(_page) {
		return _page.evaluate(() => {
			return Array.from(document.querySelectorAll('.investor tr')).slice(1).map(row => {
				const cells = row.querySelectorAll('td');
				const round = cells[0]?.textContent?.trim();
				const amount = cells[1]?.textContent?.trim();
				const valuation = cells[2]?.textContent?.trim();
				const date = cells[3]?.textContent?.trim();
				
				return Array.from(cells[4].querySelectorAll('a')).map(a => ({
					projectLink: a.href,
					projectName: a.textContent.replace('*', '').trim(),
					lead: a.textContent.includes('*'),
					round,
					amount,
					valuation,
					date,
					source: 'rounds',
				}));
			}).flat();
		});
	}

// 合并投资者数据（优先使用轮次数据）
	mergeInvestorData(initial, rounds) {
		const map = new Map();
		
		// 处理轮次数据
		(rounds || []).forEach(inv => {
			map.set(inv.projectName, {
				...inv,
				projectLink: joinUrl(inv.projectLink, inv.projectName),
				formattedAmount: parseAmount(inv.amount),
				formattedValuation: parseAmount(inv.valuation),
				timestamp: parseDate(inv.date)
			});
		});
		
		// 补充初始数据中独有的记录
		const _initial = (initial || []).filter(inv => !map.has(inv.projectName)).map(inv => {
			return {
				...inv,
				projectLink: joinUrl(inv.projectLink, inv.projectName),
				round: null,
				amount: null,
				valuation: null,
				date: null,
				formattedAmount: null,
				formattedValuation: null,
				timestamp: 1230739200000 //2009/01/01 00:00:00
			};
		});
		const _rounds = rounds.map(inv => {
			return {
				...inv,
				projectLink: joinUrl(inv.projectLink, inv.projectName),
				formattedAmount: parseAmount(inv.amount),
				formattedValuation: parseAmount(inv.valuation),
				timestamp: parseDate(inv.date)
			};
		});
		
		return [..._rounds, ..._initial];
	}
	
	async updateInvestmentRelationships(project, investors) {
		const sequelize = Fundraising.Project.sequelize;
		let transaction;
		
		try {
			transaction = await sequelize.transaction();
			
			// 1. 处理投资者项目（串行化处理）
			const investorRecords = [];
			for (const inv of investors) {
				const projectLink = joinUrl(inv.projectLink, inv.projectName);
				
				// 使用事务化的 findOrCreate
				const [investorProject] = await Fundraising.Project.findOrCreate({
					where: { projectLink },
					defaults: {
						projectName: inv.projectName || 'Unknown',
						isInitial: false
					},
					transaction
				});
				
				investorRecords.push({
					investorProjectId: investorProject.id,
					fundedProjectId: project.id,
					round: inv.round || null,
					amount: inv.amount || null,
					formattedAmount: inv.formattedAmount || null,
					valuation: inv.valuation || null,
					formattedValuation: inv.formattedValuation || null,
					date: inv.timestamp || null,
					lead: !!inv.lead
				});
			}
			
			// 2. 批量写入投资关系（事务内执行）
			await Fundraising.InvestmentRelationships.bulkCreate(investorRecords, {
				transaction,
				updateOnDuplicate: [
					'lead',
					'round',
					'amount',
					'valuation',
					'date',
					'formattedAmount',
					'formattedValuation'
				]
			});
			
			await transaction.commit();
			return investorRecords.length;
			
		} catch (error) {
			if (transaction) await transaction.rollback();
			
			// 重试机制（最多3次）
			if (error.name === 'SequelizeTimeoutError' && this.retryCount < 3) {
				this.retryCount = (this.retryCount || 0) + 1;
				console.log(`Retrying (${this.retryCount}/3)...`);
				return this.updateInvestmentRelationships(project, investors);
			}
			
			console.error('Failed to update investment relationships:', error);
			throw error;
		} finally {
			this.retryCount = 0; // 重置重试计数
		}
	}
}

module.exports = new FundraisingCrawler();

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
	
	// 移除美元符号、空格以及"美元"字样
	valueStr = valueStr.replace('$', '').replace('美元', '').trim();
	
	let multiplier = 1;
	
	if (valueStr.endsWith('M')) {
		multiplier = 1e6;
		valueStr = valueStr.replace('M', '').trim();
	} else if (valueStr.endsWith('K')) {
		multiplier = 1e3;
		valueStr = valueStr.replace('K', '').trim();
	} else if (valueStr.toLowerCase().includes('million')) {
		multiplier = 1e6;
		valueStr = valueStr.toLowerCase().replace('million', '').trim();
	} else if (valueStr.includes('万')) {
		multiplier = 1e4;
		valueStr = valueStr.replace('万', '').trim();
	} else if (valueStr.includes('亿')) {
		multiplier = 1e8;
		valueStr = valueStr.replace('亿', '').trim();
	}
	
	// 转换为浮点数并乘以相应的单位
	const value = parseFloat(valueStr);
	return isNaN(value) ? null : value * multiplier;
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
