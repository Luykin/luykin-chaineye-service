const express = require('express');
const { query, validationResult } = require('express-validator');
const { Fundraising, NewCrawlState, C_STATE_TYPE } = require('../models');
const crawler = require('../services/crawler');
const { Op } = require('sequelize');
const router = express.Router();
// 过滤函数：优先从 projectLink 提取项目名称进行匹配，若无结果则使用 description 中的末尾名称
const filterMismatchedFunction = (project) => {
	const projectNameEncoded = encodeURI(project.projectName).toLocaleLowerCase();
	const projectNameEncoded2 = encodeURIComponent(project.projectName).toLocaleLowerCase();
	
	// 优先从 projectLink 中提取名称，支持特殊字符（如点、空格、冒号等）
	const linkMatch = project.projectLink.match(/\/Projects\/detail\/([A-Za-z0-9.%: ]+)/);
	let extractedName = linkMatch ? linkMatch[1].toLocaleLowerCase() : null;
	
	// 返回项目名称不一致的记录
	return projectNameEncoded && extractedName &&
		!extractedName.includes(projectNameEncoded) && !projectNameEncoded.includes(extractedName) &&
		!extractedName.includes(projectNameEncoded2) && !projectNameEncoded2.includes(extractedName);
};

function convertUTCToBeijingTime(utcDateString) {
	const date = new Date(utcDateString);  // 将字符串转换为 Date 对象
	return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });  // 使用北京时间格式
}

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
				'detailFailuresNumber', 'originalPageNumber', 'isInitial'
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

// 添加路由，用于关键词搜索项目
router.get('/search', async (req, res) => {
	try {
		const { keyword } = req.query;
		
		// 检查是否提供有效的关键词
		if (!keyword || !keyword.trim()) {
			return res.json({ data: [], total: 0 });
		}
		
		// 清理关键词，移除多余空格
		const sanitizedKeyword = keyword.trim();
		
		// 使用 Sequelize 操作符进行关键词搜索，避免直接拼接防止注入
		const data = await Fundraising.Project.findAll({
			where: {
				[Op.or]: [
					{ projectName: { [Op.like]: `%${sanitizedKeyword}%` } },
					{ description: { [Op.like]: `%${sanitizedKeyword}%` } }
				]
			},
			limit: 10, // 限制结果最多返回10条记录
			attributes: [
				'projectName', 'projectLink', 'description', 'logo', 'round',
				'amount', 'formattedAmount', 'valuation', 'formattedValuation',
				'date', 'fundedAt', 'detailFetchedAt', 'socialLinks', 'teamMembers',
				'detailFailuresNumber', 'originalPageNumber', 'isInitial'
			],
			include: [
				{
					model: Fundraising.InvestmentRelationships,
					as: 'investmentsReceived', // 当前项目作为被投资方的记录
					attributes: ['round', 'lead', 'amount', 'valuation', 'formattedAmount', 'formattedValuation', 'date'],
					include: [
						{
							model: Fundraising.Project,
							as: 'investorProject', // 出资方项目
							attributes: ['projectName', 'projectLink', 'socialLinks']
						}
					]
				}
			]
		});
		
		// 格式化 investmentsReceived 数据，以日期进行分组
		const formattedData = data.map(project => {
			const investmentsByDate = groupInvestmentsByDate(project.investmentsReceived);
			return {
				...project.get(),
				investmentsReceived: investmentsByDate
			};
		});
		
		res.json({
			data: formattedData,
			total: data.length
		});
	} catch (error) {
		console.error('Error searching projects:', error);
		res.status(500).json({ error: 'Failed to search projects' });
	}
});

// Start full crawl
router.post('/crawl/full', async (req, res) => {
	try {
		const state = await NewCrawlState.findOne({ where: C_STATE_TYPE.full });
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
		const state = await NewCrawlState.findOne({ where: C_STATE_TYPE.quick });
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
		crawler.detailsCrawl().catch(console.error);
		crawler.subDetailsCrawl().catch(console.error);
		res.json({ message: 'Detail crawl started' });
	} catch (error) {
		console.error('Error starting detail crawl:', error);
		res.status(500).json({ error: 'Failed to start detail crawl' });
	}
});

// Start detail crawl
router.post('/crawl/repair', async (req, res) => {
	try {
		crawler.correctDetailed().catch(console.error);
		res.json({ message: 'correctDetailed started' });
	} catch (error) {
		console.error('Error starting repair crawl:', error);
		res.status(500).json({ error: 'Failed to start repair crawl' });
	}
});

// Start detail crawl
router.post('/crawl/retry', async (req, res) => {
	try {
		crawler.failedReTryCrawl().catch(console.error);
		res.json({ message: 'failedReTryCrawl started' });
	} catch (error) {
		console.error('Error starting failedReTryCrawl crawl:', error);
		res.status(500).json({ error: 'Failed to start failedReTryCrawl crawl' });
	}
});

