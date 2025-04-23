const express = require('express');
const { query, validationResult } = require('express-validator');
const { Fundraising, NewCrawlState, C_STATE_TYPE } = require('../models/sqlite-start');
// const crawler = require('../services/rootdata-crawler');
const { Op, literal, fn, col } = require('sequelize');
const router = express.Router();
const CACHE_TTL = 300; // 缓存时间限制（秒），此处设为5分钟
const CACHE_TTL_LONG = 600; // 缓存时间限制（秒），此处设为10分钟

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
			socialLinks: investment.investorProject.socialLinks,
			logo: investment.investorProject?.logo,
		});
		
		return acc;
	}, {});
};

// 分页查询接口
router.get('/', validatePagination, async (req, res) => {
	try {
		const { originalPageNumber, page = 1, limit = 30, sort } = req.query;
		const sortField = sort === 'fundedAt' ? 'fundedAt' : null;
		const sortOrder = sortField === 'fundedAt' ? 'DESC' : 'ASC';
		
		const cacheKey = `projects_${originalPageNumber}_${page}_${limit}_${sort}`;
		let cachedData;
		
		// 从 Redis 获取缓存数据，处理 Redis 客户端可能断开的情况
		try {
			cachedData = await req.redisClient.get(cacheKey);
		} catch (error) {
			console.error('Redis Client Error (GET):', error);
		}
		
		if (cachedData) {
			res.set('Cache-Control', 'public, max-age=60'); // 缓存 1 分钟
			res.set('X-Cache-Status', 'HIT'); // 标记数据来自缓存
			return res.json(JSON.parse(cachedData));
		}
		
		let whereConditions = { isInitial: true };
		let queryOptions = {
			order: sortField ? [[sortField, sortOrder]] : []
		};
		
		if (originalPageNumber) {
			whereConditions.originalPageNumber = parseInt(originalPageNumber);
			queryOptions.where = whereConditions;
		} else {
			const offset = (parseInt(page) - 1) * parseInt(limit);
			queryOptions = {
				...queryOptions,
				where: whereConditions,
				limit: parseInt(limit),
				offset
			};
		}
		
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
		
		const formattedData = data.rows.map(project => {
			const investmentsByDate = groupInvestmentsByDate(project.investmentsReceived);
			return {
				...project.get(),
				investmentsReceived: investmentsByDate
			};
		});
		
		const response = { data: formattedData };
		if (!originalPageNumber) {
			response.total = data.count;
			response.page = parseInt(page);
			response.totalPages = Math.ceil(data.count / limit);
		}
		
		// 将数据缓存到 Redis，处理 Redis 客户端可能断开的情况
		try {
			await req.redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(response));
		} catch (error) {
			console.error('Redis Client Error (SET):', error);
		}
		
		res.set('Cache-Control', 'public, max-age=60'); // 缓存 1 分钟
		res.set('X-Cache-Status', 'MISS'); // 标记数据来自数据库
		res.json(response);
	} catch (error) {
		console.error('Error fetching fundraising data:', error);
		res.status(500).json({ error: 'Failed to fetch data' });
	}
});

