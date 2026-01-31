const typemapManager = require("../typemap/manager");
const { JSDOM } = require("jsdom");

/**
 * 解析个人页面的内容以提取数据。
 * @param {{ mainDom: string|null, nuxtDataJson: string|null, url: string }} input
 * @returns {object|null} 包含提取数据的对象，如果解析失败则返回 null。
 */
function parsePersonPage({ mainDom, nuxtDataJson, url }) {
  try {
    let nuxtData = null;
    try {
      nuxtData = nuxtDataJson ? JSON.parse(nuxtDataJson) : null;
    } catch (e) {
      nuxtData = null;
    }

    if (!nuxtData) {
      console.error("在 __NUXT__ 数据中找不到个人详细信息。");
      return null;
    }

    const personDetail = nuxtData?.data?.[0]?.detail;
    if (!personDetail) {
      console.error("在 __NUXT__ 数据中找不到个人详细信息。");
      return null;
    }

    // 从 investRecordList.items 提取详细的投资记录
    // 确定在person里面 对外投资就是取investRecordList
    const investRecordList = nuxtData?.data?.[0]?.investRecordList?.items || [];
    const investments = investRecordList.map((item) => ({
      item_id: item.itemId,
      item_type: typemapManager.getType(item.itemId) || 1, // 默认为 1 (Project) 作为回退
      item_name: item.itemName?.en_value,
      logo: item.logoImg,
      description: item.intd?.en_value || "",
      round: item.roundsName?.en_value,
      amount: item.facAmountUs,
      date: item.facDate ? new Date(item.facDate) : null,
      isLead: item.isLt === 1,
    }));

    const parsedData = {
      people_id: personDetail.id,
      introduce: personDetail.intd?.en_value || "",
      head_img: personDetail.headImg,
      one_liner: personDetail.briefIntd?.en_value || "",
      X: personDetail.twitterUrl,
      people_name: personDetail.name?.en_value,
      linkedin: personDetail.lyingUrl,
      followers: personDetail.followersCount,
      following: personDetail.friendsCount,
      heat: "-",
      heat_rank: "-",
      influence: "-",
      influence_rank: "-",
      investments,
    };

    if (mainDom) {
      try {
        const dom = new JSDOM(mainDom);
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
            parsedData.followers = (value);
          } else if (label === "Following") {
            parsedData.following = (value);
          }
        }
      } catch (e) {
        console.error("[personParser] .analysis_card 解析失败:", e);
      }
    }

    return parsedData;
  } catch (error) {
    console.error("解析个人页面时出错:", error);
    return null;
  }
}

module.exports = { parsePersonPage };
