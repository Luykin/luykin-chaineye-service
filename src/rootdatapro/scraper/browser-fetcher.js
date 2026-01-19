const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");

puppeteer.use(StealthPlugin());

const DEFAULT_PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-setuid-sandbox",
  "--disable-breakpad",
  "--disable-component-extensions-with-background-pages",
  "--disable-extensions",
  "--disable-sync",
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
  "--no-default-browser-check",
  "--no-pings",
  "--disable-popup-blocking",
  "--disable-notifications",
  "--disable-translate",
];

const PROXY_POOL = [
  "163.5.88.220:6324:user81794:8ipjmd",
  "108.165.167.7:6324:user81794:8ipjmd",
  "108.165.167.11:6324:user81794:8ipjmd",
  "45.135.251.198:6324:user81794:8ipjmd",
  "45.135.251.37:6324:user81794:8ipjmd",
];

function parseProxyString(proxyStr) {
  if (!proxyStr || typeof proxyStr !== "string") return null;
  const parts = proxyStr.split(":");
  if (parts.length < 2) return null;

  const host = parts[0];
  const port = parts[1];
  const username = parts[2];
  const password = parts[3];
  if (!host || !port) return null;

  return {
    host,
    port,
    username,
    password,
    server: `http://${host}:${port}`,
  };
}

function pickRandomProxy(proxyPool) {
  if (!Array.isArray(proxyPool) || proxyPool.length === 0) return null;
  const idx = Math.floor(Math.random() * proxyPool.length);
  return proxyPool[idx];
}

async function setupRequestInterception(page) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const resourceType = req.resourceType();
    const url = req.url();

    if (resourceType === "image") {
      req.respond({
        status: 200,
        contentType: "image/gif",
        body: Buffer.from(
          "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          "base64"
        ),
      });
    } else if (["stylesheet", "font"].includes(resourceType)) {
      req.respond({ status: 200, contentType: "text/plain", body: "" });
    } else if (resourceType === "script" && !url.includes("www.rootdata.com")) {
      req.respond({
        status: 200,
        contentType: "application/javascript",
        body: "",
      });
    } else {
      req.continue();
    }
  });
}

async function waitUntilReady(page) {
  const selector = "main .container .base_info";
  const timeoutMs = 60_000;

  try {
    await Promise.race([
      page.waitForSelector(selector, { timeout: timeoutMs }),
      page.waitForNetworkIdle({ idleTime: 500, timeout: timeoutMs }),
    ]);
  } catch (e) {
    console.warn(
      `⚠️ 等待元素/网络空闲超过 ${timeoutMs}ms，刷新页面后重试一次...`
    );
    await page.reload({ waitUntil: "networkidle2" });
    await Promise.race([
      page.waitForSelector(selector, { timeout: timeoutMs }),
      page.waitForNetworkIdle({ idleTime: 500, timeout: timeoutMs }),
    ]);
  }
}

/**
 * 打开页面并返回 mainDom 与 nuxtData。
 * 说明：为了让调用方的解析器自己处理，这里只保证“打开页面 + 拿到数据”高可用。
 * @param {string} url
 * @param {object} [options]
 * @param {boolean|string} [options.headless="new"]
 * @param {string} [options.userDataDir]
 * @param {string[]} [options.args]
 * @param {boolean} [options.useProxy=true] 是否启用代理池
 * @param {string[]} [options.proxyPool] 自定义代理池（ip:port:user:pass）
 * @param {string} [options.proxy] 指定固定代理（ip:port:user:pass）
 * @returns {Promise<{ mainDom: string|null, nuxtDataJson: string|null }>} 
 */
async function fetchMainDomAndNuxtData(url, options = {}) {
  const {
    headless = "new",
    userDataDir = path.join(__dirname, "./puppeteer_cache"),
    userDataDirSuffix,
    args = DEFAULT_PUPPETEER_ARGS,
    useProxy = true,
    proxyPool = PROXY_POOL,
    proxy,
  } = options;

  let browser = null;

  const selectedProxyStr = useProxy ? (proxy || pickRandomProxy(proxyPool)) : null;
  const selectedProxy = parseProxyString(selectedProxyStr);

  const launchArgs = [...args];
  if (selectedProxy?.server) {
    launchArgs.push(`--proxy-server=${selectedProxy.server}`);
  }

  const effectiveUserDataDir = userDataDirSuffix
    ? path.join(userDataDir, String(userDataDirSuffix))
    : userDataDir;

  try {
    browser = await puppeteer.launch({
      headless,
      args: launchArgs,
      userDataDir: effectiveUserDataDir,
    });

    const page = await browser.newPage();

    if (selectedProxy?.username) {
      await page.authenticate({
        username: selectedProxy.username,
        password: selectedProxy.password || "",
      });
      console.log(`authenticated with proxy: ${selectedProxy.server}`);
    }

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
    );

    await setupRequestInterception(page);
    await page.setViewport({ width: 1920, height: 1080 });

    await page.goto(url, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1000));
    await waitUntilReady(page);

    const data = await page.evaluate(() => {
      const mainElement = document.querySelector("main");
      const nuxtData = window.__NUXT__;
      let nuxtDataJson = null;
      try {
        nuxtDataJson = nuxtData ? JSON.stringify(nuxtData) : null;
      } catch (_) {
        nuxtDataJson = null;
      }
      return {
        mainDom: mainElement ? mainElement.outerHTML : null,
        nuxtDataJson,
      };
    });

    await browser.close();
    browser = null;

    return data;
  } catch (error) {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }
    console.error(`fetchMainDomAndNuxtData error:`, error);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }
  }
}

module.exports = { fetchMainDomAndNuxtData };
