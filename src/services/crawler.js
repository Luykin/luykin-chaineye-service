const puppeteer = require('puppeteer');
const retry = require('async-retry');
const { NewCrawlState, Fundraising, C_STATE_TYPE } = require('../models');
const baseRootDataURL = 'https://www.rootdata.com';
const { v4: uuidv4 } = require('uuid');
const { Op, literal } = require('sequelize');

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

class FundraisingCrawler {
	constructor() {
		this.browser = null;
		this.listPage = null; // 用于爬取列表数据
		this.detailPage = null; // 用于爬取列表项目的详情数据
		this.socialPage = null; // 用于爬取详情的项目的社交媒体信息
	}
	
	async initBrowser() {
		if (!this.browser) {
			console.log('初始化浏览器...');
			this.browser = await puppeteer.launch({
				headless: 'new',
				args: [
					'--no-sandbox',
					'--disable-setuid-sandbox'
				]
			});
		}
	}
	
	async initListPage() {
		await this.initBrowser();
		if (this.listPage) {
			this.listPage?.close?.();
			this.listPage = null;
		}
		this.listPage = await this.browser.newPage();
		console.log('初始化爬取列表页的浏览器选项卡...');
	}
	
	async initDetailPage() {
		await this.initBrowser();
		if (this.detailPage) {
			this.detailPage?.close?.();
			this.detailPage = null;
		}
		this.detailPage = await this.browser.newPage();
		console.log('初始化爬取详情页的浏览器选项卡...');
	}
	
	async initSocialPage() {
		await this.initBrowser();
		if (this.socialPage) {
			this.socialPage?.close?.();
			this.socialPage = null;
		}
		this.socialPage = await this.browser.newPage();
		console.log('初始化爬取社交媒体页的浏览器选项卡...');
	}
	/**
	 * 强制关闭浏览器
	 * **/
	async forceClose() {
		try {
			await this.browser?.close?.();
			this.socialPage = null;
			this.detailPage = null;
			this.listPage = null;
			this.browser = null;
			console.log('已经强制关闭浏览器...');
		} catch (err) {
			console.error('Error closing browser:', err);
		}
	}
	
