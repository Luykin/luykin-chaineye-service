const { JSDOM } = require("jsdom");
const typemapManager = require("../typemap/manager");

function parseItemFromRootdataHref({ href, name, logo }) {
  const absoluteUrl = href
    ? new URL(href, "https://www.rootdata.com").toString()
    : "";

  let item_id = null;
  try {
    const match = absoluteUrl.match(/[?&]k=([^&]+)/);
    if (match) {
      const urlDecoded = decodeURIComponent(match[1]);
      item_id = Buffer.from(urlDecoded, "base64").toString("utf-8");
    }
  } catch (e) {
    item_id = null;
  }

  let item_type = null;
  try {
    if (/\/Investors\/detail\//.test(absoluteUrl)) item_type = 2;
    else if (/\/Projects\/detail\//.test(absoluteUrl)) item_type = 1;
    else if (/\/People\/detail\//.test(absoluteUrl)) item_type = 3;
    else if (/\/member\//.test(absoluteUrl)) item_type = 3;
  } catch (e) {
    item_type = null;
  }

  let item_name = name;
  try {
    if (absoluteUrl) {
      const u = new URL(absoluteUrl);
      const parts = (u.pathname || "").split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) {
        item_name = decodeURIComponent(last).trim();
      }
    }
  } catch (e) {
    item_name = name;
  }

  return {
    item_id,
    item_type,
    item_name,
    logo,
    url: absoluteUrl,
  };
}

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
    investorRounds: [],
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
        parsedData.investorCards.push(
          parseItemFromRootdataHref({ href, name, logo })
        );
      } catch (e) {
        console.error("[organizationParser] investorCards 单卡解析失败:", e);
      }
    }
  } catch (e) {
    console.error("[organizationParser] investorCards 列表解析失败:", e);
  }

  try {
    const roundRows = dom.window.document.querySelectorAll(
      "main .investor .watermusk_table tbody tr"
    );
    for (const row of roundRows) {
      try {
        const dateText = (row.querySelector("td:nth-child(1) span")?.textContent || "").trim();
        const amountText = (row.querySelector("td:nth-child(2)")?.textContent || "").trim();

        const lps = [];
        const lpLinks = row.querySelectorAll(
          "td:nth-child(3) a.animation_underline"
        );
        for (const link of lpLinks) {
          try {
            const href = link.getAttribute("href") || "";
            const name = (link.textContent || "").trim();
            lps.push(parseItemFromRootdataHref({ href, name, logo: "" }));
          } catch (e) {
            console.error("[organizationParser] investorRounds LP 解析失败:", e);
          }
        }

        parsedData.investorRounds.push({
          date: dateText || null,
          amount_text: amountText || null,
          lps,
        });
      } catch (e) {
        console.error("[organizationParser] investorRounds 单行解析失败:", e);
      }
    }
  } catch (e) {
    console.error("[organizationParser] investorRounds 表格解析失败:", e);
  }

  try {
    const investItems =
      nuxtData?.data?.[0]?.investRecord?.items ||
      nuxtData?.data?.[0]?.investRecordList?.items ||
      [];
    parsedData.investments = investItems
      .map((item) => {
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
      })
      .filter(Boolean);
  } catch (e) {
    console.error("[organizationParser] investments 列表解析失败:", e);
  }

  return parsedData;
}

module.exports = { parseOrganizationPage };
