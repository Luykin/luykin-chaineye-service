const jsdom = require("jsdom");
const { JSDOM } = jsdom;

/**
 * 使用 jsdom 从 HTML 内容中提取 __NUXT__ 数据。
 * @param {string} htmlContent 页面的 HTML 内容。
 * @returns {object|null} __NUXT__ 数据对象，如果找不到则返回 null。
 */
function getNuxtData(htmlContent) {
  try {
    const dom = new JSDOM(htmlContent, {
      runScripts: "dangerously", // 需要执行页面中的 <script> 标签
      pretendToBeVisual: true,
    });

    // JSDOM 会执行脚本并填充 window 对象
    const nuxtData = dom.window.__NUXT__;
    if (!nuxtData) {
      console.error("在虚拟 DOM 的 window 对象中找不到 __NUXT__ 数据。");
      return null;
    }
    return { dom, nuxtData };
  } catch (error) {
    console.error("使用 jsdom 解析 HTML 时出错:", error);
    return null;
  }
}

module.exports = { getNuxtData };
