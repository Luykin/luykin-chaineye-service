const puppeteer = require('puppeteer');
const retry = require('async-retry');
const { CrawlState, Fundraising } = require('../models');
const baseRootDataURL = 'https://www.rootdata.com';
const { v4: uuidv4 } = require('uuid');
const { Op, literal } = require('sequelize');
// 定义不同的 User-Agent
// const userAgents = [
// 	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36',
// 	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36',
// 	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.71 Safari/537.36',
// 	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0',
// 	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
// 	'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
// 	'Mozilla/5.0 (Linux; Android 11; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.71 Mobile Safari/537.36',
// 	'Mozilla/5.0 (Linux; Android 10; SM-A505F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Mobile Safari/537.36',
// 	'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15A5341f Safari/604.1',
// 	'Mozilla/5.0 (Linux; Android 9; Mi 9T Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.62 Mobile Safari/537.36'
// ];

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
		this.page = null;
		this.detailPage = null;
	}
	
	async initialize() {
		// // 隧道服务器域名和端口
		// let tunnelhost = 'g887.kdlfps.com'
		// let tunnelport = '18866';
		this.browser = await puppeteer.launch({
			headless: 'new',
			args: [
				// `--proxy-server=${tunnelhost}:${tunnelport}`,
				'--no-sandbox',
				'--disable-setuid-sandbox'
			]
		});
		if (this.detailPage) {
			this.page?.close?.();
		}
		this.page = await this.browser.newPage();
	}
	
	async initializeDetailPage() {
		if (!this.browser) {
			await this.initialize();
		}
		if (this.detailPage) {
			this.detailPage?.close?.();
		}
		this.detailPage = await this.browser.newPage();
	}
	
	async forceClose() {
		try {
			await this.browser?.close?.();
			this.page = null;
			this.detailPage = null;
		} catch (err) {
			console.error('Error closing browser:', err);
		}
	}
	
	async close() {
		try {
			const [fullCrawl, quickUpdate, detailCrawl] = await Promise.all([
				CrawlState.findOne({ where: { isFullCrawl: true } }),
				CrawlState.findOne({ where: { isFullCrawl: false } }),
				CrawlState.findOne({ where: { isFullCrawl: false, isDetailCrawl: true } })
			]);
			if (fullCrawl.status === 'running' || quickUpdate.status === 'running' || detailCrawl.status === 'running') {
				console.log('Crawler is busy, cannot close.');
				return;
			}
			if (this.browser) {
				await this.browser.close();
			}
		} catch (err) {
			console.error('Error closing browser:', err);
		}
	}
	
	async crawlPage(pageNum) {
		try {
			if (!this.page) {
				await new Promise(resolve => setTimeout(resolve, 2000));
				throw new Error('crawlPage page not found');
			}
			await this.page?.goto(`https://www.rootdata.com/Fundraising?page=${pageNum}`, {
				waitUntil: 'networkidle0',
				timeout: 30000 // 设置超时
			});
			// 检查是否存在“没有数据”的行
			const isEmpty = await this.page.evaluate(() => {
				return !!document.querySelector('tr.b-table-empty-row');
			});
			if (isEmpty) return []; // 如果是空页面则返回空数组
			
			// Wait for the table to load
			await this.page.waitForSelector('.main_container');
			
			// Extract data
			const fundraisingData = await this.page.evaluate(async () => {
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
	
	async fullCrawl(startPage = 1) {
		let currentPage = startPage;
		let hasMoreData = true;
		const state = await CrawlState.findOne({ where: { isFullCrawl: true, isDetailCrawl: false } }) ||
			await CrawlState.create({ isFullCrawl: true, isDetailCrawl: false });
		if (state && state.status === 'running') {
			throw new Error('fullCrawl already in progress');
		}
		
		try {
			await this.initialize();
			state.status = 'running';
			await state.save();
			
			while (hasMoreData) {
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
				
				state.lastPage = currentPage;
				state.lastUpdateTime = new Date();
				await state.save();
				
				currentPage++;
				
				// Add delay between requests
				await new Promise(resolve => setTimeout(resolve, 2000));
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
	
	async quickUpdate() {
		try {
			await this.initialize();
			const state = await CrawlState.findOne({ where: { isFullCrawl: false, isDetailCrawl: false } }) ||
				await CrawlState.create({ isFullCrawl: false, isDetailCrawl: false });
			if (state && state.status === 'running') {
				throw new Error('quickUpdate already in progress');
			}
			
			state.status = 'running';
			await state.save();
			
			// Only crawl first 3 pages for quick updates
			for (let page = 1; page <= 3; page++) {
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
	
	async fetchProjectDetails() {
		const crawlState = await CrawlState.findOne({ where: { isDetailCrawl: true, isFullCrawl: false } }) ||
			await CrawlState.create({ isDetailCrawl: true });
		if (crawlState && crawlState.status === 'running') {
			throw new Error('Detail crawl already in progress');
		}
		
		try {
			await this.initializeDetailPage();
			
			// 获取需要爬取详情的项目列表
			const projectsToCrawl = await Fundraising.Project.findAll({
				where: {
					[Op.or]: [
						{
							isInitial: true,
							'$investmentsReceived.id$': null,
							detailFailuresNumber: { [Op.lte]: 3 }
						},
						{
							detailFetchedAt: null,
							detailFailuresNumber: { [Op.lte]: 3 }
						}
					]
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
					['isInitial', 'DESC'], // 优先 `isInitial` 为 true 的项目
					[literal('"investmentsReceived.id"'), 'ASC'], // 优先没有 `investmentsReceived` 的项目
					[
						literal(
							// 按 `originalPageNumber` 升序排列，`originalPageNumber` 为 `null` 的排在最后
							'CASE WHEN "originalPageNumber" IS NULL THEN 1 ELSE 0 END'
						),
						'ASC'
					],
					['originalPageNumber', 'ASC'] // 按 `originalPageNumber` 升序排列
				]
			});
			console.log(projectsToCrawl.length, '开始爬取这些项目的详情信息');
			// console.log('第一个项目为: ', projectsToCrawl[0].projectLink, projectsToCrawl[0].originalPageNumber);
			// console.log('第二个项目为: ', projectsToCrawl[1].projectLink, projectsToCrawl[1].originalPageNumber);
			// console.log('最后一个项目为:', projectsToCrawl[projectsToCrawl.length - 1].projectLink, projectsToCrawl[projectsToCrawl.length - 1].originalPageNumber);
			crawlState.status = 'running';
			crawlState.error = null;
			crawlState.numberDetailsToCrawl = projectsToCrawl.length;
			await crawlState.save();
			let remainingCount = projectsToCrawl.length;
			let failedCount = 0;
			for (const project of projectsToCrawl) {
				console.log(`开始爬取 ${project.projectName} - ${project.projectLink} 的详情信息...`);
				// 爬取项目详情逻辑
				try {
					await retry(
						async () => {
							return await this.scrapeAndUpdateProjectDetails(project);
						},
						{
							retries: 3,
							minTimeout: 2000,
							maxTimeout: 5000
						}
					);
				} catch (err) {
					console.log(err);
					console.log(`详情抓取失败了～ ${project.projectName} - ${project.projectLink}, 继续下一个`);
					failedCount++;
					crawlState.numberDetailsFailed = failedCount;
				}
				// 更新 crawlState 的信息
				crawlState.lastProjectLink = project.projectLink;
				crawlState.lastUpdateTime = new Date();
				// 更新计数器并赋值给 numberDetailsToCrawl
				remainingCount--;
				crawlState.numberDetailsToCrawl = remainingCount;
				await crawlState.save();
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
			
			// 完成详情页爬取
			crawlState.numberDetailsToCrawl = 0;
			crawlState.status = 'completed';
			await crawlState.save();
			
		} catch (error) {
			crawlState.status = 'failed';
			crawlState.error = error.message;
			await crawlState.save();
			throw error;
		} finally {
			await this.close();
		}
	}
	
	async scrapeAndUpdateProjectDetails(project) {
		console.log(`Fetching details for ${project.projectName}...`);
		try {
			if (!this.detailPage) {
				throw new Error('网页不见了，Detail page not initialized');
				return;
			}
			// // 随机选择一个 User-Agent
			// const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
			// await this.detailPage.setUserAgent(randomUserAgent); // 设置 User-Agent
			
			await this.detailPage.goto(project.projectLink, {
				waitUntil: 'networkidle0',
				timeout: 10000
			});
			console.log('等待打开详情页。。。。。。');
			await this.detailPage.waitForSelector('.base_info', {
				timeout: 10000
			});
			console.log('打开详情页成功。。。。。');
			
			// Expand all sections
			await this.expandAllSections();
			console.log('开始抓取这个项目更详细的详细', project.projectLink);
			let relatedProjectLength = 0;
			if (project.isInitial) {
				relatedProjectLength = await this.processRounds(project);
			}
			
			// Fetch additional data
			const details = await this.detailPage.evaluate(() => {
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
	
	async processRounds(project) {
		try {
			const roundsData = await this.detailPage.evaluate(() => {
				
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
	
	async expandAllSections() {
		try {
			await this.detailPage.evaluate(() => {
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
