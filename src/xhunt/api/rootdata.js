const express = require("express");
const { Op, literal } = require("sequelize");
const axios = require("axios");
const router = express.Router();

// 爬虫队列服务（双重验证机制）
const crawlerQueue = require("../services/RootdataCrawlerQueue");

// Redis 缓存时间：2小时 = 7200 秒
const CACHE_TTL_ROOTDATA = 7200;
// HTTP 缓存时间：2分钟 = 120 秒（确保修正后能快速获取新数据）
const HTTP_CACHE_TTL = 120;

// Rootdata API 配置
const ROOTDATA_API_BASE = "https://api.rootdata.com/open";
const ROOTDATA_API_KEY = "0TpF08MLXdb50VCGx1H8buExoMwgADbR";

/**
 * Rootdata API 服务类
 */
class RootdataAPIService {
  /**
   * 根据项目URL提取 project_id
   */
  static extractProjectId(projectLink) {
    if (!projectLink) return null;

    // 从 URL 中提取参数，如: ?k=MTE3
    const match = projectLink.match(/[?&]k=([^&]+)/);
    if (!match) return null;

    try {
      // 先进行 URL 解码（将 %3D 转换为 =），然后再进行 Base64 解码
      const urlDecoded = decodeURIComponent(match[1]);
      const decoded = Buffer.from(urlDecoded, "base64").toString("utf-8");
      return decoded;
    } catch (error) {
      console.error("Failed to decode project_id:", error);
      return null;
    }
  }

