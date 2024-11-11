const puppeteer = require('puppeteer');
const retry = require('async-retry');
const { CrawlState, Fundraising } = require('../models');
const baseRootDataURL = 'https://www.rootdata.com';
const { v4: uuidv4 } = require('uuid');
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
	path = path.replace(/([^:]\/)\/+/g, "$1");
	
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
		this.browser = await puppeteer.launch({
			headless: 'new',
			args: ['--no-sandbox', '--disable-setuid-sandbox']
		});
		this.page = await this.browser.newPage();
	}
	
	async initializeDetailPage() {
		if (!this.browser) {
			await this.initialize();
		}
		this.detailPage = await this.browser.newPage();
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
			await this.page.goto(`https://www.rootdata.com/Fundraising?page=${pageNum}`, {
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
		const state = await CrawlState.findOne({ where: { isFullCrawl: true } }) ||
			await CrawlState.create({ isFullCrawl: true });
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
				
				if (data.length === 0) {
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
			const state = await CrawlState.findOne({ where: { isFullCrawl: false } }) ||
				await CrawlState.create({ isFullCrawl: false });
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
		const crawlState = await CrawlState.findOne({ where: { isDetailCrawl: true } }) ||
			await CrawlState.create({ isDetailCrawl: true });
		if (crawlState && crawlState.status === 'running') {
			throw new Error('Detail crawl already in progress');
		}
		
		try {
			await this.initializeDetailPage();
			
			// 获取需要爬取详情的项目列表
			const projectsToCrawl = await Fundraising.Project.findAll({ where: { detailFetchedAt: null } });
			crawlState.status = 'running';
			crawlState.error = null;
			crawlState.numberDetailsToCrawl = projectsToCrawl.length;
			await crawlState.save();
			let remainingCount = projectsToCrawl.length;
			
			for (const project of projectsToCrawl) {
				console.log(`开始爬取 ${project.projectName} - ${project.projectLink} 的详情信息...`);
				// 爬取项目详情逻辑
				await this.scrapeAndUpdateProjectDetails(project);
				
				// 更新 crawlState 的信息
				crawlState.lastProjectLink = project.projectLink;
				crawlState.lastUpdateTime = new Date();
				// 更新计数器并赋值给 numberDetailsToCrawl
				remainingCount--;
				crawlState.numberDetailsToCrawl = remainingCount;
				await crawlState.save();
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
			await this.detailPage.goto(project.projectLink, {
				waitUntil: 'networkidle0',
				timeout: 20000
			});
			console.log('等待打开网页。。。。。');
			await this.detailPage.waitForSelector('.container');
			console.log('打开详情页成功。。。。。');
			
			// Expand all sections
			await this.expandAllSections();
			
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
			// console.log('更新某个项目的信息..........start', JSON.stringify(details), '更新某个项目的信息..........end');
			// Save details to project
			await project.update({
				projectName: details.projectName,
				logo: details.logo,
				socialLinks: details.socialLinks,
				teamMembers: details.teamMembers,
				detailFetchedAt: +new Date()
			});
			console.log('开始抓取这个项目更详细的详细', project.projectLink);
			// Process Fundraising and Investment rounds
			await this.processRounds(project);
			console.log('此项目抓取完毕', project.projectName, '继续下一项..');
			
		} catch (error) {
			console.error(`Error fetching details for ${project.projectName}:`, error);
		}
	}
	
	async processRounds(project) {
		try {
			// Switch to Fundraising Rounds tab
			await this.detailPage.evaluate(() => {
				document.querySelectorAll('button').forEach(button => {
					if (/rounds/i.test(button.textContent)) {
						console.log('发现页面的rounds按钮，进行点击');
						button.click();
					}
				});
			});
			await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for rounds to load
			await this.detailPage.waitForSelector('.investor .watermusk_table');
			
			const roundsData = await this.detailPage.evaluate(() => {
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
				
				const rows = document.querySelectorAll('.investor .watermusk_table tr');
				return Array.from(rows).slice(1).map(row => {
					const cells = row.querySelectorAll('td');
					
					return {
						round: cells[0]?.textContent?.trim(),
						amount: cells[1]?.textContent?.trim(),
						valuation: cells[2]?.textContent?.trim(),
						date: cells[3]?.textContent?.trim(),
						investors: Array.from(cells[4].querySelectorAll('a')).map(investor => ({
							name: investor.textContent.replace('*', '').trim(),
							link: investor.href,
							lead: investor.textContent.includes('*')
						}))
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
			
			// console.log('发现详情页的round', JSON.stringify(roundsDataFormatted));
			
			for (const round of roundsDataFormatted) {
				for (const investor of round.investors) {
					let investorProject = await Fundraising.Project.findOne({ where: { projectLink: investor.link } });
					if (!investorProject) {
						investorProject = await Fundraising.Project.create({
							projectName: investor.name,
							projectLink: joinUrl(investor.link, investor.name),
							isInitial: false
						});
					}
					// console.log(`${investorProject.projectName}与${project.projectName}进行了关联....`);
					await Fundraising.InvestmentRelationships.create({
						investorProjectId: investorProject.id,
						fundedProjectId: project.id,
						round: round.round,
						amount: round.amount,
						formattedAmount: round.formattedAmount,
						valuation: round.valuation,
						formattedValuation: round.formattedValuation,
						date: round.timestamp,
						lead: investor.lead
					});
				}
			}
		} catch (error) {
			console.error(`Error processing rounds for ${project.projectName}:`, error);
		}
	}
	
	async expandAllSections() {
		try {
			await this.detailPage.evaluate(() => {
				document.querySelectorAll('button').forEach(button => {
					if (/expand\s*more/i.test(button.textContent)) {
						console.log('发现详情页有展开更多按钮，进行点击...');
						button.click();
					}
				});
			});
			await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for sections to load
		} catch (error) {
			console.error('Error expanding sections:', error);
		}
	}
}

module.exports = new FundraisingCrawler();
