const { fetchMainDomAndNuxtData } = require("./browser-fetcher");
const { parseOrganizationPage } = require("./parsers/organizationParser");
const { parsePersonPage } = require("./parsers/personParser");
const { parseProjectPage } = require("./parsers/projectParser");
let updatePersonAndInvestments;
let updateOrganization;
let updateProject;

let rootdataProDb;
function ensureRootdataProDbLoaded() {
  if (rootdataProDb) return;
  try {
    rootdataProDb = require("../models");
  } catch (e) {
    rootdataProDb = null;
  }
}

function ensureDbUpdatersLoaded() {
  if (updateProject && updateOrganization && updatePersonAndInvestments) return;
  const updaters = require("./db-updater");
  updatePersonAndInvestments = updaters.updatePersonAndInvestments;
  updateOrganization = updaters.updateOrganization;
  updateProject = updaters.updateProject;
}

function parseEntityIdFromUrlByK(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const k = u.searchParams.get("k");
    if (!k) return null;

    const urlDecoded = decodeURIComponent(k);
    const decoded = Buffer.from(urlDecoded, "base64").toString("utf-8");
    const num = Number(decoded);
    if (Number.isFinite(num)) return num;

    const rawNum = Number(k);
    return Number.isFinite(rawNum) ? rawNum : null;
  } catch {
    return null;
  }
}

async function writeCrawlLog({ entity_id, entity_type, url, status, error_message, new_data_summary }) {
  try {
    ensureRootdataProDbLoaded();
    if (!rootdataProDb?.CrawlLog) return;

    await rootdataProDb.CrawlLog.create({
      entity_id: entity_id ?? -1,
      entity_type: entity_type || "Unknown",
      url,
      status,
      error_message: error_message || null,
      new_data_summary: new_data_summary || null,
      crawled_at: new Date(),
    });
  } catch (e) {
    console.warn("[CrawlLog] 写入失败:", e?.message || e);
  }
}

/**
 * 爬取项目（Project）页面。
 * @param {string} url 要爬取的完整 URL。
 */
async function scrapeProject(url, options = {}) {
  console.log(`[Project] 开始爬取 URL: ${url}`);
  if (!url || !url.includes("/Projects")) {
    const msg = `无效的项目 URL: ${url}`;
    console.error(msg);
    await writeCrawlLog({
      entity_id: parseEntityIdFromUrlByK(url),
      entity_type: "Project",
      url,
      status: "failure",
      error_message: msg,
    });
    return;
  }

  let projectData = null;
  try {
    const { mainDom, nuxtDataJson } = await fetchMainDomAndNuxtData(url);
    if (!mainDom || !nuxtDataJson) {
      const msg = `未能获取 ${url} 的 mainDom 或 __NUXT__ 数据。`;
      console.error(msg);
      await writeCrawlLog({
        entity_id: parseEntityIdFromUrlByK(url),
        entity_type: "Project",
        url,
        status: "failure",
        error_message: msg,
      });
      return;
    }

    projectData = parseProjectPage({ mainDom, nuxtDataJson, url });
    if (projectData) {
      console.log(`成功解析项目数据。`, projectData);
      if (options.updateDb !== false) {
        ensureDbUpdatersLoaded();
        await updateProject(projectData); // 调用 DB 更新器
      }

      await writeCrawlLog({
        entity_id: projectData.project_id ?? parseEntityIdFromUrlByK(url),
        entity_type: "Project",
        url,
        status: "success",
        error_message: null,
        new_data_summary: null,
      });
    } else {
      const msg = `未能解析项目页面数据。`;
      console.error(msg);
      await writeCrawlLog({
        entity_id: parseEntityIdFromUrlByK(url),
        entity_type: "Project",
        url,
        status: "failure",
        error_message: msg,
      });
    }
  } catch (error) {
    console.error(`爬取项目页面 ${url} 时出错:`, error);
    await writeCrawlLog({
      entity_id: projectData?.project_id ?? parseEntityIdFromUrlByK(url),
      entity_type: "Project",
      url,
      status: "failure",
      error_message: error?.message || String(error),
    });
  }
}

/**
 * 爬取组织（Organization/VC）页面。
 * @param {string} url 要爬取的完整 URL。
 */