  /**
   * 调用 Rootdata API - 获取项目融资信息
   * @param {string} projectId - 项目ID
   */
  static async getFundingInfo(projectId, projectLink) {
    try {
      const response = await axios.post(
        `${ROOTDATA_API_BASE}/get_fac`,
        { project_id: projectId },
        {
          headers: {
            apikey: ROOTDATA_API_KEY,
            language: "en",
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      console.log(
        `[rootdata api 请求] ${ROOTDATA_API_BASE}/get_fac projectId: ${projectId} projectLink:${projectLink} response: ${JSON.stringify(
          response.data?.result
        )}`
      );

      if (response.data?.result === 200) {
        return response.data.data;
      }

      throw new Error(`API returned result: ${response.data?.result}`);
    } catch (error) {
      console.error(
        `[rootdata api 失败] ❌ ${
          error.message
        } , projectId: ${projectId} projectIdNumber: ${Number(
          projectId
        )}, api: ${ROOTDATA_API_BASE}/get_fac, projectLink:${projectLink}`
      );
      throw error;
    }
  }

  /**
   * 根据 projectLink 获取完整的融资信息
   */
  static async getProjectFundingData(projectLink) {
    const projectId = this.extractProjectId(projectLink);

    if (!projectId) {
      throw new Error("Failed to extract project_id from projectLink");
    }

    return await this.getFundingInfo(projectId, projectLink);
  }
}

/**
 * 数据修正服务
 * 通过 Rootdata API 验证和修复本地数据库的投资关系数据
 */
class RootdataDataFixService {
  /**
   * 验证和修复项目数据
   * @param {Object} project - 项目对象
   * @param {Object} Fundraising - Fundraising 模型
   * @param {Object} redisClient - Redis 客户端
   * @param {string} searchCacheKey - 搜索结果的缓存key（修正后需要清除）
   */
  static async verifyAndFixProject(
    project,
    Fundraising,
    redisClient,
    searchCacheKey = null
  ) {
    try {
      const projectLink = project.projectLink;

      // 只验证项目链接，不验证投资者链接
      if (!projectLink || !projectLink.includes("/Projects/detail")) {
        console.log(`⏭️ 跳过验证（非项目链接）: ${projectLink}`);
        return null;
      }

      const cacheKey = `rootdata_verified:${projectLink}`;

      // 1. 检查20天内是否已修正
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // 2. 调用 Rootdata API
      console.log(`🔍 验证项目数据: ${projectLink}`);

      const apiData = await RootdataAPIService.getProjectFundingData(
        projectLink
      );

      if (!apiData || !apiData.items || apiData.items.length === 0) {
        console.log(`⚠️ 未找到API数据，跳过修正: ${projectLink}`);

        // 缓存"未找到"状态（1天），避免重复请求
        const notFoundCache = {
          verified: false,
          notFound: true,
          checkedAt: Date.now(),
        };
        await redisClient.setEx(cacheKey, 86400, JSON.stringify(notFoundCache)); // 1天 = 24 * 3600
        console.log(`📝 已缓存"未找到"状态（1天）: ${projectLink}`);

        return null;
      }

      // 3. 修正数据
      await this.fixProjectData(project, apiData, Fundraising);

      // 4. 清除搜索结果缓存，让下次请求获取修正后的数据
      if (searchCacheKey) {
        try {
          await redisClient.del(searchCacheKey);
        } catch (error) {
          console.error("清除缓存失败:", error);
        }
      }

      // 5. 缓存验证结果（20天）- 只存储标记，不存储具体数据
      const cacheData = {
        verified: true,
        verifiedAt: Date.now(),
      };
      await redisClient.setEx(cacheKey, 1728000, JSON.stringify(cacheData)); // 20天 = 20 * 24 * 3600

      console.log(`✅ 数据修正完成并已缓存: ${projectLink}`);
      return cacheData;
    } catch (error) {
      console.error("❌ 数据修正失败:", error.message);
      return null;
    }
  }

  /**
   * 修正项目数据
   */
  static async fixProjectData(project, apiData, Fundraising) {
    const fundedProjectId = project.id;

    // 获取项目的 Twitter URL（用于验证）
    const projectTwitterUrl = project.twitterUrl || project.socialLinks?.x;
    if (!projectTwitterUrl) {
      console.log(
        `[rootdata 对比起效] ⚠️ 无Twitter URL跳过: ${
          project.projectName
        } | 轮次:${apiData.items?.length || 0}`
      );
      return;
    }

    console.log(
      `[rootdata 对比起效] 🔍 开始: ${project.projectName} | API返回:${
        apiData.items?.length || 0
      }轮次 | Twitter:${projectTwitterUrl}`
    );

    let totalProcessed = 0; // 统计处理的投资者数量
    let totalSkipped = 0; // 统计跳过的轮次数量
    let totalMatched = 0; // 统计匹配成功的轮次数量

    for (const round of apiData.items) {
      if (!round.invests || round.invests.length === 0) {
        totalSkipped++;
        continue;
      }

      // ✅ 数据验证：确保 API 返回的是我们查询的项目数据
      if (round.X) {
        const normalizeUrl = (url) => {
          if (!url) return "";
          return url.toLowerCase().replace(/\/$/, "");
        };

        const apiTwitterUrl = normalizeUrl(round.X);
        const expectedTwitterUrl = normalizeUrl(projectTwitterUrl);

        if (apiTwitterUrl !== expectedTwitterUrl) {
          console.log(
            `[rootdata 对比起效] ❌ Twitter不匹配跳过: ${round.rounds} | API:${apiTwitterUrl} vs 期望:${expectedTwitterUrl}`
          );
          totalSkipped++;
          continue;
        }

        console.log(
          `[rootdata 对比起效] ✅ Twitter匹配: ${round.rounds} | 投资者:${round.invests.length}个`
        );
        totalMatched++;
      }

      for (const investor of round.invests) {
        try {
          const investorProject = await this.findOrCreateInvestor(
            investor,
            Fundraising
          );

          if (!investorProject) continue;

          await this.findOrCreateRelationship(
            {
              investorProjectId: investorProject.id,
              fundedProjectId: fundedProjectId,
              round: round.rounds || null,
              amount: round.amount || null,
              formattedAmount: round.amount || null,
              date: this.parseDate(round.published_time),
              lead: investor.lead_investor === 1,
            },
            Fundraising
          );

          totalProcessed++;
        } catch (error) {
          console.error(`[rootdata 对比起效] ❌ 处理失败: ${error.message}`);
        }
      }
    }

    console.log(
      `[rootdata 对比起效] ✨ 完成: ${project.projectName} | 匹配:${totalMatched}轮次 跳过:${totalSkipped}轮次 投资者:${totalProcessed}个`
    );
  }

  /**
   * 标准化 URL - 统一编码格式
   * 处理 RootData URL 中的空格和 Base64 参数值中的特殊字符
   * 例如: "Amber Group?k=NDA4Nw==" -> "Amber%20Group?k=NDA4Nw%3D%3D"
   */
  static normalizeUrl(url) {
    if (!url) return url;

    try {
      // 分离基础 URL 和查询参数
      const questionMarkIndex = url.indexOf("?");
      if (questionMarkIndex === -1) {
        // 没有查询参数，只处理路径中的空格
        return url.replace(/ /g, "%20");
      }

      const baseUrl = url.substring(0, questionMarkIndex);
      const queryString = url.substring(questionMarkIndex + 1);

      // 对路径部分的空格进行编码
      const encodedBaseUrl = baseUrl.replace(/ /g, "%20");

      // 对查询参数进行处理
      // 格式: k=value，其中 value 可能包含 = (Base64)
      const params = queryString.split("&");
      const encodedParams = params.map((param) => {
        const equalIndex = param.indexOf("=");
        if (equalIndex === -1) return param;

        const key = param.substring(0, equalIndex);
        const value = param.substring(equalIndex + 1);

        // 对参数值中的 = 进行编码（Base64 值中的 =）
        const encodedValue = value.replace(/=/g, "%3D");

        return `${key}=${encodedValue}`;
      });

      return `${encodedBaseUrl}?${encodedParams.join("&")}`;
    } catch (error) {
      console.warn("URL 标准化失败:", url, error);
      // 失败时返回原 URL
      return url;
    }
  }

  /**
   * 查找或创建投资者项目
   */
  static async findOrCreateInvestor(investor, Fundraising) {
    // 提取 projectLink
    const projectLink = investor.rootdataurl;
    if (!projectLink) return null;

    // 从 rootdataurl 构建完整的 projectLink
    // 例如: https://www.rootdata.com/Investors/detail/Polychain?k=MTQ2
    let originalProjectLink = projectLink;
    if (!projectLink.includes("http")) {
      originalProjectLink = `https://www.rootdata.com${projectLink}`;
    }

    // 标准化 URL 格式（统一编码）
    const normalizedProjectLink = this.normalizeUrl(originalProjectLink);

    // 同时使用两种 URL 格式查找（防止重复创建）
    // 先查标准化的，再查原始的
    let existing = await Fundraising.Project.findOne({
      where: {
        [Op.or]: [
          { projectLink: normalizedProjectLink },
          { projectLink: originalProjectLink },
        ],
      },
      raw: true,
    });

    if (existing) {
      // 如果找到的记录使用的是未标准化的 URL，更新为标准化格式
      if (existing.projectLink !== normalizedProjectLink) {
        try {
          await Fundraising.Project.update(
            { projectLink: normalizedProjectLink },
            { where: { id: existing.id } }
          );
          console.log(`📝 更新项目 URL 为标准化格式: ${existing.projectName}`);
          existing.projectLink = normalizedProjectLink;
        } catch (error) {
          console.warn("更新 URL 格式失败:", error.message);
        }
      }
      return existing;
    }

    // 创建新项目（使用标准化后的 URL）
    const newProject = await Fundraising.Project.create({
      projectName: investor.name,
      projectLink: normalizedProjectLink,
      logo: investor.logo,
      description: investor.name, // 使用名称作为描述
      isInitial: true, // ✅ 标记为初始项目，以便爬虫抓取详细信息
      socialLinks: investor.X ? { x: investor.X } : null,
      detailFailuresNumber: 0, // ✅ 初始化失败次数为 0
      detailFetchedAt: null, // ✅ 初始化抓取时间为 null，等待爬虫抓取
    });

    console.log(`✨ 创建新投资者项目: ${investor.name} (待爬虫抓取详情)`);
    return newProject;
  }

  /**
   * 查找或创建投资关系
   */
  static async findOrCreateRelationship(relationshipData, Fundraising) {
    const { investorProjectId, fundedProjectId, round } = relationshipData;

    // 检查是否存在
    const existing = await Fundraising.InvestmentRelationships.findOne({
      where: {
        investorProjectId,
        fundedProjectId,
        round,
      },
      raw: true,
    });

    if (existing) {
      return;
    }

    // 创建新关系
    await Fundraising.InvestmentRelationships.create(relationshipData);
    console.log(
      `✨ 创建投资关系: ${investorProjectId} -> ${fundedProjectId} (${round})`
    );
  }

  /**
   * 解析日期字符串为时间戳
   */
  static parseDate(dateStr) {
    if (!dateStr) return null;
    return new Date(dateStr).getTime();
  }
}

/**
 * 手动维护部分更名推特
 */
const RENAME_MAP = {
  //   YZiLabs: "BinanceLabs",
  //   yzilabs: "BinanceLabs",
};

/**
 * 辅助函数：按日期分组投资记录
 */
const groupInvestmentsByDate = (investmentsReceived) => {
  return investmentsReceived.reduce((acc, investment) => {
    const dateKey = investment.date;

    // 跳过日期为 null 或 undefined 的记录
    if (!dateKey) {
      return acc;
    }

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
      projectName: investment.investorProject?.projectName,
      projectLink: investment.investorProject?.projectLink,
      socialLinks: investment.investorProject?.socialLinks,
      logo: investment.investorProject?.logo,
    });

    return acc;
  }, {});
};

/**
 * 辅助函数：从 Twitter URL 中提取用户名
 */
const extractUsername = (url) => {
  if (!url) return null;
  const match = url.match(/x\.com\/([^/]+)/i);
  return match ? match[1] : null;
};

/**
 * 辅助函数：批量更新项目 Logo 到数据库
 * @param {Object} avatarMap - 用户名到头像 URL 的映射
 * @param {Object} Fundraising - Fundraising 模型对象
 */
async function batchUpdateProjectLogos(avatarMap, Fundraising) {
  if (!avatarMap || Object.keys(avatarMap).length === 0) {
    return;
  }

  try {
    const usernames = Object.keys(avatarMap);

    // 构建 CASE WHEN 语句进行批量更新
    const caseWhenClauses = usernames
      .map((username) => {
        const avatar = avatarMap[username];
        const twitterUrl = `https://x.com/${username}`;
        const twitterUrlWithSlash = `https://x.com/${username}/`;

        return `
          WHEN (LOWER("socialLinks"->>'x') = LOWER('${twitterUrl}') OR
                LOWER("socialLinks"->>'x') = LOWER('${twitterUrlWithSlash}'))
          THEN '${avatar}'
        `;
      })
      .join("");

    const updateQuery = `
      UPDATE "Projects"
      SET logo = CASE ${caseWhenClauses}
                  ELSE logo
                  END
      WHERE "socialLinks"->>'x' IS NOT NULL
    `;

    await Fundraising.Project.sequelize.query(updateQuery);
    console.log(`✅ 批量更新了 ${usernames.length} 个项目的 Logo`);
  } catch (error) {
    console.error("❌ 批量更新 Logo 失败:", error);
    throw error;
  }
}

/**
 * GET /api/rootdata/search
 * 根据 Twitter 用户名搜索项目信息
 */
router.get("/search", async (req, res) => {
  try {
    // 1. 参数验证和清理
    let { keyword } = req.query;

    if (!keyword || !keyword.trim() || String(keyword).length < 2) {
      return res.json({
        invested: null,
        investor: null,
        message: "No keyword provided or keyword too short",
      });
    }

    const lowerKeyword = String(keyword).toLowerCase();

    // 应用重命名映射
    if (lowerKeyword in RENAME_MAP || keyword in RENAME_MAP) {
      keyword = RENAME_MAP[lowerKeyword] || RENAME_MAP[keyword];
    }

    const sanitizedKeyword = keyword.trim();
    const cacheKey = `rootdata_search_${sanitizedKeyword}_1030_2`;

    // 2. 从 Redis 获取缓存
    let cachedData;
    try {
      cachedData = await req.redisClient.get(cacheKey);
      if (cachedData) {
        res.set("Cache-Control", `public, max-age=${HTTP_CACHE_TTL}`);
        res.set("X-Cache-Status", "HIT");
        return res.json(JSON.parse(cachedData));
      }
    } catch (error) {
      console.error("Redis Client Error (GET):", error);
    }

    // 3. 获取 Fundraising 模型（从 PostgreSQL）
    const { Fundraising } = require("../../models/postgres-fundraising");
    if (!Fundraising) {
      return res.status(500).json({ error: "Database model not initialized" });
    }

    // 4. 构造查询条件
    const targetTwitterUrl = `https://x.com/${sanitizedKeyword}`;
    const targetTwitterUrlWithSlash = `https://x.com/${sanitizedKeyword}/`;

    // 5. 优化查询：使用 twitterUrl 字段，速度更快（带索引）
    const project = await Fundraising.Project.findOne({
      where: {
        [Op.or]: [
          {
            twitterUrl: {
              [Op.iLike]: targetTwitterUrl,
            },
          },
          {
            twitterUrl: {
              [Op.iLike]: targetTwitterUrlWithSlash,
            },
          },
        ],
      },
      order: [["id", "DESC"]],
      attributes: [
        "id",
        "projectName",
        "projectLink",
        "socialLinks",
        "logo",
        "amount",
        "twitterUrl",
        "socialLinks",
      ],
      raw: true,
    });

    if (!project) {
      const notFoundResponse = {
        invested: null,
        investor: null,
        message: "No matching project found",
      };

      try {
        await req.redisClient.setEx(
          cacheKey,
          3600,
          JSON.stringify(notFoundResponse)
        );
      } catch (error) {
        console.error("Redis Client Error (SET):", error);
      }

      return res.json(notFoundResponse);
    }

    // 6. 异步验证和修正数据（双重验证机制，不影响响应速度）
    // 修正完成后会自动清除缓存，确保下次请求能获取最新数据
    setImmediate(async () => {
      try {
        // 第一重：API验证和修正
        await RootdataDataFixService.verifyAndFixProject(
          project,
          Fundraising,
          req.redisClient,
          cacheKey // 传入搜索缓存key，修正后会清除
        );

        // 第二重：爬虫更新验证（队列化、节流、去重）
        crawlerQueue.updateCrawl(project, cacheKey);
      } catch (error) {
        console.error("数据修正失败:", error);
      }
    });

    // 7. 并行查询关联数据（性能优化）
    const [investmentsReceived, investmentsGiven] = await Promise.all([
      Fundraising.InvestmentRelationships.findAll({
        where: { fundedProjectId: project.id },
        attributes: [
          "round",
          "lead",
          "amount",
          "date",
          "formattedAmount",
          "investorProjectId",
        ],
        include: [
          {
            model: Fundraising.Project,
            as: "investorProject",
            attributes: ["projectName", "socialLinks", "logo"],
          },
        ],
        raw: true,
        nest: true,
      }),
      Fundraising.InvestmentRelationships.findAll({
        where: { investorProjectId: project.id },
        attributes: [
          "round",
          "lead",
          "amount",
          "date",
          "formattedAmount",
          "fundedProjectId",
        ],
        include: [
          {
            model: Fundraising.Project,
            as: "fundedProject",
            attributes: ["projectName", "socialLinks", "logo"],
          },
        ],
        raw: true,
        nest: true,
      }),
    ]);

    // 8. 处理 invested（收到的投资）数据
    const groupedInvestments = groupInvestmentsByDate(
      investmentsReceived || []
    );

    const totalFunding = Object.values(groupedInvestments).reduce(
      (sum, group) => sum + (group.formattedAmount || 0),
      0
    );

    // 构造 investors 数据并去重
    const rawInvestors = Object.values(groupedInvestments).flatMap((group) =>
      group.investors.map((investor) => ({
        avatar: investor?.logo || "",
        lead_investor: investor?.lead || false,
        name: investor?.projectName || "",
        twitter: investor?.socialLinks?.x || "",
      }))
    );

    const investors = Array.from(
      rawInvestors
        .reduce((map, item) => {
          if (map.has(item.name)) {
            const existing = map.get(item.name);
            if (!existing.lead_investor && item.lead_investor) {
              map.set(item.name, item);
            }
          } else {
            map.set(item.name, item);
          }
          return map;
        }, new Map())
        .values()
    );

    // 移除 grouped_investments 中每一项的 investors 字段
    const groupedInvestmentsWithoutInvestors = Object.entries(
      groupedInvestments
    ).reduce((acc, [date, group]) => {
      acc[date] = {
        round: group.round,
        amount: group.amount,
        valuation: group.valuation,
        formattedAmount: group.formattedAmount,
        formattedValuation: group.formattedValuation,
      };
      return acc;
    }, {});

    const investedData = {
      investors,
      total_funding: totalFunding,
      grouped_investments: groupedInvestmentsWithoutInvestors,
    };

    // 9. 处理 investor（投出的项目）数据
    const rawFundedProjects = (investmentsGiven || []).map((investment) => ({
      avatar: investment.fundedProject?.logo || "",
      name: investment.fundedProject?.projectName || "",
      twitter: investment.fundedProject?.socialLinks?.x || "",
      lead_investor: investment.fundedProject?.lead || false,
      amount: investment.formattedAmount || 0, // 🔧 修复：添加 amount 字段
    }));

    const fundedProjects = Array.from(
      rawFundedProjects
        .reduce((map, item) => {
          if (map.has(item.name)) {
            const existing = map.get(item.name);
            if (!existing.lead_investor && item.lead_investor) {
              map.set(item.name, item);
            }
          } else {
            map.set(item.name, item);
          }
          return map;
        }, new Map())
        .values()
    );

    // 🔧 修复：正确计算投出的总金额
    const totalInvestment = (investmentsGiven || []).reduce(
      (sum, inv) => sum + (inv.formattedAmount || 0),
      0
    );

    const investorData = {
      investors: fundedProjects,
      total_funding: totalInvestment,
    };

    // 10. 异步更新头像（如果有缺失的头像）
    const usernamesToFetch = new Set();

    investors.forEach((investor) => {
      if (investor.twitter) {
        const username = extractUsername(investor.twitter);
        if (
          username &&
          (!investor.avatar ||
            !investor.avatar.startsWith("https://pbs.twimg.com"))
        ) {
          usernamesToFetch.add(username);
        }
      }
    });

    fundedProjects.forEach((project) => {
      if (project.twitter) {
        const username = extractUsername(project.twitter);
        if (
          username &&
          (!project.avatar ||
            !project.avatar.startsWith("https://pbs.twimg.com"))
        ) {
          usernamesToFetch.add(username);
        }
      }
    });

    // 异步获取和更新头像
    if (usernamesToFetch.size > 0) {
      setImmediate(async () => {
        try {
          const usernames = Array.from(usernamesToFetch);
          const apiURL = `https://data.cryptohunt.ai/fetch/twitter/users?usernames=${usernames.join(
            ","
          )}`;
          const response = await axios.get(apiURL);
          const userDataArray = response?.data?.data?.data || [];

          const avatarMap = {};
          userDataArray.forEach((user) => {
            if (user?.profile?.username && user?.profile?.profile_image_url) {
              avatarMap[String(user?.profile?.username).toLowerCase()] =
                user?.profile?.profile_image_url;
            }
          });

          // 更新内存中的数据（不等待数据库更新）
          investors.forEach((investor) => {
            if (investor.twitter) {
              const username = String(
                extractUsername(investor.twitter)
              ).toLowerCase();
              if (username && avatarMap[username]) {
                investor.avatar = avatarMap[username];
              }
            }
          });

          fundedProjects.forEach((project) => {
            if (project.twitter) {
              const username = String(
                extractUsername(project.twitter)
              ).toLowerCase();
              if (username && avatarMap[username]) {
                project.avatar = avatarMap[username];
              }
            }
          });

          // 异步更新数据库
          await batchUpdateProjectLogos(avatarMap, Fundraising);
        } catch (error) {
          console.error("Error fetching/updating avatars:", error);
        }
      });
    }

    // 11. 组装最终响应
    const response = {
      invested: investedData,
      investor: investorData,
      projectLink: project?.projectLink,
    };

    // 12. 缓存结果到 Redis（2小时）
    try {
      await req.redisClient.setEx(
        cacheKey,
        CACHE_TTL_ROOTDATA,
        JSON.stringify(response)
      );
    } catch (error) {
      console.error("Redis Client Error (SET):", error);
    }

    res.set("Cache-Control", `public, max-age=${HTTP_CACHE_TTL}`);
    res.set("X-Cache-Status", "MISS");
    res.json(response);
  } catch (error) {
    console.error("Error in rootdata search:", error);
    res.status(500).json({
      error: "Failed to search project",
      message: error.message || "Unknown error",
    });
  }
});

/**
 * DELETE /api/rootdata/relationship/:id
 * 删除单条投资关系记录
 */
router.delete("/relationship/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Missing relationship id" });
    }

    const { Fundraising } = require("../../models/postgres-fundraising");
    if (!Fundraising) {
      return res.status(500).json({ error: "Database model not initialized" });
    }

    // 查找记录
    const relationship = await Fundraising.InvestmentRelationships.findByPk(id);
    if (!relationship) {
      return res.status(404).json({ error: "Relationship not found" });
    }

    // 删除记录
    await relationship.destroy();

    console.log(`✅ 删除投资关系记录: ID=${id}`);

    res.json({
      success: true,
      message: "删除成功",
      deletedId: id,
    });
  } catch (error) {
    console.error("删除投资关系失败:", error);
    res.status(500).json({
      error: "Failed to delete relationship",
      message: error.message,
    });
  }
});

