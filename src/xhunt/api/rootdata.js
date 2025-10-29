const express = require("express");
const { Op, literal } = require("sequelize");
const axios = require("axios");
const router = express.Router();

// 缓存时间：2小时 = 7200 秒
const CACHE_TTL_ROOTDATA = 7200;

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
        res.set("Cache-Control", "public, max-age=7200");
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

    // 6. 并行查询关联数据（性能优化）
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

    // 7. 处理 invested（收到的投资）数据
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

    // 7. 处理 investor（投出的项目）数据
    const rawFundedProjects = (investmentsGiven || []).map((investment) => ({
      avatar: investment.fundedProject?.logo || "",
      name: investment.fundedProject?.projectName || "",
      twitter: investment.fundedProject?.socialLinks?.x || "",
      lead_investor: investment.fundedProject?.lead || false,
    }));

    let fundedProjects = Array.from(
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

    // 特殊处理：为 phyrex_ni 添加硬编码的投资项目
    if (sanitizedKeyword.toLowerCase() === "phyrex_ni") {
      const hardcodedFundedProjects = [
        {
          avatar:
            "https://pbs.twimg.com/profile_images/1852368489174159360/htlVoJ1j_400x400.jpg",
          name: "Solayer Labs",
          twitter: "https://x.com/solayer_labs",
          lead_investor: false,
        },
        {
          avatar:
            "https://pbs.twimg.com/profile_images/1906615420939022336/j1PVcH8N_400x400.jpg",
          name: "Aster DEX",
          twitter: "https://x.com/aster_dex",
          lead_investor: false,
        },
        {
          avatar:
            "https://pbs.twimg.com/profile_images/1624112902771703821/oSgPaG68_400x400.png",
          name: "Huma Finance",
          twitter: "https://x.com/humafinance",
          lead_investor: false,
        },
        {
          avatar:
            "https://pbs.twimg.com/profile_images/1955663161928921088/nn_g5zL1_400x400.png",
          name: "Sahara Labs AI",
          twitter: "https://x.com/saharalabsai",
          lead_investor: false,
        },
        {
          avatar:
            "https://pbs.twimg.com/profile_images/1963511865520373760/KaLCvZ5s_400x400.jpg",
          name: "GAIB AI",
          twitter: "https://x.com/gaib_ai",
          lead_investor: false,
        },
      ];
      fundedProjects = [...fundedProjects, ...hardcodedFundedProjects];
    }

    const investorData = {
      investors: fundedProjects,
      total_funding: fundedProjects.reduce(
        (sum, proj) => sum + (proj.amount || 0),
        0
      ),
    };

    // 8. 异步更新头像（如果有缺失的头像）
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

    // 9. 组装最终响应
    const response = {
      invested: investedData,
      investor: investorData,
      projectLink: project?.projectLink,
    };

    // 10. 缓存结果到 Redis（2小时）
    try {
      await req.redisClient.setEx(
        cacheKey,
        CACHE_TTL_ROOTDATA,
        JSON.stringify(response)
      );
    } catch (error) {
      console.error("Redis Client Error (SET):", error);
    }

    res.set("Cache-Control", "public, max-age=7200");
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
