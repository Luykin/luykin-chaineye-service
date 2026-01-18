const { JSDOM } = require("jsdom");
const typemapManager = require("../typemap/manager");

/**
 * 解析项目页面的内容以提取数据。
 * @param {{ mainDom: string|null, nuxtDataJson: string|null, url: string }} input
 * @returns {object|null} 包含提取数据的对象，如果解析失败则返回 null。
 */
function parseProjectPage({ mainDom, nuxtDataJson, url }) {
  function parseMoneyToNumber(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "string") return null;

    const s = v.trim();
    if (!s) return null;

    const cleaned = s.replace(/[$,\s]/g, "");
    const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([mkb])?$/i);
    if (!match) return null;

    const num = parseFloat(match[1]);
    if (!Number.isFinite(num)) return null;

    const unit = (match[2] || "").toLowerCase();
    if (unit === "k") return Math.round(num * 1e3);
    if (unit === "m") return Math.round(num * 1e6);
    if (unit === "b") return Math.round(num * 1e9);
    return Math.round(num);
  }

  function parseUnitNumber(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "string") return null;

    const s = v.trim().toLowerCase().replace(/,/g, "");
    if (!s) return null;

    const match = s.match(/^(-?\d+(?:\.\d+)?)([mk])?$/);
    if (!match) {
      const n = parseFloat(s);
      return Number.isFinite(n) ? Math.round(n) : null;
    }

    const num = parseFloat(match[1]);
    if (!Number.isFinite(num)) return null;
    const unit = match[2] || "";
    if (unit === "k") return Math.round(num * 1e3);
    if (unit === "m") return Math.round(num * 1e6);
    return Math.round(num);
  }
  const parsedData = {
    project_id: undefined,
    project_name: undefined,
    logo: undefined,
    token_symbol: undefined,
    establishment_date: null,
    one_liner: "",
    description: "",
    active: true,
    total_funding: null,
    rootdataurl: url,
    social_media: {},
    X: undefined,
    similar_project: [],
    on_main_net: [],
    plan_to_launch: [],
    on_test_net: [],
    fully_diluted_market_cap: undefined,
    market_cap: undefined,
    price: undefined,
    event: [],
    reports: [],
    token_launch_time: null,
    contracts: [],
    support_exchanges: [],
    tags: [],
    ecosystems: [],
    heat: "-",
    heat_rank: "-",
    influence: "-",
    influence_rank: "-",
    followers: undefined,
    following: undefined,
    teamMembers: [],
    investors: { facAmountUS: null, facNum: 0, investList: [] },
    investmentProjects: { investItemNum: 0, investList: [], lpList: [] },
  };

  let dom = null;
  try {
    dom = new JSDOM(mainDom || "");
  } catch (e) {
    console.error("[projectParser] JSDOM 初始化失败:", e);
    return null;
  }

  let nuxtData = null;
  try {
    nuxtData = nuxtDataJson ? JSON.parse(nuxtDataJson) : null;
  } catch (e) {
    console.error("[projectParser] 解析 nuxtDataJson 失败:", e);
    nuxtData = null;
  }

  const projectDetail = nuxtData?.data?.[0]?.detail;
  if (!projectDetail) {
    console.error("[projectParser] 在 __NUXT__ 数据中找不到项目详细信息。");
    return null;
  }

  // --- 基础信息 ---
  try {
    parsedData.project_id = projectDetail.id;
    parsedData.project_name = projectDetail.name?.en_value;
    parsedData.logo = projectDetail.logoImg;
    parsedData.token_symbol = projectDetail.lssuingCode;
    parsedData.one_liner = projectDetail.briefIntd?.en_value || "";
    parsedData.description = projectDetail.intd?.en_value || "";
    // parsedData.total_funding = projectDetail.financingTotal || null; // 改为从 DOM 中解析
    parsedData.fully_diluted_market_cap = projectDetail.fullyDilutedMarketCap;
    parsedData.market_cap = projectDetail.marketCap;
    parsedData.price = projectDetail.price;
    parsedData.token_launch_time = projectDetail.hapDate || null;
    parsedData.X = projectDetail.twitterUrl;
    parsedData.active = projectDetail.operateStatus === 1;
  } catch (e) {
    console.error("[projectParser] 基础字段解析失败:", e);
  }

  // --- 团队成员 ---
  try {
    const teamList = nuxtData?.data?.[0]?.teamList || [];
    parsedData.teamMembers = (Array.isArray(teamList) ? teamList : [])
      .map((m) => {
        try {
          return {
            projectId: projectDetail.id,
            personId: m.id,
            position: m.position?.en_value,
            people_name: m.name?.en_value,
            head_img: m.headImg,
            X: m.twitterUrl,
            linkedin: m.lyingUrl,
            blog: m.blogUrl,
          };
        } catch (e) {
          console.error("[projectParser] teamMembers 单条解析失败:", e);
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    console.error("[projectParser] teamMembers 解析失败:", e);
  }

  // --- 投资机构 ---
  try {
    const investorsData = nuxtData?.data?.[0]?.investors;
    if (investorsData) {
      parsedData.investors.facAmountUS = investorsData.facAmountUS || null;
      parsedData.investors.facNum = investorsData.facNum || 0;
      const investList = investorsData.investList || [];
      parsedData.investors.investList = (Array.isArray(investList) ? investList : []).map(inv => {
        try {
          return {
            facDate: inv.facDate || null,
            imgUrl: inv.imgUrl,
            investId: inv.investId,
            investName: inv.investName?.en_value,
            ltNum: inv.ltNum,
            type: inv.type,
            item_type: typemapManager.getType(inv.investId) || inv.type || null,
          };
        } catch (e) {
          console.error("[projectParser] investors.investList 单条解析失败:", e);
          return null;
        }
      }).filter(Boolean);
    }
  } catch (e) {
    console.error("[projectParser] investors 解析失败:", e);
  }

  // --- 对外投资项目 ---
  try {
    const investmentProjectsData = nuxtData?.data?.[0]?.investmentProjects;
    if (investmentProjectsData) {
      parsedData.investmentProjects.investItemNum = investmentProjectsData.investItemNum || 0;

      const investList = investmentProjectsData.investList || [];
      parsedData.investmentProjects.investList = (Array.isArray(investList) ? investList : []).map(item => {
        try {
          return {
            briefIntd: item.briefIntd?.en_value,
            facRounds: item.facRounds,
            imgUrl: item.imgUrl,
            intd: item.intd?.en_value,
            itemId: item.itemId,
            itemName: item.itemName?.en_value,
            operateStatus: item.operateStatus,
            item_type: typemapManager.getType(item.itemId) || 1,
          };
        } catch (e) {
          console.error("[projectParser] investmentProjects.investList 单条解析失败:", e);
          return null;
        }
      }).filter(Boolean);

      const lpList = investmentProjectsData.lpList || [];
      parsedData.investmentProjects.lpList = (Array.isArray(lpList) ? lpList : []).map(item => {
        try {
            const safeParseJson = (jsonString) => {
                try {
                    // 检查字符串是否为有效的 JSON 格式
                    if (typeof jsonString === 'string' && jsonString.startsWith('{') && jsonString.endsWith('}')) {
                         return JSON.parse(jsonString);
                    }
                    return {}; // 如果不是，返回空对象
                } catch {
                    return {};
                }
            };
            const briefIntd = safeParseJson(item.briefIntd);
            const intd = safeParseJson(item.intd);
            const orgName = safeParseJson(item.orgName);

          return {
            briefIntd: briefIntd?.en_value,
            imgUrl: item.imgUrl,
            intd: intd?.en_value,
            operateStatus: item.operateStatus,
            orgId: item.orgId,
            orgName: orgName?.en_value,
          };
        } catch (e) {
          console.error("[projectParser] investmentProjects.lpList 单条解析失败:", e);
          return null;
        }
      }).filter(Boolean);
    }
  } catch (e) {
    console.error("[projectParser] investmentProjects 解析失败:", e);
  }

  // --- 从 DOM 中解析额外信息 ---
  try {
    const tokenInfoItems = dom.window.document.querySelectorAll(
      ".token_info .amount_list li"
    );
    for (const item of tokenInfoItems) {
      const label = (item.querySelector(".label")?.textContent || "").trim();
      const value = (item.querySelector(".value")?.textContent || "").trim();

      if (label === "Total Raised") {
        parsedData.total_funding = parseMoneyToNumber(value) ?? value;
        break;
      }
    }

    if (!parsedData.total_funding) {
      const comparisonTableRows = dom.window.document.querySelectorAll(
        ".comparison_table_tr"
      );
      for (const row of comparisonTableRows) {
        const labelEl = row.querySelector(".comparison_table_td:first-child");
        if (labelEl && labelEl.textContent.trim() === "Total Raised") {
          const valueEl = row.querySelector(".fundraisingTotal span");
          if (valueEl) {
            const raw = valueEl.textContent.trim();
            parsedData.total_funding = parseMoneyToNumber(raw) ?? raw;
            break;
          }
        }
      }
    }
  } catch (e) {
    console.error("[projectParser] Total Raised 解析失败:", e);
  }

  // 如果 DOM 上无法解析到 Total Raised，则用 investors.facAmountUS 兜底
  if ((parsedData.total_funding === null || parsedData.total_funding === undefined || parsedData.total_funding === "") && parsedData.investors?.facAmountUS) {
    parsedData.total_funding = parsedData.investors.facAmountUS;
  }

  // --- X 卡片信息 ---
  try {
    const analysisItems = dom.window.document.querySelectorAll(
      ".analysis_card .analysis .item"
    );
    for (const item of analysisItems) {
      const label = (
        item.querySelector(".sub_title")?.textContent || ""
      ).trim();
      const value = (
        item.querySelector(".analyze_value")?.textContent || ""
      ).trim();

      if (label === "Followers") {
        parsedData.followers = parseUnitNumber(value);
      } else if (label === "Following") {
        parsedData.following = parseUnitNumber(value);
      }
    }
  } catch (e) {
    console.error("[projectParser] .analysis_card 解析失败:", e);
  }

  // --- 成立日期 (从 DOM) ---
  try {
    const sideBarItems = dom.window.document.querySelectorAll(
      "main .side_bar_info .item"
    );
    for (const item of sideBarItems) {
      const labelElement = item.querySelector(".label");
      if (labelElement && labelElement.textContent.trim() === "Founded:") {
        const valueElement =
          item.querySelector(".value") || item.querySelector(".info_text");
        if (valueElement) {
          parsedData.establishment_date = valueElement.textContent.trim();
          break;
        }
      }
    }
  } catch (e) {
    console.error("[projectParser] 成立日期解析失败:", e);
  }

  // --- 社交媒体 ---
  try {
    parsedData.social_media = {
      website: projectDetail.website,
      twitter: projectDetail.twitterUrl,
      telegram: projectDetail.telegramUrl,
      discord: projectDetail.discordUrl,
      github: projectDetail.githubUrl,
      medium: projectDetail.type2Url,
    };
  } catch (e) {
    console.error("[projectParser] social_media 解析失败:", e);
  }

  // --- 列表类信息 ---
  try {
    try {
      const similarItems = dom.window.document.querySelectorAll(".apps .list .item");
      const similarProjects = [];
      for (const item of similarItems) {
        try {
          const name = (item.querySelector("h4")?.textContent || "").trim();
          const description = (item.querySelector("p")?.textContent || "").trim();
          const logo = item.querySelector("img")?.getAttribute("src") || "";
          const url = item.getAttribute("href") || "";

          if (name || url) {
            similarProjects.push({
              name,
              description,
              logo,
              url: url ? new URL(url, "https://www.rootdata.com").toString() : null,
            });
          }
        } catch (e) {
          console.error("[projectParser] similar_project 单条解析失败:", e);
        }
      }
      parsedData.similar_project = similarProjects;
    } catch (e) {
      console.error("[projectParser] similar_project 列表解析失败:", e);
    }
    // parsedData.on_main_net = (projectDetail.onlineMainnet || []).map(
    //   (i) => i.name
    // );
    // parsedData.plan_to_launch = (projectDetail.planToLaunch || []).map(
    //   (i) => i.name
    // );
    // parsedData.on_test_net = (projectDetail.onlineTestnet || []).map(
    //   (i) => i.name
    // );
    try {
      const eventEls = dom.window.document.querySelectorAll(
        "#detail_section_essentials_milestones .timeline-container .timeline-step .content-box"
      );
      const events = [];
      for (const el of eventEls) {
        try {
          const date = (
            el.querySelector(".content-date span")?.textContent || ""
          ).trim();
          const infoEl = el.querySelector(".content-info");
          const a = infoEl.querySelector("a");
          const title = (a?.textContent || infoEl?.textContent || "").trim();
          const link = (a?.getAttribute("href") || "").trim();

          if (date || title) {
            events.push({
              date: date || null,
              title: title || null,
              url: link
                ? new URL(link, "https://www.rootdata.com").toString()
                : null,
            });
          }
        } catch (e) {
          console.error("[projectParser] events 单条解析失败:", e);
        }
      }
      parsedData.event = events;
    } catch (e) {
      console.error("[projectParser] events 列表解析失败:", e);
    }
    try {
      const reportItems = dom.window.document.querySelectorAll(
        ".detail_news_list .detail_news_item"
      );
      const reports = [];
      for (const item of reportItems) {
        try {
          const date = (
            item.querySelector(".item_date .time")?.textContent || ""
          ).trim();
          const titleEl = item.querySelector(".item_title");
          const title = (titleEl?.textContent || "").trim();
          const url = titleEl?.getAttribute("href") || "";
          const source = (
            item.querySelector(".item_origin")?.textContent || ""
          ).trim();

          if (date || title || url) {
            reports.push({
              date: date || null,
              title: title || null,
              url: url
                ? new URL(url, "https://www.rootdata.com").toString()
                : null,
              source: source || null,
            });
          }
        } catch (e) {
          console.error("[projectParser] reports 单条解析失败:", e);
        }
      }
      parsedData.reports = reports;
    } catch (e) {
      console.error("[projectParser] reports 列表解析失败:", e);
    }
    parsedData.contracts = projectDetail.contracts || [];
    parsedData.support_exchanges = projectDetail.exchangeList || [];
    parsedData.tags = (projectDetail.tagList || []).map((tag) => ({
      tag_id: tag.id,
      tag_name: tag.name?.en_value,
    }));
    parsedData.ecosystems = (projectDetail.sjList || []).map((eco) => ({
      ecosystem_id: eco.id,
      ecosystem_name: eco.name,
    }));
  } catch (e) {
    console.error("[projectParser] 列表类信息解析失败:", e);
  }

  return parsedData;
}

module.exports = { parseProjectPage };
