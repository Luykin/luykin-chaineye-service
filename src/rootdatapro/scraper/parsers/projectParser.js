const { JSDOM } = require("jsdom");

/**
 * 解析项目页面的内容以提取数据。
 * @param {{ mainDom: string|null, nuxtDataJson: string|null, url: string }} input
 * @returns {object|null} 包含提取数据的对象，如果解析失败则返回 null。
 */
function parseProjectPage({ mainDom, nuxtDataJson, url }) {
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
    heat: "-",
    heat_rank: "-",
    influence: "-",
    influence_rank: "-",
    followers: undefined,
    following: undefined,
    teamMembers: [],
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
    parsedData.total_funding = projectDetail.financingTotal || null;
    parsedData.fully_diluted_market_cap = projectDetail.fullyDilutedMarketCap;
    parsedData.market_cap = projectDetail.marketCap;
    parsedData.price = projectDetail.price;
    parsedData.token_launch_time = projectDetail.hapDate || null;
    parsedData.followers = projectDetail.followersCount;
    parsedData.following = projectDetail.friendsCount;
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
    parsedData.similar_project = projectDetail.similarProjectList || [];
    parsedData.on_main_net = (projectDetail.onlineMainnet || []).map(
      (i) => i.name
    );
    parsedData.plan_to_launch = (projectDetail.planToLaunch || []).map(
      (i) => i.name
    );
    parsedData.on_test_net = (projectDetail.onlineTestnet || []).map(
      (i) => i.name
    );
    parsedData.event = nuxtData.data[0].eventList || [];
    parsedData.reports = nuxtData.data[0].reportList || [];
    parsedData.contracts = projectDetail.contracts || [];
    parsedData.support_exchanges = projectDetail.exchangeList || [];
  } catch (e) {
    console.error("[projectParser] 列表类信息解析失败:", e);
  }

  return parsedData;
}

module.exports = { parseProjectPage };
