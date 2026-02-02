const { JSDOM } = require("jsdom");

/**
 * 从 URL 的 k 参数中解析出实体 ID（与其他地方保持一致的逻辑）
 * @param {string} rawUrl
 * @returns {number|null}
 */
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

/**
 * 解析 Fundraising 页面 HTML，直接返回需要爬取的任务列表
 * @param {string} html - 页面 HTML 内容
 * @returns {Array<{id: string, type: number}>} 任务列表（目前全部为 Project，type = 1）
 */
function parseFundraisingList(html) {
  if (!html) {
    return [];
  }

  const dom = new JSDOM(html);
  const document = dom.window.document;

  const tasks = [];
  const seenIds = new Set();
  const tableBody = document.querySelector(".main_container table tbody");

  if (!tableBody) {
    console.warn("[FundraisingParser] Could not find the table body element.");
    return [];
  }

  const rows = tableBody.querySelectorAll("tr");
  rows.forEach((row) => {
    // 每一行里找第一个指向 Project 详情页的链接
    const projectLink = row.querySelector("a[href*='/Projects/detail/']");
    if (!projectLink) return;

    const href = projectLink.getAttribute("href");
    if (!href) return;

    try {
      // 将相对路径转换为完整 URL，方便使用 URL API 解析 k 参数
      const fullUrl = new URL(href, "https://www.rootdata.com").toString();
      const id = parseEntityIdFromUrlByK(fullUrl);
      if (!id) return;

      const idStr = String(id);
      if (seenIds.has(idStr)) return;

      seenIds.add(idStr);
      tasks.push({ id: idStr, type: 1 }); // 目前 Fundraising 只涉及 Project
    } catch (e) {
      console.warn("[FundraisingParser] 解析 Fundraising 链接失败:", href, e?.message || e);
    }
  });

  console.log(`[FundraisingParser] 生成 ${tasks.length} 个 Fundraising 任务。`);
  return tasks;
}

module.exports = {
  parseFundraisingList,
};