	/**
	 * 关闭浏览器，但是有运行的情况下不会关闭
	 * **/
	async close() {
		try {
			const [s1, s2, s3, s4] = await Promise.all([
				NewCrawlState.findOne({ where: C_STATE_TYPE.full }),
				NewCrawlState.findOne({ where: C_STATE_TYPE.quick }),
				NewCrawlState.findOne({ where: C_STATE_TYPE.detail }),
				NewCrawlState.findOne({ where: C_STATE_TYPE.detail2 })
			]);
			if (s1?.status === 'running' || s2?.status === 'running' || s3?.status === 'running' || s4?.status === 'running') {
				console.log('Crawler is busy, cannot close.');
				return;
			}
			this.forceClose();
		} catch (err) {
			console.error('Error closing browser:', err);
		}
	}
	/**
	 * 爬取指定页的机构列表数据
	 * **/
	async crawlPage(pageNum) {
		try {
			if (!this.listPage) {
				await new Promise(resolve => setTimeout(resolve, 2000));
				throw new Error('crawlPage page not found');
			}
			await this.listPage?.goto(`https://www.rootdata.com/Fundraising?page=${pageNum}`, {
				waitUntil: 'networkidle0',
				timeout: 30000 // 设置超时
			});
			// 检查是否存在“没有数据”的行
			const isEmpty = await this.listPage.evaluate(() => {
				return !!document.querySelector('tr.b-table-empty-row');
			});
			if (isEmpty) return []; // 如果是空页面则返回空数组
			
			// Wait for the table to load
			await this.listPage.waitForSelector('.main_container');
			
			// Extract data
			const fundraisingData = await this.listPage.evaluate(async () => {
				const rows = document.querySelectorAll('.main_container tr');
				
				const data = Array.from(rows).slice(1).map(async row => {
					const cells = row.querySelectorAll('td');
					const projectElement = cells[0]?.querySelector('.name .list_name');
					const logo = cells[0]?.querySelector('a img')?.getAttribute('src') || '';
					const projectName = projectElement?.childNodes?.[0]?.textContent?.trim();
					const projectLink = projectElement?.getAttribute('href');
					const projectDescription = cells[0]?.textContent?.trim().replace(projectName, '').trim();
					
					const round = cells[1]?.textContent?.trim();
					
					const amount = cells[2]?.textContent?.trim();
					
					const valuation = cells[3]?.textContent?.trim();
					
					const date = cells[4]?.textContent?.trim();
					
					return {
						logo,
						projectName,
						projectLink,
						description: projectDescription,
						round,
						amount,
						valuation,
						date,
						isInitial: true,
					};
				});
				
				// 使用 Promise.all 等待所有行的异步操作完成
				return await Promise.all(data);
			});
			// console.log(fundraisingData, 'fundraisingData');
			
			return fundraisingData.map(_ => {
				const formattedAmount = parseAmount(_.amount);
				const formattedValuation = parseAmount(_.valuation);
				const fundedAt = parseDate(_.date);
				return {
					..._,
					projectLink: joinUrl(_.projectLink, _.projectName),
					formattedAmount,
					formattedValuation,
					fundedAt,
					originalPageNumber: Number(pageNum),
				};
			});
		} catch (error) {
			console.error(`Error crawling page ${pageNum}:`, error);
			throw error;
		}
	}
	/**
	 * 全量更新列表机构
	 * **/
	async fullCrawl(startPage = 1) {
		const state = await NewCrawlState.findOne({ where: C_STATE_TYPE.full }) || await NewCrawlState.create(C_STATE_TYPE.full);
		if (state && state.status === 'running') {
			throw new Error('fullCrawl already in progress');
		}
		let currentPage = startPage;
		let hasMoreData = true;
		
		try {
			await this.initListPage();
			state.status = 'running';
			await state.save();
			
			while (hasMoreData) {
				if (!this.listPage) {
					throw new Error('fullCrawl外层拦截，本次遍历结束。应该开启了下一次。【网页不见了】');
				}
				console.log(`Crawling page ${currentPage}...`);
				
				const data = await retry(
					async () => {
						return await this.crawlPage(currentPage);
					},
					{
						retries: 3,
						minTimeout: 2000,
						maxTimeout: 5000
					}
				);
				
				if (data?.length === 0) {
					hasMoreData = false;
					continue;
				}
				
				// 获取所有字段，排除不需要更新的字段
				const fieldsToUpdate = Object.keys(Fundraising.Project.rawAttributes).filter(field =>
					!['id', 'projectLink', 'createdAt', 'updatedAt'].includes(field)
				);
				
				// 执行 bulkCreate 时使用动态字段列表
				await Fundraising.Project.bulkCreate(data, {
					updateOnDuplicate: fieldsToUpdate
				});
				
				state.otherInfo = {
					...(state.otherInfo || {}),
					currentPage: currentPage
				};
				state.lastUpdateTime = new Date();
				await state.save();
				currentPage++;
				// Add delay between requests
				await new Promise(resolve => setTimeout(resolve, 1500));
			}
			
			state.status = 'completed';
			await state.save();
		} catch (error) {
			state.status = 'failed';
			state.error = error.message;
			await state.save();
			throw error;
		} finally {
			await this.close();
		}
	}
	/**
	 * 快速更新列表机构
	 * **/
	async quickUpdate() {
		try {
			const state = await NewCrawlState.findOne({ where: C_STATE_TYPE.quick }) || await NewCrawlState.create(C_STATE_TYPE.quick);
			if (state && state.status === 'running') {
				throw new Error('quickUpdate already in progress');
			}
			await this.initListPage();
			
			state.status = 'running';
			await state.save();
			
			// Only crawl first 3 pages for quick updates
			for (let page = 1; page <= 3; page++) {
				if (!this.listPage) {
					throw new Error('quickUpdate外层拦截，本次遍历结束。应该开启了下一次。【网页不见了】');
					return;
				}
				const data = await this.crawlPage(page);
				// 获取所有字段，排除不需要更新的字段
				const fieldsToUpdate = Object.keys(Fundraising.Project.rawAttributes).filter(field =>
					!['id', 'projectLink', 'createdAt', 'updatedAt'].includes(field)
				);
				
				// 执行 bulkCreate 时使用动态字段列表
				await Fundraising.Project.bulkCreate(data, {
					updateOnDuplicate: fieldsToUpdate
				});
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
			
			state.lastUpdateTime = new Date();
			state.status = 'completed';
			await state.save();
		} catch (error) {
			console.error('Quick update error:', error);
			throw error;
		} finally {
			await this.close();
		}
	}
	
	/**
	 * 爬取「isInitial true」的列表项目的【详情页】数据
	 * **/
	async detailsCrawl() {
		const state = await NewCrawlState.findOne({ where: C_STATE_TYPE.detail }) || await NewCrawlState.create(C_STATE_TYPE.detail);
		if (state && state.status === 'running') {
			throw new Error('Detail crawl already in progress');
		}
		
		try {
			console.log('开始爬取「isInitial true」的列表项目的【详情页】数据');
			await this.initDetailPage();
			
			// 查询第一类项目：isInitial 为 true 且没有 investmentsReceived，失败次数小于等于 5
			const initialProjectsToCrawl = await Fundraising.Project.findAll({
				where: {
					isInitial: true,
					'$investmentsReceived.id$': null,
					detailFailuresNumber: { [Op.lte]: 5 }
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
					// 按照 originalPageNumber 排序，NULL 值在最后
					[
						literal('CASE WHEN "originalPageNumber" IS NULL THEN 1 ELSE 0 END'),
						'ASC'
					],
					['originalPageNumber', 'ASC']
				]
			});
			console.log(initialProjectsToCrawl?.length || 0, '开始爬取这些项目的详情信息');
			state.status = 'running';
			state.error = null;
			state.otherInfo = {
				...(state.otherInfo || {}),
				total: initialProjectsToCrawl?.length
			};
			await state.save();
			let remainingCount = initialProjectsToCrawl?.length || 0;
			let failedCount = 0;
			for (const project of initialProjectsToCrawl) {
				if (!this.detailPage) {
					throw new Error('detailsCrawl外层拦截，本次遍历结束。应该开启了下一次。【网页不见了，Detail page not initialized】');
				}
				console.log(`开始爬取 ${project.projectName} - ${project.projectLink} 的详情信息...`);
				// 爬取项目详情逻辑
				try {
					await retry(
						async () => {
							return await this.scrapeAndUpdateProjectDetails(project, this.detailPage);
						},
						{
							retries: 3,
							minTimeout: 2000,
							maxTimeout: 5000
						}
					);
				} catch (err) {
					console.log(err);
					console.log(`${project.projectName} - ${project.projectLink}, 详情抓取失败了!! 继续下一个`);
					failedCount++;
					state.otherInfo = {
						...(state.otherInfo || {}),
						failed: failedCount
					};
				}
				// 更新计数器并赋值给 numberDetailsToCrawl
				remainingCount--;
				state.lastUpdateTime = new Date();
				state.otherInfo = {
					...(state.otherInfo || {}),
					remaining: remainingCount,
					projectLink: project.projectLink
				};
				await state.save();
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
			
			// 完成详情页爬取
			state.status = 'completed';
			await state.save();
			
		} catch (error) {
			state.status = 'failed';
			state.error = error.message;
			await state.save();
			throw error;
		} finally {
			await this.close();
		}
	}
	
	/**
	 * 爬取「isInitial false」的子项目的【详情页】数据
	 * **/
	async subDetailsCrawl() {
		const state = await NewCrawlState.findOne({ where: C_STATE_TYPE.detail2 }) || await NewCrawlState.create(C_STATE_TYPE.detail2);
		if (state && state.status === 'running') {
			throw new Error('subDetailsCrawl crawl already in progress');
		}
		try {
			console.log('开始爬取【sub】项目详情页数据=====')
			await this.initSocialPage();
			
			// 查询第二类项目：isInitial 为 false，失败次数小于等于 3，socialLinks 为空
			const nonInitialProjectsToCrawl = await Fundraising.Project.findAll({
				where: {
					isInitial: false,
					detailFailuresNumber: { [Op.lte]: 3 },
					socialLinks: null
				}
			});
			console.log(nonInitialProjectsToCrawl?.length || 0, '开始爬取这些【sub】项目的详情信息');
			state.status = 'running';
			state.error = null;
			state.otherInfo = {
				...(state.otherInfo || {}),
				total: nonInitialProjectsToCrawl?.length
			};
			await state.save();
			let remainingCount = nonInitialProjectsToCrawl?.length || 0;
			let failedCount = 0;
			for (const project of nonInitialProjectsToCrawl) {
				if (!this.socialPage) {
					throw new Error('subDetailsCrawl外层拦截，本次遍历结束。应该开启了下一次。【网页不见了，Detail page not initialized】');
				}
				console.log(`开始爬取【sub】 ${project.projectName} - ${project.projectLink} 的详情信息...`);
				try {
					await retry(
						async () => {
							return await this.scrapeAndUpdateProjectDetails(project, this.socialPage);
						},
						{
							retries: 3,
							minTimeout: 2000,
							maxTimeout: 5000
						}
					);
				} catch (err) {
					console.log(err);
					console.log(`【sub】${project.projectName} - ${project.projectLink}, 详情抓取失败了!! 继续下一个`);
					failedCount++;
					state.otherInfo = {
						...(state.otherInfo || {}),
						failed: failedCount
					};
				}
				remainingCount--;
				state.lastUpdateTime = new Date();
				state.otherInfo = {
					...(state.otherInfo || {}),
					remaining: remainingCount,
					projectLink: project.projectLink
				};
				await state.save();
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
			state.status = 'completed';
			await state.save();
		} catch (error) {
			state.status = 'failed';
			state.error = error.message;
			await state.save();
			throw error;
		} finally {
			await this.close();
		}
	}
	
	/**
	 * 传入一个项目数据库实例，和浏览器网页，开始爬取详情
	 * 会根据isInitial判断要不要继续深度爬取融资信息
	 * **/
	async scrapeAndUpdateProjectDetails(project, _page) {
		console.log(`Fetching details for ${project.projectName}...`);
		try {
			if (!_page) {
				throw new Error('网页不见了，Detail page not initialized');
			}
			// // 随机选择一个 User-Agent
			// const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
			// await _page.setUserAgent(randomUserAgent); // 设置 User-Agent
			
			await _page.goto(project.projectLink, {
				waitUntil: 'networkidle0',
				timeout: 10000
			});
			console.log('等待打开详情页。。。。。。');
			await _page.waitForSelector('.base_info', {
				timeout: 10000
			});
			
			await this.clickAllButtons(_page);
			console.log('开始抓取这个项目更详细的详细', project.projectLink);
			let relatedProjectLength = 0;
			if (project.isInitial) {
				relatedProjectLength = await this.processRounds(project, _page);
			}
			
			// Fetch additional data
			const details = await _page.evaluate(() => {
				// Extract social links
				const socialLinks = {};
				document.querySelectorAll('.links a').forEach(link => {
					const type = link.querySelector('span')?.textContent?.trim().toLowerCase();
					if (type && type !== 'undefined') {
						socialLinks[type] = link.href;
					}
				});
				
				// Extract team members
				const teamMembers = Array.from(document.querySelectorAll('.team_member .item')).map(member => ({
					name: member.querySelector('.content h2')?.textContent?.trim(),
					position: member.querySelector('.content p')?.textContent?.trim(),
					avatar: member.querySelector('.logo-wraper img')?.src || '',
					profileLink: member.querySelector('.card')?.href || ''
				}));
				
				const logo = document.querySelector('.detail_info_head .logo')?.src || '';
				const projectName = document.querySelector('.detail_info_head h1.name')?.textContent?.trim();
				
				return { socialLinks, teamMembers, projectName, logo };
			});
			const isCrawlSuccess = details.projectName && details.logo
				&& (Object.keys(details.socialLinks || {})?.length > 0);
			await project.update({
				projectName: details.projectName,
				logo: details.logo,
				socialLinks: details.socialLinks,
				teamMembers: details.teamMembers,
				/**
				 * 只有logo存在，且projectName也存在
				 * 和socialLinks存在时才更新detailFetchedAt字段，否则不更新
				 * **/
				detailFetchedAt: isCrawlSuccess ? +new Date() : null,
				/**
				 * relatedProjectLength 为 0 代表明确的没有关联项目，
				 * 没有关联项目的我们不要再请求了，直接返回99
				 * **/
				detailFailuresNumber: isCrawlSuccess ? relatedProjectLength <= 0 ? 99 : 0 : Number(project.detailFailuresNumber || 0) + 1
			});
			// console.log(`此项目抓取${isCrawlSuccess ? '成功' : '失败'}======,${project.projectName}`);
			if (!isCrawlSuccess) {
				throw new Error('Failed to fetch project details');
			}
			console.log(`============抓取详情成功 ${project.projectName} ${project.isInitial ? relatedProjectLength + '关联成功' : '非列表页项目不需要关联'}`);
			return true; //抓取成功
		} catch (error) {
			console.log(`============抓取详情失败 ${project.projectLink}`);
			await project.update({
				detailFailuresNumber: Number(project.detailFailuresNumber || 0) + 1
			});
			throw error;
		}
	}
	/**
	 * 传入一个项目数据库实例，和浏览器网页，开始爬取融资
	 * **/
	async processRounds(project, _page) {
		try {
			const roundsData = await _page.evaluate(() => {
				
				const rows = document.querySelectorAll('.investor tr');
				return Array.from(rows).slice(1).map(row => {
					const cells = row.querySelectorAll('td');
					
					return {
						round: cells[0]?.textContent?.trim(),
						amount: cells[1]?.textContent?.trim(),
						valuation: cells[2]?.textContent?.trim(),
						date: cells[3]?.textContent?.trim(),
						investors: Array.from(cells[4].querySelectorAll('a')).map(investor => {
							const name = investor.textContent.replace('*', '').trim();
							return {
								name,
								link: investor.href,
								lead: investor.textContent.includes('*')
							};
						})
					};
				});
			});
			const roundsDataFormatted = roundsData.map(_ => {
				return {
					..._,
					formattedAmount: parseAmount(_.amount),
					formattedValuation: parseAmount(_.valuation),
					timestamp: parseDate(_.date)
				};
			});
			
			// 批量处理投资人信息
			const investorProjectsPromises = roundsDataFormatted.flatMap((round) =>
				round.investors.map(async (investor) => {
					const projectLink = joinUrl(investor.link, investor.name);
					let investorProject = await Fundraising.Project.findOne({ where: { projectLink: projectLink } });
					if (!investorProject) {
						investorProject = await Fundraising.Project.create({
							projectName: investor.name,
							projectLink: projectLink,
							isInitial: false
						});
					}
					return {
						investorProjectId: investorProject.id,
						fundedProjectId: project.id,
						round: round.round,
						amount: round.amount,
						formattedAmount: round.formattedAmount,
						valuation: round.valuation,
						formattedValuation: round.formattedValuation,
						date: round.timestamp,
						lead: investor.lead
					};
				})
			);
			
			const investorProjects = await Promise.all(investorProjectsPromises);
			// 批量创建 InvestmentRelationships 记录
			await Fundraising.InvestmentRelationships.bulkCreate(investorProjects);
			return investorProjects?.length;
		} catch (error) {
			console.error(`Error processing rounds for ${project.projectName}:`, error);
			throw error;
		}
	}
	/**
	 * 点击需要点击的一些按钮
	 * **/
	async clickAllButtons(_page) {
		try {
			await _page.evaluate(() => {
				document.querySelectorAll('button').forEach(button => {
					if (/expand\s*more/i.test(button.textContent) || /rounds/i.test(button.textContent)) {
						console.log('发现详情页有展开更多按钮/rounds按钮，进行点击...');
						button.click();
					}
				});
			});
			await new Promise(resolve => setTimeout(resolve, 800)); // Wait for sections to load
		} catch (error) {
			console.error('Error expanding sections:', error);
		}
	}
}

module.exports = new FundraisingCrawler();
