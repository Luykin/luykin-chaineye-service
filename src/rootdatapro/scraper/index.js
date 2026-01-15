const { fetchHtml } = require("../../utils/fetcher");
const { parseOrganizationPage } = require("./parsers/organizationParser");
const { parsePersonPage } = require("./parsers/personParser");
const {
  updatePersonAndInvestments,
  updateOrganization,
} = require("./db-updater");

/**
 * 爬取项目（Project）页面。
 * @param {string} url 要爬取的完整 URL。
 * @param {object} item 从 typemap JSON 文件中读取的条目对象。
 */
async function scrapeProject(url, item) {
  console.log(`[Project] 开始爬取 URL: ${url}`);
  // TODO: 实现项目页面的 HTML 获取、解析和数据存储逻辑
}

/**
 * 爬取组织（Organization/VC）页面。
 * @param {string} url 要爬取的完整 URL。
 * @param {object} item 从 typemap JSON 文件中读取的条目对象。
 */
async function scrapeOrganization(url, item) {
  console.log(`[Organization] 开始爬取 URL: ${url}`);
  try {
    const htmlContent = await fetchHtml(url);
    if (htmlContent) {
      const orgData = parseOrganizationPage(htmlContent, url);
      if (orgData) {
        console.log(`成功解析了 ${item.name} 的数据。`);
        await updateOrganization(orgData); // 调用 DB 更新器
      } else {
        console.error(`未能解析 ${item.name} 的页面数据。`);
      }
    } else {
      console.error(`未能获取 ${url} 的 HTML 内容。`);
    }
  } catch (error) {
    console.error(`爬取组织页面 ${url} 时出错:`, error);
  }
}

/**
 * 爬取个人（Person）页面。
 * @param {string} url 要爬取的完整 URL。
 * @param {object} item 从 typemap JSON 文件中读取的条目对象。
 */
async function scrapePerson(url, item) {
  console.log(`[Person] 开始爬取 URL: ${url}`);
  try {
    const htmlContent = await fetchHtml(url);
    if (!htmlContent) {
      console.error(`未能获取 ${url} 的 HTML 内容。`);
      return;
    }

    const personData = parsePersonPage(htmlContent);
    if (!personData) {
      console.error(`未能解析 ${item.name} 的页面数据。`);
      return;
    }

    console.log(`成功解析了 ${item.name} 的数据。`);
    await updatePersonAndInvestments(personData); // 调用 DB 更新器
  } catch (error) {
    console.error(`爬取个人页面 ${url} 时出错:`, error);
  }
}

module.exports = {
  scrapeProject,
  scrapeOrganization,
  scrapePerson,
};