// 精确关键词搜索接口
router.get('/search', async (req, res) => {
	try {
		const { keyword } = req.query;
		
		if (!keyword || !keyword.trim() || String(keyword).length < 2) {
			return res.json({ data: null, message: 'No keyword provided' });
		}
		
		const sanitizedKeyword = keyword.trim();
		const cacheKey = `project_search_${sanitizedKeyword}_202412182269`;
		let cachedData;
		
		// 从 Redis 获取缓存数据，处理 Redis 客户端可能断开的情况
		try {
			cachedData = await req.redisClient.get(cacheKey);
		} catch (error) {
			console.error('Redis Client Error (GET):', error);
		}
		
		if (cachedData) {
			res.set('Cache-Control', 'public, max-age=60'); // 缓存 1 分钟
			res.set('X-Cache-Status', 'HIT'); // 标记数据来自缓存
			return res.json(JSON.parse(cachedData));
		}
		// 构造正确的 JSON 查询条件，确保 "x" 这个键的值匹配目标 URL（大小写不敏感）
		const targetTwitterUrl = `https://x.com/${sanitizedKeyword}`;
		const project = await Fundraising.Project.findOne({
			where: {
				[Op.or]: [
					{ projectName: { [Op.like]: `%${sanitizedKeyword}%` } },
					literal(`LOWER(socialLinks->>'x') = LOWER('${targetTwitterUrl}')`) // JSON 查询，确保 "x" 精确匹配
				]
			},
			order: [['id', 'DESC']], // 按 id 倒序
			attributes: [
				'projectName', 'projectLink', 'description', 'logo', 'round',
				'amount', 'formattedAmount', 'valuation', 'formattedValuation',
				'date', 'fundedAt', 'detailFetchedAt', 'socialLinks',
				'detailFailuresNumber', 'originalPageNumber', 'isInitial'
			],
			// teamMembers
			include: [
				{
					model: Fundraising.InvestmentRelationships,
					as: 'investmentsReceived',
					attributes: ['round', 'lead', 'amount', 'valuation', 'formattedAmount', 'formattedValuation', 'date'],
					include: [
						{
							model: Fundraising.Project,
							as: 'investorProject',
							attributes: ['projectName'] //'projectLink', 'socialLinks'
						}
					]
				}
			]
		});
		
		if (!project) {
			return res.json({ data: null, message: 'No matching project found' });
		}
		
		const investmentsByDate = groupInvestmentsByDate(project.investmentsReceived);
		const formattedProject = {
			...project.get(),
			investmentsReceived: investmentsByDate
		};
		
		// 将数据缓存到 Redis，处理 Redis 客户端可能断开的情况
		try {
			await req.redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify({ data: formattedProject }));
		} catch (error) {
			console.error('Redis Client Error (SET):', error);
		}
		
		res.set('Cache-Control', 'public, max-age=60'); // 缓存 1 分钟
		res.set('X-Cache-Status', 'MISS'); // 标记数据来自数据库
		res.json({ data: formattedProject });
	} catch (error) {
		console.error('Error searching project:', error);
		res.status(500).json({ error: 'Failed to search project' });
	}
});
/**
 * 兼容https://www.cryptohunt.ai/旧版数据格式的查询接口
 * **/
