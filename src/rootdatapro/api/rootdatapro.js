const express = require("express");
const db = require("../models");

const router = express.Router();

// 内部按 ID 查询（供管理后台调试爬虫数据）
router.get("/query_by_id", async (req, res) => {
  try {
    const type = String(req.query.type || "").trim();
    const rawId = String(req.query.id || "").trim();
    const id = rawId ? parseInt(rawId, 10) : NaN;
    if (!type || !Number.isFinite(id)) {
      return res.status(400).json({ success: false, error: "需要 type 和 id 参数" });
    }
    if (type === "Project") {
      const row = await db.Project.findByPk(id);
      return res.json({ success: true, data: row });
    }
    if (type === "Organization") {
      const row = await db.Organization.findByPk(id);
      return res.json({ success: true, data: row });
    }
    if (type === "Person") {
      const row = await db.Person.findByPk(id);
      return res.json({ success: true, data: row });
    }
    return res.status(400).json({ success: false, error: "type 需为 Project/Organization/Person" });
  } catch (err) {
    console.error("[rootdatapro] /internal/query_by_id error", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

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

// 通用抓取入口 - 已禁用
router.post("/scrape", async (req, res) => {
  console.log(`[rootdatapro] 收到抓取请求（已禁用）:`, req.body);
  return res.status(503).json({
    success: false,
    error: "SERVICE_DISABLED",
    message: "爬虫功能已禁用",
  });
});

// --- Crawl Task Management API ---

const taskManager = require("../scraper/taskManager");

router.post("/crawl/start", async (req, res) => {
  console.log("[rootdatapro] 收到启动爬虫任务请求（已禁用）");
  return res.status(503).json({
    success: false,
    error: "SERVICE_DISABLED",
    message: "爬虫功能已禁用",
  });
});

router.post("/crawl/pause", async (req, res) => {
  console.log("[rootdatapro] 收到暂停爬虫任务请求（已禁用）");
  return res.status(503).json({
    success: false,
    error: "SERVICE_DISABLED",
    message: "爬虫功能已禁用",
  });
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
  console.log("[rootdatapro] 收到重置爬虫任务请求（已禁用）");
  return res.status(503).json({
    success: false,
    error: "SERVICE_DISABLED",
    message: "爬虫功能已禁用",
  });
});

// 每日维护任务：立即执行 - 已禁用
router.post("/crawl/maintenance/run_now", async (req, res) => {
  console.log("[rootdatapro] 收到立即执行每日维护任务请求（已禁用）");
  return res.status(503).json({
    success: false,
    error: "SERVICE_DISABLED",
    message: "爬虫功能已禁用",
  });
});

// 强制重置状态 - 已禁用
router.post("/crawl/force_reset_status", async (req, res) => {
  console.log("[rootdatapro] 收到强制重置状态请求（已禁用）");
  return res.status(503).json({
    success: false,
    error: "SERVICE_DISABLED",
    message: "爬虫功能已禁用",
  });
});

module.exports = router;
