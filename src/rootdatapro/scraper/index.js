const { fetchMainDomAndNuxtData } = require("./browser-fetcher");
const { parseOrganizationPage } = require("./parsers/organizationParser");
const { parsePersonPage } = require("./parsers/personParser");
const { parseProjectPage } = require("./parsers/projectParser");
let updatePersonAndInvestments;
let updateOrganization;
let updateProject;

function ensureDbUpdatersLoaded() {
  if (updateProject && updateOrganization && updatePersonAndInvestments) return;
  const updaters = require("./db-updater");
  updatePersonAndInvestments = updaters.updatePersonAndInvestments;
  updateOrganization = updaters.updateOrganization;
  updateProject = updaters.updateProject;
}

/**
 * 爬取项目（Project）页面。
 * @param {string} url 要爬取的完整 URL。
 */
async function scrapeProject(url, options = {}) {
  console.log(`[Project] 开始爬取 URL: ${url}`);
  if(!url || !url.includes("/Projects")) {
    console.error(`无效的项目 URL: ${url}`);
    return;
  }
  try {
    const { mainDom, nuxtDataJson } = await fetchMainDomAndNuxtData(url);
    if (!mainDom || !nuxtDataJson) {
      console.error(`未能获取 ${url} 的 mainDom 或 __NUXT__ 数据。`);
      return;
    }

    const projectData = parseProjectPage({ mainDom, nuxtDataJson, url });
    if (projectData) {
      console.log(`成功解析项目数据。`, projectData);
      if (options.updateDb !== false) {
        ensureDbUpdatersLoaded();
        await updateProject(projectData); // 调用 DB 更新器
      }
    } else {
      console.error(`未能解析项目页面数据。`);
    }
  } catch (error) {
    console.error(`爬取项目页面 ${url} 时出错:`, error);
  }
}

/**
 * 爬取组织（Organization/VC）页面。
 * @param {string} url 要爬取的完整 URL。
 */
async function scrapeOrganization(url, options = {}) {
  console.log(`[Organization] 开始爬取 URL: ${url}`);
  if(!url || !url.includes("/Investors")) {
    console.error(`无效的组织 URL: ${url}`);
    return;
  }
  try {
    const { mainDom, nuxtDataJson } = await fetchMainDomAndNuxtData(url);
    if (!mainDom || !nuxtDataJson) {
      console.error(`未能获取 ${url} 的 mainDom 或 __NUXT__ 数据。`);
      return;
    }

    const orgData = parseOrganizationPage({ mainDom, nuxtDataJson, url });
    if (orgData) {
      console.log(`成功解析组织数据。`, orgData);
      if (options.updateDb !== false) {
        ensureDbUpdatersLoaded();
        await updateOrganization(orgData); // 调用 DB 更新器
      }
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
async function scrapePerson(url, options = {}) {
  console.log(`[Person] 开始爬取 URL: ${url}`);
  if(!url || !url.includes("/member")) {
    console.error(`无效的个人 URL: ${url}`);
    return;
  }
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

    console.log(`成功解析个人数据。`, personData);
    if (options.updateDb !== false) {
      ensureDbUpdatersLoaded();
      await updatePersonAndInvestments(personData); // 调用 DB 更新器
    }
  } catch (error) {
    console.error(`爬取个人页面 ${url} 时出错:`, error);
  }
}

module.exports = {
  scrapeProject,
  scrapeOrganization,
  scrapePerson,
};
