const { JSDOM } = require("jsdom");

/**
 * 解析组织页面的内容以提取数据。
 * @param {{ mainDom: string|null, nuxtDataJson: string|null, url: string }} input
 * @returns {object|null} 包含提取数据的对象，如果解析失败则返回 null。
 */
function parseOrganizationPage({ mainDom, nuxtDataJson, url }) {
  try {
    const dom = new JSDOM(mainDom || "");
    let nuxtData = null;
    try {
      nuxtData = nuxtDataJson ? JSON.parse(nuxtDataJson) : null;
    } catch (e) {
      nuxtData = null;
    }

    if (!nuxtData) {
      console.error("在 __NUXT__ 数据中找不到组织详细信息。");
      return null;
    }

    const orgDetail = nuxtData?.data?.[0]?.detail;
    if (!orgDetail) {
      console.error("在 __NUXT__ 数据中找不到组织详细信息。");
      return null;
    }

    // 从 jsdom 创建的 DOM 中直接解析成立日期
    let establishment_date = null;
    const sideBarItems = dom.window.document.querySelectorAll(
      "main .side_bar_info .item"
    );
    for (const item of sideBarItems) {
      const labelElement = item.querySelector(".label");
      if (labelElement && labelElement.textContent.trim() === "Founded:") {
        const valueElement =
          item.querySelector(".value") || item.querySelector(".info_text");
        if (valueElement) {
          establishment_date = valueElement.textContent.trim();
          break; // 找到后即可退出循环
        }
      }
    }

    const social_media = {
      website: orgDetail.blogUrl,
      twitter: orgDetail.twitterUrl,
      linkedin: orgDetail.lyingUrl,
    };

    const parsedData = {
      org_id: orgDetail.id,
      org_name: orgDetail.name?.en_value,
      logo: orgDetail.logoImg,
      establishment_date: establishment_date,
      description: orgDetail.intd?.en_value || "",
      active: orgDetail.status === 1, // 假设 status 为 1 表示运营中
      social_media: social_media,
      rootdataurl: url,
      followers: orgDetail.followersCount,
      following: orgDetail.friendsCount,
      heat: "-",
      heat_rank: "-",
      influence: "-",
      influence_rank: "-",
    };

    return parsedData;
  } catch (error) {
    console.error("解析组织页面时出错:", error);
    return null;
  }
}

module.exports = { parseOrganizationPage };
