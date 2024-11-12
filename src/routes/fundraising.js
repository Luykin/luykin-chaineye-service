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

// Get fundraising data with pagination
router.get('/', validatePagination, async (req, res) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 30;
		const offset = (page - 1) * limit;
		
		// 优化排序字段
		const sortField = req.query.sort === 'fundedAt' ? 'fundedAt' : null;
		const sortOrder = sortField === 'fundedAt' ? 'DESC' : 'ASC';
		
		// 构建排序条件，若无排序字段则为空数组
		const order = sortField ? [[sortField, sortOrder]] : [];
		
		const data = await Fundraising.Project.findAndCountAll({
			where: { isInitial: true }, // 仅筛选 isInitial 为 true 的数据
			attributes: [
				'projectName',
				'projectLink',
				'description',
				'logo',
				'round',
				'amount',
				'formattedAmount',
				'valuation',
				'formattedValuation',
				'date',
				'fundedAt',
				'detailFetchedAt',
				'socialLinks',
				'teamMembers',
				'detailFailuresNumber'
			], // 选择必要的字段，减少传输数据
			limit,
			offset,
			order,
			include: [
				{
					model: Fundraising.InvestmentRelationships,
					as: 'investmentsGiven', // 当前项目作为投资方的记录
					attributes: ['round', 'lead', 'amount', 'valuation', 'date'],
					include: [
						{
							model: Fundraising.Project,
							as: 'fundedProject',
							attributes: ['id', 'projectName', 'projectLink', 'socialLinks']
						} // 被投项目
					]
				},
				{
					model: Fundraising.InvestmentRelationships,
					as: 'investmentsReceived', // 当前项目作为被投资方的记录
					attributes: ['round', 'lead', 'amount', 'valuation', 'date'],
					include: [
						{
							model: Fundraising.Project,
							as: 'investorProject',
							attributes: ['id', 'projectName', 'projectLink', 'socialLinks']
						} // 出资方项目
					]
				}
			]
		});
		
		res.json({
			data: data.rows,
			total: data.count,
			page,
			totalPages: Math.ceil(data.count / limit)
		});
	} catch (error) {
		console.error('Error fetching fundraising data:', {
			message: error.message,
			stack: error.stack,
			query: req.query // 记录请求参数，便于调试
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
				error: detailCrawl.error
			} : null
		});
	} catch (error) {
		console.error('Error fetching crawl status:', error);
		res.status(500).json({ error: 'Failed to fetch crawl status' });
	}
});

module.exports = router;
