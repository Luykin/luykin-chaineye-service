const { fetchMainDomAndNuxtData } = require("./browser-fetcher");
const { parseOrganizationPage } = require("./parsers/organizationParser");
const { parsePersonPage } = require("./parsers/personParser");
const {
  updatePersonAndInvestments,
  updateOrganization,
} = require("./db-updater");

/**
 * 爬取项目（Project）页面。
 * @param {string} url 要爬取的完整 URL。
 */
async function scrapeProject(url) {
  console.log(`[Project] 开始爬取 URL: ${url}`);
  // TODO: 实现项目页面的 HTML 获取、解析和数据存储逻辑
}

/**
 * 爬取组织（Organization/VC）页面。
 * @param {string} url 要爬取的完整 URL。
 */
async function scrapeOrganization(url) {
  console.log(`[Organization] 开始爬取 URL: ${url}`);
  try {
    const { mainDom, nuxtDataJson } = await fetchMainDomAndNuxtData(url);
    if (!mainDom || !nuxtDataJson) {
      console.error(`未能获取 ${url} 的 mainDom 或 __NUXT__ 数据。`);
      return;
    }

    const orgData = parseOrganizationPage({ mainDom, nuxtDataJson, url });
    if (orgData) {
      console.log(`成功解析组织数据。`);
      // await updateOrganization(orgData); // 调用 DB 更新器
    } else {
      console.error(`未能解析组织页面数据。`);
    }
  } catch (error) {
    console.error(`爬取组织页面 ${url} 时出错:`, error);
  }
}

/**
 * 爬取个人（Person）页面。
 * @param {string} url 要爬取的完整 URL。
 */
async function scrapePerson(url) {
  console.log(`[Person] 开始爬取 URL: ${url}`);
  try {
    const { mainDom, nuxtDataJson } = await fetchMainDomAndNuxtData(url);
    if (!mainDom || !nuxtDataJson) {
      console.error(`未能获取 ${url} 的 mainDom 或 __NUXT__ 数据。`);
      return;
    }

    const personData = parsePersonPage({ mainDom, nuxtDataJson, url });
    if (!personData) {
      console.error(`未能解析个人页面数据。`);
      return;
    }

    console.log(`成功解析个人数据。`);
    // await updatePersonAndInvestments(personData); // 调用 DB 更新器
  } catch (error) {
    console.error(`爬取个人页面 ${url} 时出错:`, error);
  }
}

module.exports = {
  scrapeProject,
  scrapeOrganization,
  scrapePerson,
};