// Set all crawl statuses to idle
router.post('/status/reset', async (req, res) => {
	try {
		// 更新所有 NewCrawlState 条目，将状态设为 'idle'，并清空错误信息
		await NewCrawlState.update(
			{
				status: 'idle',
				error: null,
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

// 查看所有失败的项目（带分页）
router.get('/failed', async (req, res) => {
	try {
		// 获取分页参数，默认值为 page 1，每页 10 条记录
		const page = parseInt(req.query.page) || 1;
		const pageSize = parseInt(req.query.pageSize) || 10;
		
		// 计算 offset 和 limit
		const offset = (page - 1) * pageSize;
		const limit = pageSize;
		
		// 查询符合条件的项目，并添加分页
		const { rows: projects, count: total } = await Fundraising.Project.findAndCountAll({
			where: {
				detailFailuresNumber: { [Op.gt]: 3, [Op.lt]: 99 },
				isInitial: true,
				projectLink: { [Op.like]: 'http%' }
			},
			offset,
			limit,
			order: [['createdAt', 'DESC']] // 可选：按创建时间排序
		});
		
		res.json({
			total,
			page,
			pageSize,
			totalPages: Math.ceil(total / pageSize),
			projects
		});
	} catch (error) {
		console.error('Error fetching filtered projects:', error);
		res.status(500).json({ error: 'Failed to fetch filtered projects' });
	}
});

// 查询爬虫爬错误的项目
router.get('/mismatched', async (req, res) => {
	try {
		// 获取分页参数，默认第一页，每页10条记录
		const page = parseInt(req.query.page) || 1;
		const pageSize = parseInt(req.query.pageSize) || 10;
		const offset = (page - 1) * pageSize;
		
		// 初步筛选：获取 description 不为空且 projectLink 以 http 开头的项目
		const initialProjects = await Fundraising.Project.findAll({
			where: {
				description: { [Op.not]: null },
				projectLink: { [Op.like]: 'http%' }
			},
			// attributes: ['projectName', 'description', 'projectLink'],
		});
		const filteredProjects = initialProjects.filter(filterMismatchedFunction);
		
		// 计算总数
		const total = filteredProjects.length;
		
		// 对过滤结果进行分页
		const paginatedProjects = filteredProjects.slice(offset, offset + pageSize);
		
		res.json({
			total,
			page,
			pageSize,
			totalPages: Math.ceil(total / pageSize),
			projects: paginatedProjects
		});
	} catch (error) {
		console.error('Error fetching mismatched projects:', error);
		res.status(500).json({ error: 'Failed to fetch mismatched projects' });
	}
});

// Get crawl status
router.get('/status', async (req, res) => {
	try {
		const [full, quick, detail, detail2, spare] = await Promise.all([
			NewCrawlState.findOne({ where: C_STATE_TYPE.full }),
			NewCrawlState.findOne({ where: C_STATE_TYPE.quick }),
			NewCrawlState.findOne({ where: C_STATE_TYPE.detail }),
			NewCrawlState.findOne({ where: C_STATE_TYPE.detail2 }),
			NewCrawlState.findOne({ where: C_STATE_TYPE.spare })
		]);
		
		// 初始化 projectDetails 为 null
		let projectDetails = null;
		let projectDetails2 = null;
		
		// 如果 detail 存在，则根据 projectLink 查询 Project 的 projectLink, projectName 和 originalPageNumber
		if (detail && detail?.otherInfo?.projectLink) {
			const project = await Fundraising.Project.findOne({
				where: { projectLink: detail?.otherInfo?.projectLink },
				attributes: ['projectLink', 'projectName', 'originalPageNumber', 'detailFailuresNumber']
			});
			projectDetails = project ? {
				projectLink: project.projectLink,
				projectName: project.projectName,
				originalPageNumber: project.originalPageNumber,
				detailFailuresNumber: project.detailFailuresNumber
			} : null;
		}
		if (detail2 && detail2?.otherInfo?.projectLink) {
			const project = await Fundraising.Project.findOne({
				where: { projectLink: detail2?.otherInfo?.projectLink },
				attributes: ['projectLink', 'projectName', 'originalPageNumber', 'detailFailuresNumber']
			});
			projectDetails2 = project ? {
				projectLink: project.projectLink,
				projectName: project.projectName,
				originalPageNumber: project.originalPageNumber,
				detailFailuresNumber: project.detailFailuresNumber
			} : null;
		}
		
		res.json({
			full: full ? {
				status: full.status,
				lastUpdate: convertUTCToBeijingTime(full.lastUpdateTime),
				error: full.error,
				otherInfo: full?.otherInfo
			} : null,
			quick: quick ? {
				status: quick.status,
				lastUpdate: convertUTCToBeijingTime(quick.lastUpdateTime),
				error: quick.error,
				otherInfo: quick?.otherInfo
			} : null,
			detail: detail ? {
				status: detail.status,
				lastUpdate: convertUTCToBeijingTime(detail.lastUpdateTime),
				error: detail.error,
				otherInfo: detail?.otherInfo,
				projectDetails: projectDetails,
				quickView: `http://148.251.131.206:8087/api/fundraising/search?keyword=${encodeURIComponent(projectDetails?.projectName)}`
			} : null,
			detail2: detail2 ? {
				status: detail2.status,
				lastUpdate: convertUTCToBeijingTime(detail2.lastUpdateTime),
				error: detail2.error,
				otherInfo: detail2?.otherInfo,
				projectDetails: projectDetails2,
				quickView: `http://148.251.131.206:8087/api/fundraising/search?keyword=${encodeURIComponent(projectDetails2?.projectName)}`
			} : null,
			spare: spare ? {
				status: spare.status,
				lastUpdate: convertUTCToBeijingTime(spare.lastUpdateTime),
				error: spare.error,
				otherInfo: spare?.otherInfo
			} : null
		});
	} catch (error) {
		console.error('Error fetching crawl status:', error);
		res.status(500).json({ error: 'Failed to fetch crawl status' });
	}
});

module.exports = router;
