const puppeteer = require('puppeteer');
const retry = require('async-retry');
const { Fundraising, CrawlState } = require('../models');

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
					} else if (/^[A-Za-z]{3} \d{2}$/.test(dateStr)) {
						// 格式为 "Oct 21" 等，没有年份
						formattedDateStr = `${dateStr}, ${currentYear}`;
					} else {
						// 无法识别的格式
						return null;
					}
					
					// 将格式化后的日期字符串转换为 Date 对象
					const formattedDate = new Date(formattedDateStr);
					return isNaN(formattedDate.getTime()) ? null : formattedDate;
				}
				const rows = document.querySelectorAll('.main_container tr');
				
				const data = Array.from(rows).slice(1).map(async row => {
					const cells = row.querySelectorAll('td');
					const projectDescription = cells[0]?.textContent?.trim();
					const projectName = projectDescription.split('\n').pop().trim(); // 提取项目名称
					const description = projectDescription.replace(projectName, '').trim(); // 提取描述
					
					// 初始化投资人信息数组
					let fullInvestors = [];
					
					// 检查是否存在 'moreBtn' 按钮
					const moreBtn = cells[5]?.querySelector('.more_btn');
					if (moreBtn) {
						// 点击 'moreBtn' 以显示完整投资人列表
						moreBtn.click();
						await new Promise(resolve => setTimeout(resolve, 1000)); // 等待弹窗加载
						
						// 从弹框中获取投资人信息
						const dialogContent = document.querySelectorAll('.dialog_content .item');
						fullInvestors = Array.from(dialogContent).map(item => ({
							name: item.querySelector('span.ml-1')?.textContent.trim(),
							link: item?.href
						}));
						
						// 关闭弹框
						const closeBtn = document.querySelector('.dialog_close');
						if (closeBtn) closeBtn.click();
						await new Promise(resolve => setTimeout(resolve, 500));
					} else {
						// 没有 'moreBtn' 时直接提取投资人信息
						const investorItems = cells[5].querySelectorAll('.list_container a');
						fullInvestors = Array.from(investorItems).map(item => ({
							name: item.querySelector('span')?.textContent.trim(),
							link: item.getAttribute('href')
						}));
					}
					const amount = cells[2]?.textContent?.trim();
					const formattedAmount = parseAmount(amount);
					
					const valuation = cells[3]?.textContent?.trim();
					const formattedValuation = parseAmount(valuation);
					
					const date = cells[4]?.textContent?.trim();
					const formattedDate = parseDate(date);
					
					return {
						projectName,
						description,
						round: cells[1]?.textContent?.trim(),
						amount,
						formattedAmount,
						valuation,
						formattedValuation,
						date,
						formattedDate,
						investors: fullInvestors
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
				
				await Fundraising.bulkCreate(data, {
					updateOnDuplicate: ['amount', 'investors', 'round', 'valuation', 'formattedValuation', 'date', 'formattedDate', 'description', 'formattedAmount']
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
				await Fundraising.bulkCreate(data, {
					updateOnDuplicate: ['amount', 'investors', 'round', 'valuation', 'formattedValuation', 'date', 'formattedDate', 'description', 'formattedAmount']
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
}

module.exports = new FundraisingCrawler();