// 时间筛选阈值（2024-03-11T00:00:00Z）
const DATA_CUTOFF_TIMESTAMP = 1741708800000;
/** 手动维护部分更名推特 **/
const RENAME_MAP = {
	'YZiLabs': 'BinanceLabs',
	'yzilabs': 'BinanceLabs'
};
router.get('/search/legacy', async (req, res) => {
	try {
		let { keyword } = req.query;
		
		if (!keyword || !keyword.trim() || String(keyword).length < 2) {
			return res.json({ invested: null, investor: null, message: 'No keyword provided' });
		}
		const lowerKeyword = String(keyword).toLocaleLowerCase();
		if ((lowerKeyword in RENAME_MAP) || (keyword in RENAME_MAP)) {
			keyword = RENAME_MAP[lowerKeyword] || RENAME_MAP[keyword];
		}
		
		const sanitizedKeyword = keyword.trim();
		const cacheKey = `legacy_project_search_${sanitizedKeyword}_202503161099`;
		let cachedData;
		
		try {
			cachedData = await req.redisClient.get(cacheKey);
		} catch (error) {
			console.error('Redis Client Error (GET):', error);
		}
		
		if (cachedData) {
			res.set('Cache-Control', 'public, max-age=120');
			res.set('X-Cache-Status', 'HIT');
			return res.json(JSON.parse(cachedData));
		}
		
		// 构造正确的 JSON 查询条件，确保 "x" 这个键的值匹配目标 URL（大小写不敏感）
		const targetTwitterUrl = `https://x.com/${sanitizedKeyword}`;
		
		const project = await Fundraising.Project.findOne({
			where: {
				socialLinks: {
					[Op.and]: [
						literal(`LOWER(socialLinks->>'x') = LOWER('${targetTwitterUrl}')`) // JSON 查询，确保 "x" 精确匹配
					]
				}
			},
			order: [['id', 'DESC']], // 按 id 倒序
			attributes: ['projectName', 'socialLinks', 'logo', 'amount'],
			include: [
				{
					model: Fundraising.InvestmentRelationships,
					as: 'investmentsReceived',
					// 正确的作用域
					// required: false, // 避免 INNER JOIN 过滤掉主项目
					// where: { updatedAt: { [Op.gte]: DATA_CUTOFF_TIMESTAMP } },
					attributes: ['round', 'lead', 'amount', 'date', 'formattedAmount'],
					include: [
						{
							model: Fundraising.Project,
							as: 'investorProject',
							attributes: ['projectName', 'socialLinks', 'logo']
						}
					]
				},
				{
					model: Fundraising.InvestmentRelationships,
					as: 'investmentsGiven',
					// 正确的作用域
					// required: false, // 避免 INNER JOIN 过滤掉主项目
					// where: { updatedAt: { [Op.gte]: DATA_CUTOFF_TIMESTAMP } },
					attributes: ['round', 'lead', 'amount', 'date', 'formattedAmount'],
					include: [
						{
							model: Fundraising.Project,
							as: 'fundedProject',
							attributes: ['projectName', 'socialLinks', 'logo']
						}
					]
				}
			]
		});
		
		if (!project) {
			return res.json({ invested: null, investor: null, message: 'No matching project found' });
		}
		// 调用现有的 groupInvestmentsByDate 函数
		const groupedInvestments = groupInvestmentsByDate(project.investmentsReceived || []);
		
		// 计算 total_funding
		const totalFunding = Object.values(groupedInvestments).reduce(
			(sum, group) => sum + (group.formattedAmount || 0),
			0
		);
		
		// 构造 investors 数据并去重
		const rawInvestors = Object.values(groupedInvestments).flatMap((group) =>
			group.investors.map((investor) => ({
				avatar: investor?.logo || '',
				lead_investor: investor?.lead || false,
				name: investor?.projectName || '',
				twitter: investor?.socialLinks?.x || ''
			}))
		);

// 自定义去重逻辑：优先保留 lead_investor 为 true 的记录
		const investors = Array.from(
			rawInvestors.reduce((map, item) => {
				// 如果已存在相同 name 的记录
				if (map.has(item.name)) {
					const existing = map.get(item.name);
					// 当现有记录的 lead_investor 为 false 且当前项为 true 时替换
					if (!existing.lead_investor && item.lead_investor) {
						map.set(item.name, item);
					}
					// 否则保留原有记录（保持第一次出现的 lead_investor 为 true 的记录）
				} else {
					map.set(item.name, item);
				}
				return map;
			}, new Map()).values()
		);
		
		const investedData = {
			investors,
			total_funding: totalFunding
		};
		
		// 处理 fundedProjects 数据并去重
		const rawFundedProjects = (project.investmentsGiven || []).map((investment) => ({
			avatar: investment.fundedProject?.logo || '',
			name: investment.fundedProject?.projectName || '',
			twitter: investment.fundedProject?.socialLinks?.x || '',
			lead_investor: investment.fundedProject?.lead || false,
		}));
		
		// 自定义去重逻辑：优先保留 lead_investor 为 true 的记录
		const fundedProjects = Array.from(
			rawFundedProjects.reduce((map, item) => {
				// 如果已存在相同 name 的记录
				if (map.has(item.name)) {
					const existing = map.get(item.name);
					// 当现有记录的 lead_investor 为 false 且当前项为 true 时替换
					if (!existing.lead_investor && item.lead_investor) {
						map.set(item.name, item);
					}
					// 否则保留原有记录（保持第一次出现的 lead_investor 为 true 的记录）
				} else {
					map.set(item.name, item);
				}
				return map;
			}, new Map()).values()
		);
		const totalInvestment = fundedProjects.reduce((sum, proj) => sum + (proj.amount || 0), 0);
		
		const investorData = {
			investors: fundedProjects,
			total_funding: totalInvestment
		};
		
		// 组装最终响应
		const response = {
			invested: investedData,
			investor: investorData
		};
		
		// 缓存结果到 Redis
		try {
			await req.redisClient.setEx(cacheKey, CACHE_TTL_LONG, JSON.stringify(response));
		} catch (error) {
			console.error('Redis Client Error (SET):', error);
		}
		
		res.set('Cache-Control', 'public, max-age=120');
		res.set('X-Cache-Status', 'MISS');
		res.json(response);
	} catch (error) {
		console.error('Error in legacy search:', error);
		res.status(500).json({ error: 'Failed to search project (legacy)' });
	}
});

