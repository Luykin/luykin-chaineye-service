const { JSDOM } = require("jsdom");
const typemapManager = require("../typemap/manager");

/**
 * 解析组织页面的内容以提取数据。
 * @param {{ mainDom: string|null, nuxtDataJson: string|null, url: string }} input
 * @returns {object|null} 包含提取数据的对象，如果解析失败则返回 null。
 */
function parseOrganizationPage({ mainDom, nuxtDataJson, url }) {
  const parsedData = {
    org_id: undefined,
    org_name: undefined,
    logo: undefined,
    establishment_date: null,
    description: "",
    active: true,
    social_media: {
      website: undefined,
      twitter: undefined,
      linkedin: undefined,
    },
    rootdataurl: url,
    followers: undefined,
    following: undefined,
    heat: "-",
    heat_rank: "-",
    influence: "-",
    influence_rank: "-",
    investments: [],
    investorCards: [],
  };

  let dom = null;
  try {
    dom = new JSDOM(mainDom || "");
  } catch (e) {
    console.error("[organizationParser] JSDOM 初始化失败:", e);
    return null;
  }

  let nuxtData = null;
  try {
    nuxtData = nuxtDataJson ? JSON.parse(nuxtDataJson) : null;
  } catch (e) {
    console.error("[organizationParser] 解析 nuxtDataJson 失败:", e);
    nuxtData = null;
  }

  const orgDetail = nuxtData?.data?.[0]?.detail;
  if (!orgDetail) {
    console.error("[organizationParser] 在 __NUXT__ 数据中找不到组织详细信息。");
    return null;
  }

  try {
    parsedData.org_id = orgDetail.id;
    parsedData.org_name = orgDetail.name?.en_value;
    parsedData.logo = orgDetail.logoImg;
    parsedData.description = orgDetail.intd?.en_value || "";
    parsedData.followers = orgDetail.followersCount;
    parsedData.following = orgDetail.friendsCount;
  } catch (e) {
    console.error("[organizationParser] 基础字段解析失败:", e);
  }

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
    console.error("[organizationParser] 成立日期解析失败:", e);
  }

  try {
    parsedData.active =
      !dom.window.document
        .querySelector("main .detail_info_head .inactive")
        ?.textContent?.trim()
        ?.includes("(Inactive)");
  } catch (e) {
    console.error("[organizationParser] active 状态解析失败:", e);
  }

  try {
    parsedData.social_media = {
      website: orgDetail.website,
      twitter: orgDetail.twitterUrl,
      linkedin: orgDetail.lyingUrl,
    };
  } catch (e) {
    console.error("[organizationParser] social_media 解析失败:", e);
  }

  try {
    const investorItems = dom.window.document.querySelectorAll(
      "main .investor .cards .row .item a.card"
    );
    for (const a of investorItems) {
      try {
        const href = a.getAttribute("href") || "";
        const name = (a.querySelector("h2")?.textContent || "").trim();
        const logo = a.querySelector("img")?.getAttribute("src") || "";
        parsedData.investorCards.push({
          name,
          logo,
          url: href
            ? new URL(href, "https://www.rootdata.com").toString()
            : "",
        });
      } catch (e) {
        console.error("[organizationParser] investorCards 单卡解析失败:", e);
      }
    }
  } catch (e) {
    console.error("[organizationParser] investorCards 列表解析失败:", e);
  }

  try {
    const investRecordList = nuxtData?.data?.[0]?.investRecordList?.items || [];
    parsedData.investments = investRecordList.map((item) => {
      try {
        return {
          item_id: item.itemId,
          item_type: typemapManager.getType(item.itemId) || 1,
          item_name: item.itemName?.en_value,
          logo: item.logoImg,
          description: item.intd?.en_value || "",
          round: item.roundsName?.en_value,
          amount: item.facAmountUs,
          date: item.facDate ? new Date(item.facDate) : null,
        };
      } catch (e) {
        console.error("[organizationParser] investments 单条解析失败:", e);
        return null;
      }
    }).filter(Boolean);
  } catch (e) {
    console.error("[organizationParser] investments 列表解析失败:", e);
  }

  return parsedData;
}

module.exports = { parseOrganizationPage };

