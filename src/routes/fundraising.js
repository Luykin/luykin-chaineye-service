const express = require("express");
const { query, validationResult } = require("express-validator");
// 从 PostgreSQL 导入 Fundraising 模型
const { Fundraising } = require("../models/postgres-fundraising");
// 从 SQLite 导入爬取状态管理
const { NewCrawlState, C_STATE_TYPE } = require("../models/sqlite-start");
// const crawler = require('../services/rootdata-crawler');
const { Op, literal, fn, col } = require("sequelize");
const axios = require("axios");
const router = express.Router();
const CACHE_TTL = 300; // 缓存时间限制（秒），此处设为5分钟
const CACHE_TTL_LONG = 600; // 缓存时间限制（秒），此处设为10分钟

// 过滤函数：优先从 projectLink 提取项目名称进行匹配，若无结果则使用 description 中的末尾名称
const filterMismatchedFunction = (project) => {
  const projectNameEncoded = encodeURI(project.projectName).toLocaleLowerCase();
  const projectNameEncoded2 = encodeURIComponent(
    project.projectName
  ).toLocaleLowerCase();

  // 优先从 projectLink 中提取名称，支持特殊字符（如点、空格、冒号等）
  const linkMatch = project.projectLink.match(
    /\/Projects\/detail\/([A-Za-z0-9.%: ]+)/
  );
  let extractedName = linkMatch ? linkMatch[1].toLocaleLowerCase() : null;

  // 返回项目名称不一致的记录
  return (
    projectNameEncoded &&
    extractedName &&
    !extractedName.includes(projectNameEncoded) &&
    !projectNameEncoded.includes(extractedName) &&
    !extractedName.includes(projectNameEncoded2) &&
    !projectNameEncoded2.includes(extractedName)
  );
};

function convertUTCToBeijingTime(utcDateString) {
  const date = new Date(utcDateString); // 将字符串转换为 Date 对象
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }); // 使用北京时间格式
}