// const { Op, literal, fn, col } = require('sequelize');

// router.get('/investors', async (req, res) => {
// 	try {
// 		const page = parseInt(req.query.page) || 1;
// 		const pageSize = parseInt(req.query.pageSize) || 20;
// 		const offset = (page - 1) * pageSize;
//
// 		// 1. 获取所有唯一的investorProjectId
// 		const investorIds = await Fundraising.InvestmentRelationships.findAll({
// 			attributes: [[fn('DISTINCT', col('investorProjectId')), 'investorProjectId']],
// 			raw: true
// 		});
//
// 		const ids = investorIds.map(item => item.investorProjectId);
//
// 		// 2. 查询项目信息（不分页，获取所有数据）
// 		const allProjects = await Fundraising.Project.findAll({
// 			where: { id: ids },
// 			attributes: ['id', 'projectName', 'socialLinks']
// 		});
//
// 		// 3. 按项目名称去重（保持原始顺序）
// 		const nameMap = new Map();
// 		const uniqueProjects = [];
//
// 		for (const project of allProjects) {
// 			if (!nameMap.has(project.projectName)) {
// 				nameMap.set(project.projectName, project);
// 				uniqueProjects.push(project);
// 			}
// 		}
//
// 		// 4. 分页处理去重后的数据
// 		const paginatedProjects = uniqueProjects.slice(offset, offset + pageSize);
//
// 		res.json({
// 			data: paginatedProjects,
// 			pagination: {
// 				page,
// 				pageSize,
// 				total: uniqueProjects.length
// 			}
// 		});
//
// 	} catch (error) {
// 		console.error('Investor list error:', error);
// 		res.status(500).json({ error: 'Failed to retrieve investors' });
// 	}
// });

const INVESTORS_PAGE_SIZE = 30; // 每页默认返回 30 条记录

/**
 * 获取所有 isVcListed 为 true 的项目，支持分页和排序
 */
router.get('/investors', async (req, res) => {
	try {
		// 获取分页参数
		const page = parseInt(req.query.page, 10) || 1; // 默认第一页
		const offset = (page - 1) * INVESTORS_PAGE_SIZE;
		
		// 构造缓存键（包含分页信息）
		const cacheKey = `vc_listed_projects_page_${page}_size_${INVESTORS_PAGE_SIZE}_20250423_2`;
		
		// 尝试从 Redis 缓存中获取数据
		let cachedData;
		try {
			cachedData = await req.redisClient.get(cacheKey);
		} catch (error) {
			console.error('Redis Client Error (GET):', error);
		}
		
		// 如果缓存命中，直接返回缓存数据
		if (cachedData) {
			res.set('Cache-Control', 'public, max-age=120');
			res.set('X-Cache-Status', 'HIT');
			return res.json(JSON.parse(cachedData));
		}
		
		// 查询数据库：获取所有 isVcListed 为 true 的项目
		const { rows: vcListedProjects, count: totalCount } = await Fundraising.Project.findAndCountAll({
			where: {
				isVcListed: true, // 筛选条件
			},
			attributes: ['projectName', 'logo', 'socialLinks', 'vcListPage', 'projectLink'], // 指定需要的字段
			order: [['vcListPage', 'ASC']], // 按照 vcListPage 从小到大排序
			limit: INVESTORS_PAGE_SIZE, // 每页条数
			offset: offset, // 跳过前面的记录
		});
		
		// 格式化返回数据
		const formattedProjects = vcListedProjects.map((project) => {
			return {
				id: project.id,
				name: project.projectName,
				projectLink: project.projectLink,
				logo: project.logo,
				twitter: project.socialLinks?.x || '', // 假设 socialLinks 是 JSON 字段，提取 x（Twitter）链接
				vcListPage: project.vcListPage || null,
			};
		});
		
		// 计算总页数
		const totalPages = Math.ceil(totalCount / INVESTORS_PAGE_SIZE);
		
		// 构造响应数据
		const response = {
			investors: formattedProjects,
			total_count: totalCount,
			page: page,
			// INVESTORS_PAGE_SIZE: INVESTORS_PAGE_SIZE,
			total_pages: totalPages,
		};
		
		// 缓存结果到 Redis
		try {
			await req.redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(response));
		} catch (error) {
			console.error('Redis Client Error (SET):', error);
		}
		
		// 返回响应
		res.set('Cache-Control', 'public, max-age=120');
		res.set('X-Cache-Status', 'MISS');
		res.json(response);
	} catch (error) {
		console.error('Error fetching VC listed projects:', error);
		res.status(500).json({ error: 'Failed to fetch VC listed projects' });
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
				isInitial: true,
				detailFailuresNumber: { [Op.gt]: 1, [Op.lt]: 99 },
				projectLink: { [Op.like]: 'http%' }  // 确保 projectLink 以 http 开头
			},
			offset,
			limit,
		});
		
		// 返回分页结果
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