async function scrapeOrganization(url, options = {}) {
  console.log(`[Organization] 开始爬取 URL: ${url}`);
  if (!url || !url.includes("/Investors")) {
    const msg = `无效的组织 URL: ${url}`;
    console.error(msg);
    await writeCrawlLog({
      entity_id: parseEntityIdFromUrlByK(url),
      entity_type: "Organization",
      url,
      status: "failure",
      error_message: msg,
    });
    return;
  }

  let orgData = null;
  try {
    const { mainDom, nuxtDataJson } = await fetchMainDomAndNuxtData(url);
    if (!mainDom || !nuxtDataJson) {
      const msg = `未能获取 ${url} 的 mainDom 或 __NUXT__ 数据。`;
      console.error(msg);
      await writeCrawlLog({
        entity_id: parseEntityIdFromUrlByK(url),
        entity_type: "Organization",
        url,
        status: "failure",
        error_message: msg,
      });
      return;
    }

    orgData = parseOrganizationPage({ mainDom, nuxtDataJson, url });
    if (orgData) {
      console.log(`成功解析组织数据。`, orgData);
      if (options.updateDb !== false) {
        ensureDbUpdatersLoaded();
        await updateOrganization(orgData); // 调用 DB 更新器
      }

      await writeCrawlLog({
        entity_id: orgData.org_id ?? parseEntityIdFromUrlByK(url),
        entity_type: "Organization",
        url,
        status: "success",
        error_message: null,
        new_data_summary: null,
      });
    } else {
      const msg = `未能解析组织页面数据。`;
      console.error(msg);
      await writeCrawlLog({
        entity_id: parseEntityIdFromUrlByK(url),
        entity_type: "Organization",
        url,
        status: "failure",
        error_message: msg,
      });
    }
  } catch (error) {
    console.error(`爬取组织页面 ${url} 时出错:`, error);
    await writeCrawlLog({
      entity_id: orgData?.org_id ?? parseEntityIdFromUrlByK(url),
      entity_type: "Organization",
      url,
      status: "failure",
      error_message: error?.message || String(error),
    });
  }
}

/**
 * 爬取个人（Person）页面。
 * @param {string} url 要爬取的完整 URL。
 */
async function scrapePerson(url, options = {}) {
  console.log(`[Person] 开始爬取 URL: ${url}`);
  if (!url || !url.includes("/member")) {
    const msg = `无效的个人 URL: ${url}`;
    console.error(msg);
    await writeCrawlLog({
      entity_id: parseEntityIdFromUrlByK(url),
      entity_type: "Person",
      url,
      status: "failure",
      error_message: msg,
    });
    return;
  }

  let personData = null;
  try {
    const { mainDom, nuxtDataJson } = await fetchMainDomAndNuxtData(url);
    if (!mainDom || !nuxtDataJson) {
      const msg = `未能获取 ${url} 的 mainDom 或 __NUXT__ 数据。`;
      console.error(msg);
      await writeCrawlLog({
        entity_id: parseEntityIdFromUrlByK(url),
        entity_type: "Person",
        url,
        status: "failure",
        error_message: msg,
      });
      return;
    }

    personData = parsePersonPage({ mainDom, nuxtDataJson, url });
    if (!personData) {
      const msg = `未能解析个人页面数据。`;
      console.error(msg);
      await writeCrawlLog({
        entity_id: parseEntityIdFromUrlByK(url),
        entity_type: "Person",
        url,
        status: "failure",
        error_message: msg,
      });
      return;
    }

    console.log(`成功解析个人数据。`, personData);
    if (options.updateDb !== false) {
      ensureDbUpdatersLoaded();
      await updatePersonAndInvestments(personData); // 调用 DB 更新器
    }

    await writeCrawlLog({
      entity_id: personData.people_id ?? parseEntityIdFromUrlByK(url),
      entity_type: "Person",
      url,
      status: "success",
      error_message: null,
      new_data_summary: null,
    });
  } catch (error) {
    console.error(`爬取个人页面 ${url} 时出错:`, error);
    await writeCrawlLog({
      entity_id: personData?.people_id ?? parseEntityIdFromUrlByK(url),
      entity_type: "Person",
      url,
      status: "failure",
      error_message: error?.message || String(error),
    });
  }
}

module.exports = {
  scrapeProject,
  scrapeOrganization,
  scrapePerson,
};
