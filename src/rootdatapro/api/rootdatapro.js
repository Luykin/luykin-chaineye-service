const express = require("express");
const db = require("../models");
const apiKeyRoutes = require("./apikey");

const router = express.Router();

router.use(apiKeyRoutes);

function isValidRootdataUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }

  if (u.hostname !== "www.rootdata.com" && u.hostname !== "rootdata.com") {
    return false;
  }

  // 支持：Projects / Investors / member
  if (u.pathname.includes("/Projects/detail/")) return true;
  if (u.pathname.includes("/Investors/detail/")) return true;
  if (u.pathname.includes("/member/")) return true;

  return false;
}

function detectEntityTypeFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.pathname.includes("/Projects/detail/")) return "Project";
    if (u.pathname.includes("/Investors/detail/")) return "Organization";
    if (u.pathname.includes("/member/")) return "Person";
    return null;
  } catch {
    return null;
  }
}

function parseIdFromUrlByK(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const k = u.searchParams.get("k");
    if (!k) return null;

    // Project / Person: base64
    const urlDecoded = decodeURIComponent(k);
    const decoded = Buffer.from(urlDecoded, "base64").toString("utf-8");
    const num = Number(decoded);
    if (Number.isFinite(num)) return num;

    // Org: 有些情况下 k 就是数字字符串（base64 解不出就直接用）
    const rawNum = Number(k);
    return Number.isFinite(rawNum) ? rawNum : null;
  } catch {
    return null;
  }
}

async function scrapeAndFetchSummary({ url, entityType }) {
  const { scrapeProject, scrapeOrganization, scrapePerson } = require("../scraper/index");
  console.log(`[rootdatapro] 开始抓取 ${entityType}: ${url}`);
  const timeoutMs = 3 * 60 * 1000;

  if (entityType === "Project") {
    await Promise.race([
      scrapeProject(url, { updateDb: true }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SCRAPE_TIMEOUT")), timeoutMs)
      ),
    ]);
    console.log(`[rootdatapro] 抓取完成: ${url}`);

    const id = parseIdFromUrlByK(url);
    console.log(`[rootdatapro] 解析到 ID: ${id}`);
    const row = id ? await db.Project.findByPk(id) : null;
    console.log(`[rootdatapro] DB 查询结果: ${row ? "找到" : "未找到"}`);
    return {
      entityType,
      entityId: id,
      entity: row
        ? { project_id: row.project_id, project_name: row.project_name }
        : null,
    };
  }

  if (entityType === "Organization") {
    await Promise.race([
      scrapeOrganization(url, { updateDb: true }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SCRAPE_TIMEOUT")), timeoutMs)
      ),
    ]);
    console.log(`[rootdatapro] 抓取完成: ${url}`);

    const id = parseIdFromUrlByK(url);
    console.log(`[rootdatapro] 解析到 ID: ${id}`);
    const row = id ? await db.Organization.findByPk(id) : null;
    console.log(`[rootdatapro] DB 查询结果: ${row ? "找到" : "未找到"}`);
    return {
      entityType,
      entityId: id,
      entity: row ? { org_id: row.org_id, org_name: row.org_name } : null,
    };
  }

  if (entityType === "Person") {
    await Promise.race([
      scrapePerson(url, { updateDb: true }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SCRAPE_TIMEOUT")), timeoutMs)
      ),
    ]);
    console.log(`[rootdatapro] 抓取完成: ${url}`);

    const id = parseIdFromUrlByK(url);
    console.log(`[rootdatapro] 解析到 ID: ${id}`);
    const row = id ? await db.Person.findByPk(id) : null;
    console.log(`[rootdatapro] DB 查询结果: ${row ? "找到" : "未找到"}`);
    return {
      entityType,
      entityId: id,
      entity: row
        ? { people_id: row.people_id, people_name: row.people_name }
        : null,
    };
  }

  return { entityType: null, entityId: null, entity: null };
}

// 通用抓取入口
router.post("/scrape", async (req, res) => {
  console.log(`[rootdatapro] 收到抓取请求:`, req.body);
  try {
    const url = req.body?.url;

    if (!isValidRootdataUrl(url)) {
      console.log(`[rootdatapro] URL 校验失败: ${url}`);
      return res.status(400).json({
        success: false,
        error: "INVALID_URL",
        message: "url 必须是 rootdata.com 的 Projects/detail、Investors/detail 或 member 链接",
      });
    }

    const entityType = detectEntityTypeFromUrl(url);
    console.log(`[rootdatapro] 识别实体类型: ${entityType}`);
    if (!entityType) {
      return res.status(400).json({
        success: false,
        error: "UNSUPPORTED_URL",
        message: "不支持的 RootData 链接类型",
      });
    }

    const summary = await scrapeAndFetchSummary({ url, entityType });
    console.log(`[rootdatapro] 抓取与查询摘要完成`, summary);

    return res.json({
      success: true,
      url,
      entityType: summary.entityType,
      entityId: summary.entityId,
      entity: summary.entity,
    });
  } catch (err) {
    console.error(`[rootdatapro] 抓取请求失败: ${err.message}`);
    const msg = err?.message || String(err);
    const code = msg === "SCRAPE_TIMEOUT" ? 504 : 500;
    return res.status(code).json({
      success: false,
      error: msg,
    });
  }
});

// --- Crawl Task Management API ---

const taskManager = require("../scraper/taskManager");

router.post("/crawl/start", async (req, res) => {
  console.log("[rootdatapro] 收到启动爬虫任务请求");
  const result = await taskManager.start();
  if (result && result.success === false) {
    return res.status(409).json({ success: false, error: result.error });
  }
  return res.json({ success: true, message: "Crawl task started." });
});

router.post("/crawl/pause", async (req, res) => {
  console.log("[rootdatapro] 收到暂停爬虫任务请求");
  const result = await taskManager.pause();
  if (result && result.success === false) {
    return res.status(409).json({ success: false, error: result.error });
  }
  return res.json({ success: true, message: "Crawl task paused." });
});

router.get("/crawl/status", async (req, res) => {
  try {
    console.log("[rootdatapro] /crawl/status: Fetching task manager status...");
    const status = await taskManager.getStatus();
    
    console.log("[rootdatapro] /crawl/status: Fetching failed URL counts...");
    const startTime = Date.now();
    const failedUrlsCounts = await db.CrawlLog.countFailedUrls();
    const duration = Date.now() - startTime;
    console.log(`[rootdatapro] /crawl/status: Fetched failed URL counts in ${duration}ms.`);
  
    status.failedUrlsCounts = failedUrlsCounts;
    res.json({ success: true, data: status });
  } catch (err) {
    console.error(`[rootdatapro] /crawl/status: Error fetching status: ${err.message}`);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

router.post("/crawl/reset", async (req, res) => {
    console.log("[rootdatapro] 收到重置爬虫任务请求");
    const result = await taskManager.initialize();
    if (result && result.success === false) {
      return res.status(409).json({ success: false, error: result.error });
    }
    return res.json({ success: true, message: "Crawl task reset and re-initialized." });
});

// 每日维护任务：立即执行
router.post("/crawl/maintenance/run_now", async (req, res) => {
  console.log("[rootdatapro] 收到立即执行每日维护任务请求");
  try {
    const report = await taskManager.runDailyMaintenanceTask({ trigger: "manual" });
    if (report && report.success === false) {
      return res.status(409).json({ success: false, error: report.error, message: report.message });
    }
    return res.json({ success: true, report });
  } catch (error) {
    console.error("[rootdatapro] 执行每日维护任务失败:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

module.exports = router;
