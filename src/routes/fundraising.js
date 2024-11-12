const express = require('express');
const { query, validationResult } = require('express-validator');
const { Fundraising, CrawlState } = require('../models');
const crawler = require('../services/crawler');

const router = express.Router();

// Validation middleware
const validatePagination = [
	query('page').optional().isInt({ min: 1 }),
	query('limit').optional().isInt({ min: 5, max: 50 })
];

const groupInvestmentsByDate = (investmentsReceived) => {
	return investmentsReceived.reduce((acc, investment) => {
		const dateKey = investment.date;
		if (!acc[dateKey]) {
			acc[dateKey] = {
				round: investment.round,
				amount: investment.amount,
				valuation: investment.valuation,
				formattedAmount: investment.formattedAmount,
				formattedValuation: investment.formattedValuation,
				investors: []
			};
		}
		
		acc[dateKey].investors.push({
			lead: investment.lead,
			projectName: investment.investorProject.projectName,
			projectLink: investment.investorProject.projectLink,
			socialLinks: investment.investorProject.socialLinks
		});
		
		return acc;
	}, {});
};

// Express route
router.get('/', validatePagination, async (req, res) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		
		// 获取查询参数
		const { originalPageNumber, page = 1, limit = 30, sort } = req.query;
		const sortField = sort === 'fundedAt' ? 'fundedAt' : null;
		const sortOrder = sortField === 'fundedAt' ? 'DESC' : 'ASC';
		const order = sortField ? [[sortField, sortOrder]] : [];
		
		let whereConditions = { isInitial: true };
		let queryOptions = { order };
		
		// 处理 originalPageNumber 逻辑
		if (originalPageNumber) {
			whereConditions.originalPageNumber = parseInt(originalPageNumber);
			queryOptions.where = whereConditions;
		} else {
			// 使用分页逻辑
			const offset = (parseInt(page) - 1) * parseInt(limit);
			queryOptions = {
				...queryOptions,
				where: whereConditions,
				limit: parseInt(limit),
				offset
			};
		}
		
		// 查询数据
		const data = await Fundraising.Project.findAndCountAll({
			...queryOptions,
			attributes: [
				'projectName', 'projectLink', 'description', 'logo', 'round',
				'amount', 'formattedAmount', 'valuation', 'formattedValuation',
				'date', 'fundedAt', 'detailFetchedAt', 'socialLinks', 'teamMembers',
				'detailFailuresNumber', 'originalPageNumber'
			],
			include: [
				{
					model: Fundraising.InvestmentRelationships,
					as: 'investmentsReceived',
					attributes: ['round', 'lead', 'amount', 'valuation', 'formattedAmount', 'formattedValuation', 'date'],
					include: [
						{
							model: Fundraising.Project,
							as: 'investorProject',
							attributes: ['projectName', 'projectLink', 'socialLinks']
						}
					]
				}
			]
		});
		
		// 格式化和分组 investmentsReceived 按日期
		const formattedData = data.rows.map(project => {
			const investmentsByDate = groupInvestmentsByDate(project.investmentsReceived);
			return {
				...project.get(),
				investmentsReceived: investmentsByDate
			};
		});
		
		// 构建响应数据
		const response = { data: formattedData };
		if (!originalPageNumber) {
			response.total = data.count;
			response.page = parseInt(page);
			response.totalPages = Math.ceil(data.count / limit);
		}
		
		res.json(response);
	} catch (error) {
		console.error('Error fetching fundraising data:', {
			message: error.message,
			stack: error.stack,
			query: req.query
		});
		res.status(500).json({ error: 'Failed to fetch data' });
	}
});

// Start full crawl
router.post('/crawl/full', async (req, res) => {
	try {
		const state = await CrawlState.findOne({ where: { isFullCrawl: true, isDetailCrawl: false } });
		if (state && state.status === 'running') {
			return res.status(400).json({ error: 'Full crawl already in progress' });
		}
		
		// Start crawl in background
		crawler.fullCrawl().catch(console.error);
		res.json({ message: 'Full crawl started' });
	} catch (error) {
		console.error('Error starting full crawl:', error);
		res.status(500).json({ error: 'Failed to start full crawl' });
	}
});

// Start quick update
router.post('/crawl/quick', async (req, res) => {
	try {
		const state = await CrawlState.findOne({ where: { isFullCrawl: false, isDetailCrawl: false } });
		if (state && state.status === 'running') {
			return res.status(400).json({ error: 'Quick update already in progress' });
		}
		
		// Start quick update in background
		crawler.quickUpdate().catch(console.error);
		res.json({ message: 'Quick update started' });
	} catch (error) {
		console.error('Error starting quick update:', error);
		res.status(500).json({ error: 'Failed to start quick update' });
	}
});

// Start detail crawl
router.post('/crawl/detail', async (req, res) => {
	try {
		const state = await CrawlState.findOne({ where: { isDetailCrawl: true, isFullCrawl: false } });
		if (state && state.status === 'running') {
			return res.status(400).json({ error: 'Detail crawl already in progress' });
		}
		
		// Start crawl in background
		crawler.fetchProjectDetails().catch(console.error);
		res.json({ message: 'Detail crawl started' });
	} catch (error) {
		console.error('Error starting detail crawl:', error);
		res.status(500).json({ error: 'Failed to start detail crawl' });
	}
});

// Set all crawl statuses to idle
router.post('/status/reset', async (req, res) => {
	try {
		// 更新所有 CrawlState 条目，将状态设为 'idle'，并清空错误信息
		await CrawlState.update(
			{
				status: 'idle',
				error: null,
				lastPage: null,
				lastProjectLink: null,
				numberDetailsToCrawl: null
			},
			{
				where: {} // 空条件表示更新所有记录
			}
		);
		
		res.json({ message: 'All crawl statuses reset to idle' });
	} catch (error) {
		console.error('Error resetting crawl statuses:', error);
		res.status(500).json({ error: 'Failed to reset crawl statuses' });
	}
});

// Get crawl status
router.get('/status', async (req, res) => {
	try {
		const [fullCrawl, quickUpdate, detailCrawl] = await Promise.all([
			CrawlState.findOne({ where: { isFullCrawl: true, isDetailCrawl: false } }),
			CrawlState.findOne({ where: { isFullCrawl: false, isDetailCrawl: false } }),
			CrawlState.findOne({ where: { isFullCrawl: false, isDetailCrawl: true } })
		]);
		
		res.json({
			fullCrawl: fullCrawl ? {
				status: fullCrawl.status,
				lastPage: fullCrawl.lastPage,
				lastUpdate: fullCrawl.lastUpdateTime,
				error: fullCrawl.error
			} : null,
			quickUpdate: quickUpdate ? {
				status: quickUpdate.status,
				lastUpdate: quickUpdate.lastUpdateTime,
				error: quickUpdate.error
			} : null,
			detailCrawl: detailCrawl ? {
				status: detailCrawl.status,
				numberDetailsToCrawl: detailCrawl.numberDetailsToCrawl,
				lastProjectLink: detailCrawl.lastProjectLink,
				lastUpdate: detailCrawl.lastUpdateTime,
				numberDetailsFailed: detailCrawl.numberDetailsFailed,
				error: detailCrawl.error
			} : null
		});
	} catch (error) {
		console.error('Error fetching crawl status:', error);
		res.status(500).json({ error: 'Failed to fetch crawl status' });
	}
});

module.exports = router;