/** 废弃⚠️ **/
// // Start full crawl
// router.post('/crawl/full', async (req, res) => {
// 	try {
// 		const state = await NewCrawlState.findOne({ where: C_STATE_TYPE.full });
// 		if (state && state.status === 'running') {
// 			return res.status(400).json({ error: 'Full crawl already in progress' });
// 		}
//
// 		// Start crawl in background
// 		crawler.fullCrawl().catch(console.error);
// 		res.json({ message: 'Full crawl started' });
// 	} catch (error) {
// 		console.error('Error starting full crawl:', error);
// 		res.status(500).json({ error: 'Failed to start full crawl' });
// 	}
// });
//
// // Start quick update
// router.post('/crawl/quick', async (req, res) => {
// 	try {
// 		const state = await NewCrawlState.findOne({ where: C_STATE_TYPE.quick });
// 		if (state && state.status === 'running') {
// 			return res.status(400).json({ error: 'Quick update already in progress' });
// 		}
//
// 		// Start quick update in background
// 		crawler.quickUpdate().catch(console.error);
// 		res.json({ message: 'Quick update started' });
// 	} catch (error) {
// 		console.error('Error starting quick update:', error);
// 		res.status(500).json({ error: 'Failed to start quick update' });
// 	}
// });
//
// // Start detail crawl
// router.post('/crawl/detail', async (req, res) => {
// 	try {
// 		crawler.detailsCrawl().catch(console.error);
// 		crawler.subDetailsCrawl().catch(console.error);
// 		res.json({ message: 'Detail crawl started' });
// 	} catch (error) {
// 		console.error('Error starting detail crawl:', error);
// 		res.status(500).json({ error: 'Failed to start detail crawl' });
// 	}
// });
//
// // Start detail crawl
// router.post('/crawl/repair', async (req, res) => {
// 	try {
// 		crawler.correctDetailed().catch(console.error);
// 		res.json({ message: 'correctDetailed started' });
// 	} catch (error) {
// 		console.error('Error starting repair crawl:', error);
// 		res.status(500).json({ error: 'Failed to start repair crawl' });
// 	}
// });
//
// // Start detail crawl
// router.post('/crawl/retry', async (req, res) => {
// 	try {
// 		crawler.failedReTryCrawl().catch(console.error);
// 		res.json({ message: 'failedReTryCrawl started' });
// 	} catch (error) {
// 		console.error('Error starting failedReTryCrawl crawl:', error);
// 		res.status(500).json({ error: 'Failed to start failedReTryCrawl crawl' });
// 	}
// });
//
// // Set all crawl statuses to idle
// router.post('/status/reset', async (req, res) => {
// 	try {
// 		// 更新所有 NewCrawlState 条目，将状态设为 'idle'，并清空错误信息
// 		await NewCrawlState.update(
// 			{
// 				status: 'idle',
// 				error: null,
// 			},
// 			{
// 				where: {} // 空条件表示更新所有记录
// 			}
// 		);
//
// 		res.json({ message: 'All crawl statuses reset to idle' });
// 	} catch (error) {
// 		console.error('Error resetting crawl statuses:', error);
// 		res.status(500).json({ error: 'Failed to reset crawl statuses' });
// 	}
// });