// Validation middleware
const validatePagination = [
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 5, max: 50 }),
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
        investors: [],
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
router.get("/", validatePagination, async (req, res) => {
  try {
    const { originalPageNumber, page = 1, limit = 30, sort } = req.query;
    const sortField = sort === "fundedAt" ? "fundedAt" : null;
    const sortOrder = sortField === "fundedAt" ? "DESC" : "ASC";

    const cacheKey = `projects_${originalPageNumber}_${page}_${limit}_${sort}`;
    let cachedData;

    // 从 Redis 获取缓存数据，处理 Redis 客户端可能断开的情况
    try {
      cachedData = await req.redisClient.get(cacheKey);
    } catch (error) {
      console.error("Redis Client Error (GET):", error);
    }

    if (cachedData) {
      res.set("Cache-Control", "public, max-age=60"); // 缓存 1 分钟
      res.set("X-Cache-Status", "HIT"); // 标记数据来自缓存
      return res.json(JSON.parse(cachedData));
    }

    let whereConditions = { isInitial: true };
    let queryOptions = {
      order: sortField ? [[sortField, sortOrder]] : [],
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
        offset,
      };
    }

    const data = await Fundraising.Project.findAndCountAll({
      ...queryOptions,
      attributes: [
        "projectName",
        "projectLink",
        "description",
        "logo",
        "round",
        "amount",
        "formattedAmount",
        "valuation",
        "formattedValuation",
        "date",
        "fundedAt",
        "detailFetchedAt",
        "socialLinks",
        "teamMembers",
        "detailFailuresNumber",
        "originalPageNumber",
        "isInitial",
      ],
      include: [
        {
          model: Fundraising.InvestmentRelationships,
          as: "investmentsReceived",
          attributes: [
            "round",
            "lead",
            "amount",
            "valuation",
            "formattedAmount",
            "formattedValuation",
            "date",
          ],
          include: [
            {
              model: Fundraising.Project,
              as: "investorProject",
              attributes: ["projectName", "projectLink", "socialLinks"],
            },
          ],
        },
      ],
    });

    const formattedData = data.rows.map((project) => {
      const investmentsByDate = groupInvestmentsByDate(
        project.investmentsReceived
      );
      return {
        ...project.get(),
        investmentsReceived: investmentsByDate,
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
      await req.redisClient.setEx(
        cacheKey,
        CACHE_TTL,
        JSON.stringify(response)
      );
    } catch (error) {
      console.error("Redis Client Error (SET):", error);
    }

    res.set("Cache-Control", "public, max-age=60"); // 缓存 1 分钟
    res.set("X-Cache-Status", "MISS"); // 标记数据来自数据库
    res.json(response);
  } catch (error) {
    console.error("Error fetching fundraising data:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// 精确关键词搜索接口
router.get("/search", async (req, res) => {
  try {
    const { keyword } = req.query;

    if (!keyword || !keyword.trim() || String(keyword).length < 2) {
      return res.json({ data: null, message: "No keyword provided" });
    }

    const sanitizedKeyword = keyword.trim();
    const cacheKey = `project_search_${sanitizedKeyword}_202412182269`;
    let cachedData;

    // 从 Redis 获取缓存数据，处理 Redis 客户端可能断开的情况
    try {
      cachedData = await req.redisClient.get(cacheKey);
    } catch (error) {
      console.error("Redis Client Error (GET):", error);
    }

    if (cachedData) {
      res.set("Cache-Control", "public, max-age=60"); // 缓存 1 分钟
      res.set("X-Cache-Status", "HIT"); // 标记数据来自缓存
      return res.json(JSON.parse(cachedData));
    }
    // 构造正确的 JSON 查询条件，确保 "x" 这个键的值匹配目标 URL（大小写不敏感）
    const targetTwitterUrl = `https://x.com/${sanitizedKeyword}`;
    const project = await Fundraising.Project.findOne({
      where: {
        [Op.or]: [
          { projectName: { [Op.like]: `%${sanitizedKeyword}%` } },
          literal(`LOWER(socialLinks->>'x') = LOWER('${targetTwitterUrl}')`), // JSON 查询，确保 "x" 精确匹配
        ],
      },
      order: [["id", "DESC"]], // 按 id 倒序
      attributes: [
        "projectName",
        "projectLink",
        "description",
        "logo",
        "round",
        "amount",
        "formattedAmount",
        "valuation",
        "formattedValuation",
        "date",
        "fundedAt",
        "detailFetchedAt",
        "socialLinks",
        "detailFailuresNumber",
        "originalPageNumber",
        "isInitial",
      ],
      // teamMembers
      include: [
        {
          model: Fundraising.InvestmentRelationships,
          as: "investmentsReceived",
          attributes: [
            "round",
            "lead",
            "amount",
            "valuation",
            "formattedAmount",
            "formattedValuation",
            "date",
          ],
          include: [
            {
              model: Fundraising.Project,
              as: "investorProject",
              attributes: ["projectName"], //'projectLink', 'socialLinks'
            },
          ],
        },
      ],
    });

    if (!project) {
      return res.json({ data: null, message: "No matching project found" });
    }

    const investmentsByDate = groupInvestmentsByDate(
      project.investmentsReceived
    );
    const formattedProject = {
      ...project.get(),
      investmentsReceived: investmentsByDate,
    };

    // 将数据缓存到 Redis，处理 Redis 客户端可能断开的情况
    try {
      await req.redisClient.setEx(
        cacheKey,
        CACHE_TTL,
        JSON.stringify({ data: formattedProject })
      );
    } catch (error) {
      console.error("Redis Client Error (SET):", error);
    }

    res.set("Cache-Control", "public, max-age=600"); // 缓存 1 分钟
    res.set("X-Cache-Status", "MISS"); // 标记数据来自数据库
    res.json({ data: formattedProject });
  } catch (error) {
    console.error("Error searching project:", error);
    res.status(500).json({ error: "Failed to search project" });
  }
});
/**
 * 兼容https://www.cryptohunt.ai/旧版数据格式的查询接口
 * **/
// 时间筛选阈值（2024-03-11T00:00:00Z）
const DATA_CUTOFF_TIMESTAMP = 1741708800000;
/** 手动维护部分更名推特 **/
const RENAME_MAP = {
  YZiLabs: "BinanceLabs",
  yzilabs: "BinanceLabs",
};
/**
 * 🔄 Legacy API - 代理到新接口
 * 为了保持向后兼容，直接调用新的 rootdata 接口
 */
router.get("/search/legacy", async (req, res) => {
  try {
    const { keyword } = req.query;

    // 内部请求新接口
    const baseUrl = req.protocol + "://" + req.get("host");
    const newApiUrl = `${baseUrl}/api/rootdata/search?keyword=${encodeURIComponent(
      keyword
    )}`;

    const response = await axios.get(newApiUrl, {
      headers: {
        // 传递 Redis 客户端需要的请求头（如果有的话）
        "x-forwarded-for": req.get("x-forwarded-for") || req.ip,
      },
      timeout: 30000, // 30 秒超时
    });

    // 添加标识，表示这是从 legacy 接口代理过来的
    res.set("X-Proxied-From", "legacy");
    res.set("X-Data-Source", "PostgreSQL");

    // 返回新接口的响应
    res.json(response.data);
  } catch (error) {
    console.error("Error in legacy search (proxy):", error.message);

    // 如果新接口返回了错误响应，直接返回
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }

    // 其他错误
    res.status(500).json({
      error: "Failed to search project (legacy)",
      message: error.message,
    });
  }
});

/**
 * 🆕 批量更新项目Logo的优化函数
 * @param {Object} avatarMap - 用户名到头像URL的映射
 */
async function batchUpdateProjectLogos(avatarMap) {
  if (!avatarMap || Object.keys(avatarMap).length === 0) {
    return;
  }

  try {
    // 方案1: 使用 CASE WHEN 进行批量更新（推荐）
    const usernames = Object.keys(avatarMap);

    // 构建 CASE WHEN 语句
    const caseWhenClauses = usernames
      .map((username) => {
        const avatar = avatarMap[username];
        const twitterUrl = `https://x.com/${username}`;
        const twitterUrlWithSlash = `https://x.com/${username}/`;

        return `
				WHEN (LOWER(socialLinks->>'x') = LOWER('${twitterUrl}') OR
				      LOWER(socialLinks->>'x') = LOWER('${twitterUrlWithSlash}'))
				THEN '${avatar}'
			`;
      })
      .join(" ");

    // 构建完整的更新SQL
    const updateSQL = `
			UPDATE Projects
			SET logo = CASE
				${caseWhenClauses}
				ELSE logo
			END
			WHERE socialLinks->>'x' IS NOT NULL
			AND (${usernames
        .map((username) => {
          const twitterUrl = `https://x.com/${username}`;
          const twitterUrlWithSlash = `https://x.com/${username}/`;
          return `(LOWER(socialLinks->>'x') = LOWER('${twitterUrl}') OR
				         LOWER(socialLinks->>'x') = LOWER('${twitterUrlWithSlash}'))`;
        })
        .join(" OR ")})
		`;

    // 执行批量更新
    await Fundraising.Project.sequelize.query(updateSQL);
    console.log(`批量更新完成`);
  } catch (error) {
    console.error("批量更新项目Logo失败:", error);

    // 🔄 降级方案：如果批量更新失败，使用事务批量处理
    try {
      await fallbackBatchUpdate(avatarMap);
    } catch (fallbackError) {
      console.error("降级批量更新也失败:", fallbackError);
    }
  }
}

/**
 * 🔄 降级方案：使用事务进行批量更新
 * @param {Object} avatarMap - 用户名到头像URL的映射
 */
async function fallbackBatchUpdate(avatarMap) {
  const transaction = await Fundraising.Project.sequelize.transaction();

  try {
    const updatePromises = Object.entries(avatarMap).map(
      ([username, avatar]) => {
        const twitterUrl = `https://x.com/${username}`;
        const twitterUrlWithSlash = `https://x.com/${username}/`;

        return Fundraising.Project.update(
          { logo: avatar },
          {
            where: {
              [Op.or]: [
                literal(`LOWER(socialLinks->>'x') = LOWER('${twitterUrl}')`),
                literal(
                  `LOWER(socialLinks->>'x') = LOWER('${twitterUrlWithSlash}')`
                ),
              ],
            },
            transaction,
          }
        );
      }
    );

    // 并行执行所有更新操作
    const results = await Promise.all(updatePromises);
    await transaction.commit();

    const totalUpdated = results.reduce(
      (sum, [affectedCount]) => sum + affectedCount,
      0
    );
    console.log(`降级批量更新完成，影响了 ${totalUpdated} 条记录`);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

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
router.get("/investors", async (req, res) => {
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
      console.error("Redis Client Error (GET):", error);
    }

    // 如果缓存命中，直接返回缓存数据
    if (cachedData) {
      res.set("Cache-Control", "public, max-age=120");
      res.set("X-Cache-Status", "HIT");
      return res.json(JSON.parse(cachedData));
    }

    // 查询数据库：获取所有 isVcListed 为 true 的项目
    const { rows: vcListedProjects, count: totalCount } =
      await Fundraising.Project.findAndCountAll({
        where: {
          isVcListed: true, // 筛选条件
        },
        attributes: [
          "projectName",
          "logo",
          "socialLinks",
          "vcListPage",
          "projectLink",
        ], // 指定需要的字段
        order: [["vcListPage", "ASC"]], // 按照 vcListPage 从小到大排序
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
        twitter: project.socialLinks?.x || "", // 假设 socialLinks 是 JSON 字段，提取 x（Twitter）链接
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
      await req.redisClient.setEx(
        cacheKey,
        CACHE_TTL,
        JSON.stringify(response)
      );
    } catch (error) {
      console.error("Redis Client Error (SET):", error);
    }

    // 返回响应
    res.set("Cache-Control", "public, max-age=120");
    res.set("X-Cache-Status", "MISS");
    res.json(response);
  } catch (error) {
    console.error("Error fetching VC listed projects:", error);
    res.status(500).json({ error: "Failed to fetch VC listed projects" });
  }
});