/**
 * DELETE /api/rootdata/relationships/funded-project/:fundedProjectId
 * 删除被投项目的投资关系记录（可选：仅删除指定日期范围内的）
 *
 * Query params:
 *   - date: 可选，格式 YYYY-MM-DD，只删除该日期 00:00:00 到 23:59:59 创建的记录
 */
router.delete(
  "/relationships/funded-project/:fundedProjectId",
  async (req, res) => {
    try {
      const { fundedProjectId } = req.params;
      const { date } = req.query;

      if (!fundedProjectId) {
        return res.status(400).json({ error: "Missing funded project id" });
      }

      const { Fundraising } = require("../../models/postgres-fundraising");
      if (!Fundraising) {
        return res
          .status(500)
          .json({ error: "Database model not initialized" });
      }

      // 构建删除条件
      const whereCondition = { fundedProjectId: fundedProjectId };

      // 如果提供了日期，只删除该日期范围内创建的记录
      if (date) {
        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
          return res.status(400).json({ error: "Invalid date format" });
        }

        // 设置日期范围：当天 00:00:00 到 23:59:59
        const startOfDay = new Date(dateObj);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(dateObj);
        endOfDay.setHours(23, 59, 59, 999);

        whereCondition.createdAt = {
          [Op.gte]: startOfDay,
          [Op.lte]: endOfDay,
        };

        console.log(
          `🗑️ 删除被投项目 (ID=${fundedProjectId}) 在 ${date} 新增的投资关系`
        );
      } else {
        console.log(
          `⚠️ 删除被投项目 (ID=${fundedProjectId}) 的所有投资关系（无日期限制）`
        );
      }

      // 删除符合条件的记录
      const result = await Fundraising.InvestmentRelationships.destroy({
        where: whereCondition,
      });

      console.log(`✅ 成功删除 ${result} 条记录`);

      res.json({
        success: true,
        message: "删除成功",
        deletedCount: result,
        fundedProjectId: fundedProjectId,
        dateFilter: date || "all",
      });
    } catch (error) {
      console.error("删除被投项目投资关系失败:", error);
      res.status(500).json({
        error: "Failed to delete relationships",
        message: error.message,
      });
    }
  }
);

