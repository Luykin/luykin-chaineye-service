const puppeteer = require('puppeteer');
const retry = require('async-retry');
const { CrawlState, Fundraising } = require('../models');

class FundraisingCrawler {
	constructor() {
		this.browser = null;
		this.page = null;
	}
	
	async initialize() {
		this.browser = await puppeteer.launch({
			headless: 'new',
			args: ['--no-sandbox', '--disable-setuid-sandbox']
		});
		this.page = await this.browser.newPage();
	}
	
	async close() {
		if (this.browser) {
			await this.browser.close();
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
				function parseAmount(valueStr) {
					if (!valueStr || valueStr === '--') return null;
					
					// 移除美元符号和空格
					valueStr = valueStr.replace('$', '').trim();
					
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
					}
					
					// 转换为浮点数并乘以相应的单位
					const value = parseFloat(valueStr);
					return isNaN(value) ? null : value * multiplier;
				}
				
				function parseDate(dateStr) {
					if (!dateStr) return null;
					
					const currentYear = new Date().getFullYear();
					let formattedDateStr;
					
					// 检查日期是否包含年份
					if (/^[A-Za-z]{3} \d{2}, \d{4}$/.test(dateStr)) {
						// 格式为 "Aug 01, 2023" 或 "Feb 22, 2022" 等，包含完整日期和年份
						formattedDateStr = dateStr;
					} else if (/^[A-Za-z]{3}, \d{4}$/.test(dateStr)) {
						// 格式为 "May, 2018"，仅有月份和年份
						formattedDateStr = dateStr.replace(',', '');
						formattedDateStr = `01 ${formattedDateStr}`; // 补上日
					} else if (/^[A-Za-z]{3} \d{2}$/.test(dateStr)) {
						// 格式为 "Oct 21" 等，没有年份
						formattedDateStr = `${dateStr}, ${currentYear}`;
					} else if (/^[A-Za-z]{3},? \d{4}$/.test(dateStr)) {
						// 格式为 "Jun, 2016" 等，带有月份和年份
						formattedDateStr = `01 ${dateStr.replace(',', '')}`;
					} else if (/^[A-Za-z]{3} \d{2}$/.test(dateStr)) {
						// 格式为 "Sep 16" 等，没有年份
						formattedDateStr = `${dateStr}, ${currentYear}`;
					} else {
						// 无法识别的格式
						return null;
					}
					
					// 将格式化后的日期字符串转换为时间戳
					const timestamp = Date.parse(formattedDateStr);
					return isNaN(timestamp) ? null : timestamp;
				}
				
				const rows = document.querySelectorAll('.main_container tr');
				
				const data = Array.from(rows).slice(1).map(async row => {
					const cells = row.querySelectorAll('td');
					const projectElement = cells[0]?.querySelector('a');
					const projectName = projectElement?.textContent?.trim();
					const projectLink = projectElement?.getAttribute('href');
					const projectDescription = cells[0]?.textContent?.trim().replace(projectName, '').trim();
					
					const amount = cells[2]?.textContent?.trim();
					const formattedAmount = parseAmount(amount);
					
					const valuation = cells[3]?.textContent?.trim();
					const formattedValuation = parseAmount(valuation);
					
					const date = cells[4]?.textContent?.trim();
					const fundedAt = parseDate(date);
					
					return {
						projectName,
						projectLink,
						description: projectDescription,
						round: cells[1]?.textContent?.trim(),
						amount,
						formattedAmount,
						valuation,
						formattedValuation,
						date,
						fundedAt,
						isInitial: true,
					};
				});
				
				// 使用 Promise.all 等待所有行的异步操作完成
				return await Promise.all(data);
			});
			console.log(fundraisingData, 'fundraisingData');
			
			return fundraisingData;
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
		
		try {
			// 标记开始详情页爬取
			crawlState.status = 'running';
			crawlState.error = null;
			await crawlState.save();
			
			// 获取需要爬取详情的项目列表
			const projectsToCrawl = await Fundraising.Project.findAll({ where: { detailFetchedAt: null } });
			
			for (const project of projectsToCrawl) {
				console.log(`开始爬取${projec.projectName}-${projec.projectLink}的详情信息啦....`)
				// 爬取项目详情逻辑
				await this.scrapeAndUpdateProjectDetails(project);
				
				crawlState.lastProjectLink = projec.projectLink;
				crawlState.lastUpdateTime = new Date();
				await crawlState.save();
			}
			
			// 完成详情页爬取
			crawlState.status = 'completed';
			await crawlState.save();
			
		} catch (error) {
			crawlState.status = 'failed';
			crawlState.error = error.message;
			await crawlState.save();
			throw error;
		}
	}
	
	async scrapeAndUpdateProjectDetails(project) {
		console.log(`Fetching details for ${project.projectName}...`);
		try {
			await this.page.goto(project.projectLink, {
				waitUntil: 'networkidle0',
				timeout: 30000
			});
			
			await this.page.waitForSelector('.container');
			
			// Expand all sections
			await this.expandAllSections();
			
			// Fetch additional data
			const details = await this.page.evaluate(() => {
				// Extract social links
				const socialLinks = {};
				document.querySelectorAll('.links a').forEach(link => {
					const type = link.querySelector('span')?.textContent?.trim().toLowerCase();
					socialLinks[type] = link.href;
				});
				
				// Extract team members
				const teamMembers = Array.from(document.querySelectorAll('.team_member .item')).map(member => ({
					name: member.querySelector('.content h2')?.textContent?.trim(),
					position: member.querySelector('.content p')?.textContent?.trim(),
					avatar: member.querySelector('.logo-wraper img')?.src || '',
					profileLink: member.querySelector('.card')?.href || ''
				}));
				
				return { socialLinks, teamMembers };
			});
			
			// Save details to project
			await project.update({
				socialLinks: details.socialLinks,
				teamMembers: details.teamMembers,
				detailFetchedAt: +new Date()
			});
			
			// Process Fundraising and Investment rounds
			await this.processRounds(project);
			
		} catch (error) {
			console.error(`Error fetching details for ${project.projectName}:`, error);
		}
	}
	
	async processRounds(project) {
		try {
			// Switch to Fundraising Rounds tab
			await this.page.evaluate(() => {
				document.querySelectorAll('button').forEach(button => {
					if (/rounds/i.test(button.textContent)) {
						console.log('发现页面的rounds按钮，进行点击');
						button.click();
					}
				});
			});
			await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for rounds to load
			await this.page.waitForSelector('.investor .watermusk_table');
			
			const roundsData = await this.page.evaluate(() => {
				const rows = document.querySelectorAll('.investor .watermusk_table tr');
				return Array.from(rows).slice(1).map(row => {
					const cells = row.querySelectorAll('td');
					
					function parseAmount(valueStr) {
						if (!valueStr || valueStr === '--') return null;
						
						// 移除美元符号和空格
						valueStr = valueStr.replace('$', '').trim();
						
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
						}
						
						// 转换为浮点数并乘以相应的单位
						const value = parseFloat(valueStr);
						return isNaN(value) ? null : value * multiplier;
					}
					
					function parseDate(dateStr) {
						if (!dateStr) return null;
						
						const currentYear = new Date().getFullYear();
						let formattedDateStr;
						
						// 检查日期是否包含年份
						if (/^[A-Za-z]{3} \d{2}, \d{4}$/.test(dateStr)) {
							// 格式为 "Aug 01, 2023" 或 "Feb 22, 2022" 等，包含完整日期和年份
							formattedDateStr = dateStr;
						} else if (/^[A-Za-z]{3}, \d{4}$/.test(dateStr)) {
							// 格式为 "May, 2018"，仅有月份和年份
							formattedDateStr = dateStr.replace(',', '');
							formattedDateStr = `01 ${formattedDateStr}`; // 补上日
						} else if (/^[A-Za-z]{3} \d{2}$/.test(dateStr)) {
							// 格式为 "Oct 21" 等，没有年份
							formattedDateStr = `${dateStr}, ${currentYear}`;
						} else if (/^[A-Za-z]{3},? \d{4}$/.test(dateStr)) {
							// 格式为 "Jun, 2016" 等，带有月份和年份
							formattedDateStr = `01 ${dateStr.replace(',', '')}`;
						} else if (/^[A-Za-z]{3} \d{2}$/.test(dateStr)) {
							// 格式为 "Sep 16" 等，没有年份
							formattedDateStr = `${dateStr}, ${currentYear}`;
						} else {
							// 无法识别的格式
							return null;
						}
						
						// 将格式化后的日期字符串转换为时间戳
						const timestamp = Date.parse(formattedDateStr);
						return isNaN(timestamp) ? null : timestamp;
					}
					
					return {
						round: cells[0]?.textContent?.trim(),
						amount: cells[1]?.textContent?.trim(),
						formattedAmount: parseAmount(cells[1]?.textContent),
						valuation: cells[2]?.textContent?.trim(),
						formattedValuation: parseAmount(cells[2]?.textContent),
						date: cells[3]?.textContent?.trim(),
						timestamp: parseDate(cells[3]?.textContent),
						investors: Array.from(cells[4].querySelectorAll('a')).map(investor => ({
							name: investor.textContent.trim(),
							link: investor.href,
							lead: investor.textContent.includes('*')
						}))
					};
				});
			});
			
			console.log('发现详情页的round', JSON.stringify(roundsData));
			
			for (const round of roundsData) {
				for (const investor of round.investors) {
					let investorProject = await Fundraising.Project.findOne({ where: { projectLink: investor.link } });
					if (!investorProject) {
						investorProject = await Fundraising.Project.create({
							projectName: investor.name,
							projectLink: investor.link,
							isInitial: false
						});
					}
					console.log(`${investorProject.projectName}与${project.projectName}进行了关联....`)
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
			await this.page.evaluate(() => {
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