// 查看所有失败的项目（带分页）
router.get("/failed", async (req, res) => {
  try {
    // 获取分页参数，默认值为 page 1，每页 10 条记录
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;

    // 计算 offset 和 limit
    const offset = (page - 1) * pageSize;
    const limit = pageSize;

    // 查询符合条件的项目，并添加分页
    const { rows: projects, count: total } =
      await Fundraising.Project.findAndCountAll({
        where: {
          isInitial: true,
          detailFailuresNumber: { [Op.gt]: 1, [Op.lt]: 99 },
          projectLink: { [Op.like]: "http%" }, // 确保 projectLink 以 http 开头
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
      projects,
    });
  } catch (error) {
    console.error("Error fetching filtered projects:", error);
    res.status(500).json({ error: "Failed to fetch filtered projects" });
  }
});

// 查询爬虫爬错误的项目
router.get("/mismatched", async (req, res) => {
  try {
    // 获取分页参数，默认第一页，每页10条记录
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;

    // 初步筛选：获取 description 不为空且 projectLink 以 http 开头的项目
    const initialProjects = await Fundraising.Project.findAll({
      where: {
        description: { [Op.not]: null },
        projectLink: { [Op.like]: "http%" },
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
      projects: paginatedProjects,
    });
  } catch (error) {
    console.error("Error fetching mismatched projects:", error);
    res.status(500).json({ error: "Failed to fetch mismatched projects" });
  }
});

// Get crawl status
router.get("/status", async (req, res) => {
  try {
    const [full, quick, detail, detail2, spare] = await Promise.all([
      NewCrawlState.findOne({ where: C_STATE_TYPE.full }),
      NewCrawlState.findOne({ where: C_STATE_TYPE.quick }),
      NewCrawlState.findOne({ where: C_STATE_TYPE.detail }),
      NewCrawlState.findOne({ where: C_STATE_TYPE.detail2 }),
      NewCrawlState.findOne({ where: C_STATE_TYPE.spare }),
    ]);

    // 初始化 projectDetails 为 null
    let projectDetails = null;
    let projectDetails2 = null;

    // 如果 detail 存在，则根据 projectLink 查询 Project 的 projectLink, projectName 和 originalPageNumber
    if (detail && detail?.otherInfo?.projectLink) {
      const project = await Fundraising.Project.findOne({
        where: { projectLink: detail?.otherInfo?.projectLink },
        attributes: [
          "projectLink",
          "projectName",
          "originalPageNumber",
          "detailFailuresNumber",
        ],
      });
      projectDetails = project
        ? {
            projectLink: project.projectLink,
            projectName: project.projectName,
            originalPageNumber: project.originalPageNumber,
            detailFailuresNumber: project.detailFailuresNumber,
          }
        : null;
    }
    if (detail2 && detail2?.otherInfo?.projectLink) {
      const project = await Fundraising.Project.findOne({
        where: { projectLink: detail2?.otherInfo?.projectLink },
        attributes: [
          "projectLink",
          "projectName",
          "originalPageNumber",
          "detailFailuresNumber",
        ],
      });
      projectDetails2 = project
        ? {
            projectLink: project.projectLink,
            projectName: project.projectName,
            originalPageNumber: project.originalPageNumber,
            detailFailuresNumber: project.detailFailuresNumber,
          }
        : null;
    }

    res.json({
      full: full
        ? {
            status: full.status,
            lastUpdate: convertUTCToBeijingTime(full.lastUpdateTime),
            error: full.error,
            otherInfo: full?.otherInfo,
          }
        : null,
      quick: quick
        ? {
            status: quick.status,
            lastUpdate: convertUTCToBeijingTime(quick.lastUpdateTime),
            error: quick.error,
            otherInfo: quick?.otherInfo,
          }
        : null,
      detail: detail
        ? {
            status: detail.status,
            lastUpdate: convertUTCToBeijingTime(detail.lastUpdateTime),
            error: detail.error,
            otherInfo: detail?.otherInfo,
            projectDetails: projectDetails,
            quickView: `http://148.251.131.206:8087/api/fundraising/search?keyword=${encodeURIComponent(
              projectDetails?.projectName
            )}`,
          }
        : null,
      detail2: detail2
        ? {
            status: detail2.status,
            lastUpdate: convertUTCToBeijingTime(detail2.lastUpdateTime),
            error: detail2.error,
            otherInfo: detail2?.otherInfo,
            projectDetails: projectDetails2,
            quickView: `http://148.251.131.206:8087/api/fundraising/search?keyword=${encodeURIComponent(
              projectDetails2?.projectName
            )}`,
          }
        : null,
      spare: spare
        ? {
            status: spare.status,
            lastUpdate: convertUTCToBeijingTime(spare.lastUpdateTime),
            error: spare.error,
            otherInfo: spare?.otherInfo,
          }
        : null,
    });
  } catch (error) {
    console.error("Error fetching crawl status:", error);
    res.status(500).json({ error: "Failed to fetch crawl status" });
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
