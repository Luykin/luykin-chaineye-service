const express = require("express");
const { Op, literal } = require("sequelize");
const axios = require("axios");
const router = express.Router();

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
      // Base64 解码
      const decoded = Buffer.from(match[1], "base64").toString("utf-8");
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
  static async getFundingInfo(projectId) {
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

      if (response.data?.result === 200) {
        return response.data.data;
      }

      throw new Error(`API returned result: ${response.data?.result}`);
    } catch (error) {
      console.error("Rootdata API Error (get_fac):", error.message);
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

    return await this.getFundingInfo(projectId);
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
      const cacheKey = `rootdata_verified:${projectLink}`;

      // 1. 检查24小时内是否已修正
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        console.log(`✅ 使用缓存数据，跳过API调用: ${projectLink}`);
        return JSON.parse(cached);
      }

      // 2. 调用 Rootdata API
      console.log(`🔍 验证项目数据: ${projectLink}`);
      const apiData = await RootdataAPIService.getProjectFundingData(
        projectLink
      );

      if (!apiData || !apiData.items || apiData.items.length === 0) {
        console.log(`⚠️ 未找到API数据，跳过修正: ${projectLink}`);
        return null;
      }
      console.log(`🔍 API数据-有几轮: ${apiData.items.length}`);
      console.log(`开始修正数据... ${project.projectName} ${projectLink}`);
      // 3. 修正数据
      await this.fixProjectData(project, apiData, Fundraising);
      console.log(`修正数据完成... ${project.projectName} ${projectLink}`);
      // 4. 清除搜索结果缓存，让下次请求获取修正后的数据
      if (searchCacheKey) {
        try {
          await redisClient.del(searchCacheKey);
          console.log(`🗑️ 已清除搜索结果缓存: ${searchCacheKey}`);
        } catch (error) {
          console.error("清除缓存失败:", error);
        }
      }

      // 5. 缓存验证结果（24小时）
      const cacheData = {
        verified: true,
        verifiedAt: Date.now(),
        data: apiData,
      };
      await redisClient.setEx(cacheKey, 86400, JSON.stringify(cacheData));

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

    for (const round of apiData.items) {
      if (!round.invests || round.invests.length === 0) continue;

      for (const investor of round.invests) {
        try {
          // 查找或创建投资者项目
          const investorProject = await this.findOrCreateInvestor(
            investor,
            Fundraising
          );

          if (!investorProject) continue;

          // 查找或创建投资关系
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
        } catch (error) {
          console.error(`修正投资者失败:`, error.message);
        }
      }
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
    let fullProjectLink = projectLink;
    if (!projectLink.includes("http")) {
      fullProjectLink = `https://www.rootdata.com${projectLink}`;
    }

    // 查找是否存在
    const existing = await Fundraising.Project.findOne({
      where: { projectLink: fullProjectLink },
      raw: true,
    });

    if (existing) {
      return existing;
    }

    // 创建新项目
    const newProject = await Fundraising.Project.create({
      projectName: investor.name,
      projectLink: fullProjectLink,
      logo: investor.logo,
      description: investor.name, // 使用名称作为描述
      isInitial: false, // 标记为投资者项目
      socialLinks: investor.X ? { x: investor.X } : null,
    });

    console.log(`✨ 创建新投资者项目: ${investor.name}`);
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
      // 更新现有关系
      await Fundraising.InvestmentRelationships.update(
        {
          amount: relationshipData.amount,
          formattedAmount: relationshipData.formattedAmount,
          date: relationshipData.date,
          lead: relationshipData.lead,
        },
        {
          where: {
            investorProjectId,
            fundedProjectId,
            round,
          },
        }
      );
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
  YZiLabs: "BinanceLabs",
  yzilabs: "BinanceLabs",
};

/**
 * 辅助函数：按日期分组投资记录
 */
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
          WHEN (LOWER(socialLinks->>'x') = LOWER('${twitterUrl}') OR
                LOWER(socialLinks->>'x') = LOWER('${twitterUrlWithSlash}'))
          THEN '${avatar}'
        `;
      })
      .join("");

    const updateQuery = `
      UPDATE "Projects"
      SET logo = CASE ${caseWhenClauses}
                  ELSE logo
                  END
      WHERE socialLinks->>'x' IS NOT NULL
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
    const cacheKey = `rootdata_search_${sanitizedKeyword}`;

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

    // 5. 优化查询：先找到项目，再分别查询关联
    const project = await Fundraising.Project.findOne({
      where: {
        socialLinks: {
          [Op.or]: [
            literal(`LOWER(socialLinks->>'x') = LOWER('${targetTwitterUrl}')`),
            literal(
              `LOWER(socialLinks->>'x') = LOWER('${targetTwitterUrlWithSlash}')`
            ),
          ],
        },
      },
      order: [["id", "DESC"]],
      attributes: [
        "id",
        "projectName",
        "projectLink",
        "socialLinks",
        "logo",
        "amount",
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

    // 6. 异步验证和修正数据（不影响响应速度）
    // 修正完成后会自动清除缓存，确保下次请求能获取最新数据
    setImmediate(async () => {
      try {
        await RootdataDataFixService.verifyAndFixProject(
          project,
          Fundraising,
          req.redisClient,
          cacheKey // 传入搜索缓存key，修正后会清除
        );
        console.log(`✅ 数据修正完成: ${cacheKey}`);
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

    const investedData = {
      investors,
      total_funding: totalFunding,
    };

    // 9. 处理 investor（投出的项目）数据
    const rawFundedProjects = (investmentsGiven || []).map((investment) => ({
      avatar: investment.fundedProject?.logo || "",
      name: investment.fundedProject?.projectName || "",
      twitter: investment.fundedProject?.socialLinks?.x || "",
      lead_investor: investment.fundedProject?.lead || false,
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

    const investorData = {
      investors: fundedProjects,
      total_funding: fundedProjects.reduce(
        (sum, proj) => sum + (proj.amount || 0),
        0
      ),
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

module.exports = router;