/**
 * POST /api/rootdata/manual-crawl
 * 手动触发单个项目的爬取
 */
router.post("/manual-crawl", async (req, res) => {
  const startTime = Date.now();
  console.log(`🚀 [手动爬虫] 开始执行: ${req.body.url}`);

  try {
    const { url } = req.body;

    if (!url || !url.includes("rootdata.com")) {
      return res.status(400).json({ error: "Invalid RootData URL" });
    }

    const { Fundraising } = require("../../models/postgres-fundraising");
    if (!Fundraising) {
      return res.status(500).json({ error: "Database model not initialized" });
    }

    // 1. 查找或创建项目
    let project = await Fundraising.Project.findOne({
      where: { projectLink: url },
    });

    if (!project) {
      const match = url.match(/\/detail\/([^?]+)/);
      const projectName = match
        ? decodeURIComponent(match[1])
        : "Unknown Project";

      project = await Fundraising.Project.create({
        projectName,
        projectLink: url,
        isInitial: true,
        detailFailuresNumber: 0,
        detailFetchedAt: null,
      });
      console.log(`📦 [手动爬虫] 创建项目: ${projectName}`);
    }

    // 2. 执行爬取
    const crawler = require("../../services/rootdata-crawler");
    const { browser, page } = await crawler.initBrowserAndPage();

    try {
      await crawler.scrapeAndUpdateProjectDetails(project, page, true);

      // 3. 获取更新后的数据
      const updatedProject = await Fundraising.Project.findByPk(project.id, {
        attributes: ["id", "projectName", "projectLink", "logo", "socialLinks"],
      });

      // 4. 统计投资关系（双向）
      const [asInvestor, asInvestee] = await Promise.all([
        // 作为投资者投资的项目
        Fundraising.InvestmentRelationships.findAll({
          where: { investorProjectId: project.id },
          include: [
            {
              model: Fundraising.Project,
              as: "fundedProject",
              attributes: ["id", "projectName", "projectLink", "logo"],
            },
          ],
          attributes: ["id", "round", "amount", "valuation", "date", "lead"],
        }),
        // 作为被投资者，被谁投资
        Fundraising.InvestmentRelationships.findAll({
          where: { fundedProjectId: project.id },
          include: [
            {
              model: Fundraising.Project,
              as: "investorProject",
              attributes: ["id", "projectName", "projectLink", "logo"],
            },
          ],
          attributes: ["id", "round", "amount", "valuation", "date", "lead"],
        }),
      ]);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(
        `✅ [手动爬虫] 完成: ${updatedProject.projectName} (${duration}秒)`
      );
      console.log(`   投资了 ${asInvestor.length} 个项目`);
      console.log(`   被 ${asInvestee.length} 个投资者投资`);

      res.json({
        success: true,
        message: "爬取成功",
        data: {
          project: {
            id: updatedProject.id,
            projectName: updatedProject.projectName,
            projectLink: updatedProject.projectLink,
            logo: updatedProject.logo,
            socialLinks: updatedProject.socialLinks,
          },
          // 作为投资者投资的项目
          asInvestor: asInvestor.map((r) => ({
            id: r.id,
            project: r.fundedProject,
            round: r.round,
            amount: r.amount,
            valuation: r.valuation,
            date: r.date,
            lead: r.lead,
          })),
          // 被谁投资
          asInvestee: asInvestee.map((r) => ({
            id: r.id,
            investor: r.investorProject,
            round: r.round,
            amount: r.amount,
            valuation: r.valuation,
            date: r.date,
            lead: r.lead,
          })),
        },
      });
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ [手动爬虫] 失败 (${duration}秒): ${error.message}`);

    res.status(500).json({
      error: "Failed to crawl project",
      message: error.message || "Unknown error",
    });
  }
});

module.exports = router;
