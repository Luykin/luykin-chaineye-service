// ==UserScript==
// @name         RootData Fundraising Scheduled Reader
// @namespace    https://cryptohunt.ai/
// @version      0.7.1
// @description  Scheduled RootData fundraising reader with refresh, retry, import and alert.
// @author       luykin
// @match        https://www.rootdata.com/fundraising*
// @match        https://www.rootdata.com/Fundraising*
// @match        https://www.rootdata.com/projects/detail/*
// @match        https://www.rootdata.com/Projects/detail/*
// @match        https://www.rootdata.com/investors/detail/*
// @match        https://www.rootdata.com/Investors/detail/*
// @match        https://www.rootdata.com/member/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================================
  // SECTION 1: CONFIG AND GLOBAL STATE
  // - Tampermonkey endpoints, schedules, limits, storage keys
  // - PAGE_WINDOW bootstrap and initial load logging
  // ============================================================================

  const CONFIG = {
    // TODO: 部署时改成真实 API 域名，例如 https://api.cryptohunt.ai
    API_BASE: "https://kb.cryptohunt.ai",
    FUNDRAISING_URL: "https://www.rootdata.com/fundraising",
    ALERT_ENDPOINT: "/api/internal/rootdata/fundraising/alert",
    IMPORT_ENDPOINT: "/api/internal/rootdata/fundraising/import",
    DETAIL_QUEUE_ENDPOINT: "/api/internal/rootdata/fundraising/details/queue",
    DETAIL_CLEANUP_ENDPOINT: "/api/internal/rootdata/fundraising/details/cleanup",
    DETAIL_IMPORT_ENDPOINT: "/api/internal/rootdata/fundraising/details/import",
    DETAIL_FAILURE_ENDPOINT: "/api/internal/rootdata/fundraising/details/failure",
    PING_ENDPOINT: "/api/internal/rootdata/fundraising/ping",
    CLIENT_TOKEN: "ct_uWOoKsZ9_MzozUUrVkc9gGnyvBQAp96pVmvLu7R1WE4",

    // 北京时间：对应原 scheduler 的 07:10 与 18:10
    scheduleBeijingTimes: ["07:10", "18:10"],
    scheduleCheckIntervalMs: 30 * 1000,
    idleCountdownRefreshMs: 1000,

    maxWaitMs: 30 * 1000,
    pollIntervalMs: 500,
    maxRetries: 3,
    retryDelayMs: 10 * 1000,
    detailEnabled: true,
    // 日常 run 也会按 detailBatchSize 分批刷新，所以这里可以放大，避免当前列表/衍生投资方被截断。
    detailMaxProjectsPerRun: 1000,
    subDetailMaxProjectsPerRun: 3000,
    detailBatchSize: 10,
    // iframe 在 RootData 新版详情页里不稳定；主流程改为当前标签页逐个跳转详情页抓取。
    detailLoadMode: "page",
    // RootData 新版详情页在隐藏/离屏 iframe 里容易被浏览器节流，导致 Next 内容不渲染。
    // 因此 iframe 保持在视口内用缩放预览方式加载，并把超时放宽。
    detailFrameTimeoutMs: 45 * 1000,
    detailFramePollIntervalMs: 500,
    detailBetweenMs: 1200,

    // localStorage 空间有限：批量任务只存最小必要字段，并定期清理。
    recrawlJobTtlMs: 24 * 60 * 60 * 1000,
    pendingJobTtlMs: 2 * 60 * 60 * 1000,
    maxStoredRecrawlItems: 3000,
    maxStoredDetailItems: 5000,
    maxStoredRecrawlErrors: 40,
    maxStoredLastRunDays: 14,
    maxStoredLastResultRows: 50,

    panelId: "rd-fundraising-reader-panel-v3",
    detailFrameId: "rd-fundraising-detail-frame-v3",
    storageKeys: {
      pendingJob: "rd_fr_pending_job_v3",
      recrawlJob: "rd_fr_recrawl_job_v3",
      detailJob: "rd_fr_detail_job_v3",
      lastRunMap: "rd_fr_last_run_map_v3",
      lastResult: "rd_fr_last_result_v3",
    },
  };

  const PAGE_WINDOW =
    typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;

  console.log("[RootData Reader] userscript loaded:", {
    href: location.href,
    title: document.title,
    runAt: nowIso(),
  });

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }


  // ============================================================================
  // SECTION 2: COMMON UTILITIES
  // - Text cleanup, URL canonicalization, time helpers, localStorage primitives
  // ============================================================================

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function absoluteUrl(href) {
    if (!href) return "";
    try {
      return new URL(href, location.origin).toString();
    } catch (_) {
      return href;
    }
  }

  function canonicalRootDataDetailUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      const url = new URL(rawUrl, location.origin);
      const detailMatch = url.pathname.match(/^\/(?:projects|Projects|investors|Investors)\/detail\/([^/?#]+)/);
      const memberMatch = url.pathname.match(/^\/member\/([^/?#]+)/);
      if (!detailMatch?.[1] && !memberMatch?.[1]) return url.toString();

      url.protocol = "https:";
      url.hostname = "www.rootdata.com";
      if (memberMatch?.[1]) {
        url.pathname = `/member/${memberMatch[1]}`;
      } else {
        const type = /\/(?:investors|Investors)\//.test(url.pathname) ? "Investors" : "Projects";
        url.pathname = `/${type}/detail/${detailMatch[1]}`;
      }

      const k = url.searchParams.get("k");
      url.search = "";
      if (k) url.searchParams.set("k", k);
      url.hash = "";
      return url.toString();
    } catch (_) {
      return rawUrl;
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isFundraisingPage() {
    return /^\/(?:fundraising|Fundraising)/.test(location.pathname);
  }

  function isDetailPage() {
    return /^\/(?:(?:projects|Projects|investors|Investors)\/detail|member)\//.test(location.pathname);
  }

  function navigateTo(url, reason, delayMs = 600) {
    console.log("[RootData Reader] navigate:", { reason, url, delayMs });
    setTimeout(() => {
      location.href = url;
    }, delayMs);
  }

  function getBeijingParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(date);

    const map = {};
    for (const part of parts) {
      if (part.type !== "literal") map[part.type] = part.value;
    }

    return {
      date: `${map.year}-${map.month}-${map.day}`,
      time: `${map.hour}:${map.minute}`,
      full: `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`,
    };
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value || "");
    } catch (_) {
      return fallback;
    }
  }

  function getLastRunMap() {
    return safeJsonParse(localStorage.getItem(CONFIG.storageKeys.lastRunMap), {});
  }

  function setLastRun(slotKey, value) {
    const map = getLastRunMap();
    map[slotKey] = value;
    localStorage.setItem(CONFIG.storageKeys.lastRunMap, JSON.stringify(map));
    pruneLastRunMap();
  }

  function pruneLastRunMap() {
    const map = getLastRunMap();
    const keys = Object.keys(map).sort();
    const maxKeys = Math.max(1, Number(CONFIG.maxStoredLastRunDays || 14) * CONFIG.scheduleBeijingTimes.length);
    if (keys.length <= maxKeys) return;

    for (const key of keys.slice(0, keys.length - maxKeys)) {
      delete map[key];
    }
    localStorage.setItem(CONFIG.storageKeys.lastRunMap, JSON.stringify(map));
  }

  function getPendingJob() {
    return safeJsonParse(localStorage.getItem(CONFIG.storageKeys.pendingJob), null);
  }

  function setPendingJob(job) {
    localStorage.setItem(CONFIG.storageKeys.pendingJob, JSON.stringify(job));
  }

  function clearPendingJob() {
    localStorage.removeItem(CONFIG.storageKeys.pendingJob);
  }

  function getTimeMs(value) {
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  }

  function isOlderThan(value, ttlMs) {
    const time = getTimeMs(value);
    return Boolean(time && Date.now() - time > ttlMs);
  }


  // ============================================================================
  // SECTION 3: JOB STORAGE AND COMPACTION HELPERS
  // - Pending jobs, detail jobs, recrawl jobs, compact stats for localStorage
  // ============================================================================

  function compactStatsForStorage(stats, total = 0) {
    if (!stats) return null;
    return {
      enabled: stats.enabled !== false,
      initialTotal: Number(stats.initialTotal || total || 0),
      initialSuccess: Number(stats.initialSuccess || 0),
      initialFailed: Number(stats.initialFailed || 0),
      subTotal: Number(stats.subTotal || 0),
      subSuccess: Number(stats.subSuccess || 0),
      subFailed: Number(stats.subFailed || 0),
      errors: Array.isArray(stats.errors)
        ? stats.errors
            .slice(-CONFIG.maxStoredRecrawlErrors)
            .map((item) => ({
              projectName: cleanText(item.projectName).slice(0, 160),
              projectLink: String(item.projectLink || "").slice(0, 1000),
              error: String(item.error || "").slice(0, 500),
            }))
        : [],
    };
  }

  function compactRecrawlJobForStorage(job) {
    const items = normalizeRecrawlItems(job?.items || []).slice(0, CONFIG.maxStoredRecrawlItems);
    return {
      id: String(job?.id || `recrawl-${Date.now()}`),
      slot: cleanText(job?.slot || "manual-console-recrawl-details-batched"),
      reason: cleanText(job?.reason || "manual_console_recrawl_details_batched"),
      nextAction: job?.nextAction === "recrawl_after_reload" ? "recrawl_after_reload" : null,
      cursor: Math.min(Math.max(0, Number(job?.cursor || 0)), items.length),
      batchSize: Math.max(1, Number(job?.batchSize || 10)),
      maxSub: Math.max(0, Number(job?.maxSub || 0)),
      forceRefreshInvestedRelationships: job?.forceRefreshInvestedRelationships === true,
      forceRefreshInvestmentRelationships: job?.forceRefreshInvestmentRelationships === true,
      cleanupWindowStart: job?.cleanupWindowStart ? String(job.cleanupWindowStart).slice(0, 80) : null,
      items,
      stats: compactStatsForStorage(job?.stats, items.length),
      lastBatchStats: compactStatsForStorage(job?.lastBatchStats, 0),
      createdAt: job?.createdAt || nowIso(),
      updatedAt: job?.updatedAt || nowIso(),
      lastError: job?.lastError ? String(job.lastError).slice(0, 500) : null,
    };
  }

  function getRecrawlJob() {
    return safeJsonParse(localStorage.getItem(CONFIG.storageKeys.recrawlJob), null);
  }

  function setRecrawlJob(job) {
    const compactJob = compactRecrawlJobForStorage(job);
    try {
      localStorage.setItem(CONFIG.storageKeys.recrawlJob, JSON.stringify(compactJob));
    } catch (error) {
      // localStorage 配额满时，优先清掉非关键缓存，再用更小的错误列表重试。
      console.warn("[RootData Reader] recrawl job storage failed, pruning caches:", error);
      localStorage.removeItem(CONFIG.storageKeys.lastResult);
      compactJob.stats = compactStatsForStorage({ ...compactJob.stats, errors: [] }, compactJob.items.length);
      compactJob.lastBatchStats = null;
      localStorage.setItem(CONFIG.storageKeys.recrawlJob, JSON.stringify(compactJob));
    }
  }

  function clearRecrawlJob() {
    localStorage.removeItem(CONFIG.storageKeys.recrawlJob);
  }

  function releaseDetailResources() {
    removeDetailFrame();
  }

  function reloadAfterRelease(reason, delayMs = 1500) {
    releaseDetailResources();
    console.log("[RootData Reader] release resources and reload:", { reason, delayMs });
    setTimeout(() => location.reload(), delayMs);
  }

  function cleanupLocalStorageState() {
    pruneLastRunMap();

    const pendingJob = getPendingJob();
    if (pendingJob && isOlderThan(pendingJob.updatedAt || pendingJob.createdAt, CONFIG.pendingJobTtlMs)) {
      console.warn("[RootData Reader] stale pending job cleared:", pendingJob);
      clearPendingJob();
    }

    const recrawlJob = getRecrawlJob();
    if (recrawlJob && isOlderThan(recrawlJob.updatedAt || recrawlJob.createdAt, CONFIG.recrawlJobTtlMs)) {
      console.warn("[RootData Reader] stale recrawl job cleared:", summarizeRecrawlJob(recrawlJob));
      clearRecrawlJob();
    }

    const detailJob = getDetailJob();
    if (detailJob && isOlderThan(detailJob.updatedAt || detailJob.createdAt, CONFIG.recrawlJobTtlMs)) {
      console.warn("[RootData Reader] stale detail job cleared:", summarizeDetailJob(detailJob));
      clearDetailJob();
    }
  }


  // ============================================================================
  // SECTION 4: FUNDRAISING LIST PARSER
  // - Parse /fundraising table rows into project records
  // - Investor cell parsing and list-page block detection
  // ============================================================================

  function parseEntityIdFromK(rawUrl) {
    try {
      const url = new URL(rawUrl, location.origin);
      const k = url.searchParams.get("k");
      if (!k) return null;
      const decoded = atob(decodeURIComponent(k));
      const num = Number(decoded);
      return Number.isFinite(num) ? num : null;
    } catch (_) {
      return null;
    }
  }

  function parseNameFromDetailUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      const url = new URL(rawUrl, location.origin);
      const detailMatch = url.pathname.match(/\/(?:projects|Projects|investors|Investors)\/detail\/([^/?#]+)/);
      const memberMatch = url.pathname.match(/\/member\/([^/?#]+)/);
      const slug = detailMatch?.[1] || memberMatch?.[1];
      if (!slug) return "";
      return decodeURIComponent(slug).replace(/\+/g, " ").trim();
    } catch (_) {
      return "";
    }
  }

  function normalizeEntityName(rawName, detailUrl = "") {
    const fromUrl = parseNameFromDetailUrl(detailUrl);
    const text = cleanText(rawName).replace(/\*$/, "").trim();

    // RootData 新页面的链接文本里经常混入头像 alt，表现为 “SSquid” / “CCoinbase Ventures”。
    // 详情 URL 中的 slug 反而更稳定，因此优先使用 URL 解析出的名称。
    if (fromUrl) return fromUrl;

    // 无链接兜底：去掉部分 “首字母重复” 噪音，如 “HHana Financial” -> “Hana Financial”。
    if (/^([A-Za-z])\1[A-Za-z]/.test(text)) {
      return text.slice(1);
    }

    return text;
  }

  function findProjectLink(projectCell) {
    if (!projectCell) return null;
    const links = Array.from(
      projectCell.querySelectorAll(
        'a[href*="/projects/detail/"], a[href*="/Projects/detail/"]'
      )
    );
    return links.find((link) => cleanText(link.textContent)) || links[0] || null;
  }

  function parseInvestorCell(cell) {
    if (!cell) return [];

    const links = Array.from(
      cell.querySelectorAll(
        'a[href*="/investors/detail/"], a[href*="/Investors/detail/"], a[href*="/projects/detail/"], a[href*="/Projects/detail/"]'
      )
    );

    const linkedInvestors = links
      .map((link) => ({
        link: canonicalRootDataDetailUrl(absoluteUrl(link.getAttribute("href"))),
        rawText: cleanText(link.textContent),
      }))
      .map((item) => ({
        ...item,
        name: normalizeEntityName(item.rawText, item.link),
      }))
      .filter((item) => item.name || item.link);

    if (linkedInvestors.length) return linkedInvestors;

    return cleanText(cell.textContent)
      .split(/\s{2,}|\n/)
      .map((name) => cleanText(name))
      .filter(Boolean)
      .map((name) => ({ name: normalizeEntityName(name), link: "" }));
  }

  function parseFundraisingRows() {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));

    return rows
      .map((row, index) => {
        const cells = row.querySelectorAll("td");
        const projectCell = cells[0];
        const projectLinkEl = findProjectLink(projectCell);
        const projectLink = canonicalRootDataDetailUrl(absoluteUrl(projectLinkEl?.getAttribute("href") || ""));
        const projectName =
          normalizeEntityName(projectLinkEl?.textContent, projectLink) ||
          projectCell?.querySelector("img")?.getAttribute("alt") ||
          "";

        const sourceLinkEl = cells[5]?.querySelector("a[href]");
        const logo = projectCell?.querySelector("img")?.src || "";

        return {
          index: index + 1,
          projectName,
          projectLink,
          projectId: parseEntityIdFromK(projectLink),
          logo,
          round: cleanText(cells[1]?.textContent),
          amount: cleanText(cells[2]?.textContent),
          valuation: cleanText(cells[3]?.textContent),
          date: cleanText(cells[4]?.textContent),
          sourceUrl: absoluteUrl(sourceLinkEl?.getAttribute("href") || ""),
          investors: parseInvestorCell(cells[6]),
          pageUrl: location.href,
          scrapedAt: nowIso(),
        };
      })
      .filter((item) => item.projectName && item.projectLink);
  }

  function detectBlockedPage() {
    const title = document.title || "";
    const bodyText = cleanText(document.body?.innerText || "");
    const html = document.documentElement?.outerHTML || "";
    const tableCount = document.querySelectorAll("table").length;
    const rowCount = document.querySelectorAll("table tbody tr").length;
    const projectLinkCount = document.querySelectorAll(
      'a[href*="/projects/detail/"], a[href*="/Projects/detail/"]'
    ).length;

    const checks = [
      {
        type: "waf_block",
        matched: /WAF Block Page|Your request has been interrupted|web application firewall/i.test(html),
      },
      {
        type: "captcha",
        matched: /CaptchaScript|sg\.captcha\.qcloud\.com|new Captcha\(|\/WafCaptcha|__captcha/i.test(html),
      },
      {
        type: "cloudflare",
        matched: /cloudflare|attention required|checking your browser|verify you are human/i.test(html),
      },
      {
        type: "blank_page",
        matched: projectLinkCount === 0 && rowCount === 0 && (html.length < 1000 || bodyText.length < 20),
      },
      {
        type: "login_page",
        // RootData 正常页面导航里也可能出现 Log in / Sign in，不能仅凭文案判断。
        // 只有在完全没有列表数据时，才认为可能落到了登录页。
        matched: projectLinkCount === 0 && rowCount === 0 && /log in|sign in|登录|登入/i.test(bodyText),
      },
    ];

    const hit = checks.find((item) => item.matched);
    if (!hit) return { blocked: false };

    return {
      blocked: true,
      reason: hit.type,
      title,
      bodyText: bodyText.slice(0, 1000),
      htmlStart: html.slice(0, 1500),
      htmlLength: html.length,
      tableCount,
      rowCount,
      projectLinkCount,
      url: location.href,
    };
  }

  async function waitForRowsOrBlocked() {
    const start = Date.now();

    while (Date.now() - start < CONFIG.maxWaitMs) {
      const data = parseFundraisingRows();
      if (data.length > 0) return data;

      const blocked = detectBlockedPage();
      if (blocked.blocked) {
        throw Object.assign(new Error(`页面异常：${blocked.reason}`), { details: blocked });
      }

      await sleep(CONFIG.pollIntervalMs);
    }

    const finalBlocked = detectBlockedPage();
    if (finalBlocked.blocked) {
      throw Object.assign(new Error(`页面异常：${finalBlocked.reason}`), { details: finalBlocked });
    }

    throw Object.assign(new Error("等待超时：没有解析到融资数据"), {
      details: {
        reason: "timeout_no_rows",
        title: document.title,
        url: location.href,
        bodyText: cleanText(document.body?.innerText || "").slice(0, 1000),
        htmlStart: (document.documentElement?.outerHTML || "").slice(0, 1500),
        htmlLength: (document.documentElement?.outerHTML || "").length,
        tableCount: document.querySelectorAll("table").length,
        rowCount: document.querySelectorAll("table tbody tr").length,
        projectLinkCount: document.querySelectorAll(
          'a[href*="/projects/detail/"], a[href*="/Projects/detail/"]'
        ).length,
      },
    });
  }

  function uniqueByLink(items) {
    const map = new Map();
    for (const item of items || []) {
      const link = canonicalRootDataDetailUrl(absoluteUrl(item.projectLink || item.link || ""));
      if (!link || map.has(link)) continue;
      map.set(link, { ...item, projectLink: link });
    }
    return Array.from(map.values());
  }

  function ensureDetailFrame() {
    let frame = document.getElementById(CONFIG.detailFrameId);
    if (frame) return frame;

    frame = document.createElement("iframe");
    frame.id = CONFIG.detailFrameId;
    frame.setAttribute("title", "RootData detail crawler frame");
    frame.loading = "eager";
    frame.style.cssText = [
      "position: fixed",
      "left: 8px",
      "top: 8px",
      "width: 1280px",
      "height: 900px",
      "transform: scale(0.08)",
      "transform-origin: top left",
      "opacity: 0.96",
      "pointer-events: none",
      "border: 1px solid rgba(37,99,235,.45)",
      "border-radius: 10px",
      "background: #fff",
      "box-shadow: 0 8px 28px rgba(15,23,42,.18)",
      "z-index: 999998",
    ].join(";");
    document.body.appendChild(frame);
    return frame;
  }

  function removeDetailFrame() {
    const frame = document.getElementById(CONFIG.detailFrameId);
    if (!frame) return;
    try {
      frame.src = "about:blank";
    } catch (_) {}
    frame.remove();
  }

  function getFrameDocument(frame) {
    try {
      return frame.contentDocument || frame.contentWindow?.document || null;
    } catch (_) {
      return null;
    }
  }

  function detectBlockedDocument(doc, url) {
    const html = doc?.documentElement?.outerHTML || "";
    const bodyText = cleanText(doc?.body?.innerText || "");
    const checks = [
      { type: "waf_block", matched: /WAF Block Page|Your request has been interrupted|web application firewall/i.test(html) },
      { type: "captcha", matched: /CaptchaScript|sg\.captcha\.qcloud\.com|new Captcha\(|\/WafCaptcha|__captcha/i.test(html) },
      { type: "cloudflare", matched: /cloudflare|attention required|checking your browser|verify you are human/i.test(html) },
      { type: "blank_page", matched: html.length < 1000 || bodyText.length < 20 },
    ];
    const hit = checks.find((item) => item.matched);
    if (!hit) return { blocked: false };
    return {
      blocked: true,
      reason: hit.type,
      url,
      title: doc?.title || "",
      bodyText: bodyText.slice(0, 1000),
      htmlLength: html.length,
      htmlStart: html.slice(0, 1500),
    };
  }

  async function loadDetailDocument(frame, url) {
    frame.src = "about:blank";
    await sleep(120);
    frame.src = url;

    const start = Date.now();
    const isMemberDetail = isRootDataMemberUrl(url);
    let lastDetails = null;
    let loadedAt = 0;
    let readyAt = 0;

    while (Date.now() - start < CONFIG.detailFrameTimeoutMs) {
      const doc = getFrameDocument(frame);
      if (!doc) {
        await sleep(CONFIG.detailFramePollIntervalMs);
        continue;
      }

      const blocked = detectBlockedDocument(doc, url);
      if (blocked.blocked && blocked.reason !== "blank_page") {
        throw Object.assign(new Error(`详情页异常：${blocked.reason}`), { details: blocked });
      }

      lastDetails = parseDetailDocument(doc, url, { isInitial: true, dryRun: true });
      const hasSocialLinks = (lastDetails.debug?.socialLinkKeys || []).length > 0;
      if (lastDetails.ready) {
        if (hasSocialLinks) return doc;

        // 不能一看到 logo 就立刻返回；member / 新版详情页的 X 链接经常比头像晚渲染。
        // member 页这次实测 2 秒仍可能只有头像没有 X，所以 member 等更久一点。
        if (!readyAt) readyAt = Date.now();
        const socialWaitMs = isMemberDetail ? 5000 : 2500;
        if (Date.now() - readyAt > socialWaitMs) return doc;
      }
      if (
        !loadedAt &&
        doc.readyState === "complete" &&
        cleanText(doc.body?.innerText || "").length > 200
      ) {
        loadedAt = Date.now();
      }
      // RootData 详情页现在 class 变化较频繁，不能一直死等旧 class；
      // 但如果已经 ready 只是 socialLinks 还没出来，不要被 loadedAt 的 2 秒兜底提前截断。
      if (loadedAt && Date.now() - loadedAt > 2000 && !(lastDetails?.ready && !hasSocialLinks)) return doc;

      await sleep(CONFIG.detailFramePollIntervalMs);
    }

    const doc = getFrameDocument(frame);
    const blocked = doc ? detectBlockedDocument(doc, url) : { blocked: true, reason: "no_frame_document" };
    throw Object.assign(new Error(`详情页等待超时：${url}`), {
      details: {
        ...(blocked || {}),
        lastDetails,
      },
    });
  }

  function inferSocialType(link) {
    const href = String(link?.href || "").toLowerCase();
    const text = cleanText(link?.textContent || link?.getAttribute("aria-label") || "").toLowerCase();
    const iconSrc = String(link?.querySelector?.("img")?.getAttribute("src") || "").toLowerCase();

    if (/official_website|website|web_site/.test(iconSrc)) return "website";
    if (/twitter|\/x\./.test(iconSrc)) return "x";
    if (/linkedin/.test(iconSrc)) return "linkedin";
    if (/discord/.test(iconSrc)) return "discord";
    if (/telegram/.test(iconSrc)) return "telegram";
    if (/medium/.test(iconSrc)) return "medium";
    if (/github/.test(iconSrc)) return "github";
    if (/docs?/.test(iconSrc)) return "docs";

    if (/twitter\.com|x\.com/.test(href) || /\bx\b|twitter/.test(text)) return "x";
    if (/discord/.test(href) || /discord/.test(text)) return "discord";
    if (/t\.me|telegram/.test(href) || /telegram/.test(text)) return "telegram";
    if (/linkedin/.test(href) || /linkedin/.test(text)) return "linkedin";
    if (/github/.test(href) || /github/.test(text)) return "github";
    if (/medium/.test(href) || /medium/.test(text)) return "medium";
    if (/docs?\.|gitbook|notion/.test(href) || /docs?/.test(text)) return "docs";
    return text || "website";
  }

  function isRootDataOwnedExternalUrl(label, rawUrl) {
    const text = cleanText(label || "").toLowerCase();
    if (!rawUrl) return true;

    try {
      const url = new URL(rawUrl);
      const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      const full = `${hostname}${url.pathname}${url.search}`.toLowerCase();

      if (/rootdata\.com$/.test(hostname)) return true;
      if (/x\.com|twitter\.com/.test(hostname) && /rootdatacrypto/i.test(url.pathname)) return true;
      if (hostname === "t.me" && /rootdatalabs/i.test(url.pathname)) return true;
      if (hostname === "rootdatalabs.medium.com") return true;
      if (hostname === "calendly.com" && /rootdata|elvin-rootdata/i.test(url.pathname)) return true;
      if (hostname === "notion.so" && /business|development|hiring|rootdata|source=copy_link/i.test(url.pathname + url.search)) return true;
      if (hostname === "drive.google.com" && /media|kit/i.test(text)) return true;
      if (hostname === "play.google.com" && /rootdata|com\.flutter\.benliu\.rootdata/i.test(full)) return true;
      if (hostname === "linkedin.com" && /lucasschuermann/i.test(url.pathname)) return true;
    } catch (_) {
      return true;
    }

    if (/rootdata|business cooperation|hiring|media kit/.test(text)) return true;
    return false;
  }

  function isRootDataOwnedExternalLink(link) {
    const href = String(link?.href || "");
    const text = cleanText(link?.textContent || link?.getAttribute("aria-label") || "").toLowerCase();
    return isRootDataOwnedExternalUrl(text, href);
  }

  function isDebugDetailTarget(value) {
    return /Variational/i.test(String(value?.projectName || value?.name || value?.projectLink || value?.detailUrl || value || ""));
  }

  function summarizeDetailForDebug(detail) {
    const investors = Array.isArray(detail?.investors) ? detail.investors : [];
    return {
      projectName: detail?.projectName,
      projectLink: detail?.projectLink,
      detailUrl: detail?.detailUrl,
      isInitial: detail?.isInitial,
      socialLinks: detail?.socialLinks,
      investorsCount: investors.length,
      investors: investors.map((item) => ({
        projectName: item.projectName,
        projectLink: item.projectLink,
        round: item.round,
        amount: item.amount,
        valuation: item.valuation,
        date: item.date,
        lead: item.lead,
        source: item.source,
      })),
      seriesA50M: investors.filter((item) => /series\s*a/i.test(item.round || "") && /50\s*M/i.test(item.amount || "")),
      investedProjectsCount: Array.isArray(detail?.investedProjects) ? detail.investedProjects.length : 0,
      debug: detail?.debug,
    };
  }

  function isNonEntityDetailScope(element) {
    return Boolean(
      element?.closest?.(
        [
          "header",
          "footer",
          "nav",
          ".team_member",
          ".team-member",
          ".investor",
          ".investment",
          "table",
          "[class*='team' i]",
          "[class*='member' i]",
          "[class*='investor' i]",
          "[class*='investment' i]",
          "[class*='portfolio' i]",
          "[class*='news' i]",
          "[class*='article' i]",
          "[class*='event' i]",
        ].join(", ")
      )
    );
  }

  function isEntityInfoScope(element) {
    return Boolean(
      element?.closest?.(
        [
          "#base-info-header",
          ".detail_info_head",
          ".base_info",
          "[class*='detail_info' i]",
          "[class*='base_info' i]",
          "[class*='base-info' i]",
        ].join(", ")
      )
    );
  }

  function getDetailTitle(doc) {
    return (
      cleanText(doc.querySelector("#base-info-header h1, main h1")?.textContent) ||
      cleanText(doc.querySelector('meta[property="og:title"], meta[name="twitter:title"]')?.getAttribute("content")).replace(
        /\s*[-|]\s*RootData.*$/i,
        ""
      ) ||
      cleanText(doc.title).replace(/\s*[-|]\s*RootData.*$/i, "")
    );
  }

  function isSuspiciousDetailImageUrl(rawUrl) {
    const url = String(rawUrl || "").toLowerCase();
    if (!url) return true;
    if (/detail_icon_|official_website|detail_icon_twitter|detail_icon_linkedin/.test(url)) return true;
    if (/rootdata\.com\/images\/(logo|rootdata|favicon|icon)/.test(url)) return true;
    if (/\/favicon\.|\/apple-touch-icon|placeholder|default-avatar|default_logo/.test(url)) return true;
    return false;
  }

  function isUsableEntityLogoImage(img) {
    if (!img || isNonEntityDetailScope(img)) return false;
    const src = img.src || img.getAttribute("src") || "";
    if (isSuspiciousDetailImageUrl(src)) return false;
    return isEntityInfoScope(img) || img.matches("img.logo, .logo img, .logo-wraper img");
  }

  function pickEntityLogo(doc) {
    const title = getDetailTitle(doc);
    const headerImage = Array.from(doc.querySelectorAll("#base-info-header img[alt]")).find((img) => {
      return cleanText(img.getAttribute("alt")) === title && !isSuspiciousDetailImageUrl(img.src || img.getAttribute("src"));
    });
    if (headerImage?.src) return headerImage.src;

    const detailRoot = doc.querySelector("main") || doc.body || doc;
    const image = Array.from(
      detailRoot.querySelectorAll(".detail_info_head img, .base_info img, img.logo, .logo img, .logo-wraper img")
    ).find(isUsableEntityLogoImage);
    if (image?.src) return image.src;

    const metaImage = doc
      .querySelector('meta[property="og:image"], meta[name="twitter:image"]')
      ?.getAttribute("content");
    if (metaImage && !isSuspiciousDetailImageUrl(metaImage)) return metaImage;

    return "";
  }

  function findOfficialAsideXUrl(doc, detailUrl) {
    const title = normalizeEntityName(getDetailTitle(doc), detailUrl);
    const links = Array.from(doc.querySelectorAll('aside a[href*="x.com"], aside a[href*="twitter.com"]'));

    const link = links.find((anchor) => {
      const text = cleanText(anchor.textContent);
      if (!text.startsWith("@")) return false;
      if (!normalizeXUrl(anchor.href)) return false;

      const card = anchor.closest("div.relative, div.rounded-xl, aside") || anchor.closest("aside");
      const cardText = cleanText(card?.textContent || "");
      return !title || cardText.includes(title) || text.slice(1).toLowerCase().includes(title.toLowerCase().replace(/\s+/g, ""));
    });

    return link ? normalizeXUrl(link.href) : "";
  }


  function findHeaderXUrl(doc) {
    const link = Array.from(doc.querySelectorAll('#base-info-header a[href*="x.com"], #base-info-header a[href*="twitter.com"]'))
      .find((anchor) => normalizeXUrl(anchor.href));
    return link ? normalizeXUrl(link.href) : "";
  }

  function normalizeHandleText(value) {
    return String(value || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "");
  }

  function getXHandleFromUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const normalized = normalizeXUrl(url.toString());
      if (!normalized) return "";
      return normalizeHandleText(new URL(normalized).pathname.split("/").filter(Boolean)[0] || "");
    } catch (_) {
      return "";
    }
  }

  function findTitleMatchedXUrl(doc, detailUrl) {
    const titleHandle = normalizeHandleText(normalizeEntityName(getDetailTitle(doc), detailUrl));
    if (!titleHandle) return "";

    const links = Array.from(doc.querySelectorAll('a[href*="x.com"], a[href*="twitter.com"]'))
      .map((anchor) => ({ anchor, url: normalizeXUrl(anchor.href), handle: getXHandleFromUrl(anchor.href) }))
      .filter((item) => item.url && item.handle && item.handle !== "rootdatacrypto");

    const matched = links.find((item) => item.handle === titleHandle);
    return matched ? matched.url : "";
  }

  function decodeHtmlAttribute(value) {
    return String(value || "")
      .replace(/&amp;/g, "&")
      .replace(/&#x2F;/gi, "/")
      .replace(/\\u002[fF]/g, "/")
      .replace(/\\\//g, "/")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function findRawHtmlTitleMatchedXUrl(doc, detailUrl) {
    const titleHandle = normalizeHandleText(normalizeEntityName(getDetailTitle(doc), detailUrl));
    if (!titleHandle) return "";

    const html = decodeHtmlAttribute(doc.documentElement?.outerHTML || "");
    const regex = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,32})/gi;
    let match;
    while ((match = regex.exec(html))) {
      const rawUrl = decodeHtmlAttribute(match[0]);
      const handle = normalizeHandleText(match[1]);
      if (!handle || handle === "rootdatacrypto") continue;
      if (handle === titleHandle) return normalizeXUrl(rawUrl) || `https://x.com/${match[1]}`;
    }

    return "";
  }

  function decodeNextFlightText(value) {
    return decodeHtmlAttribute(value)
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
        try {
          return String.fromCharCode(parseInt(hex, 16));
        } catch (_) {
          return _;
        }
      })
      .replace(/\\(["'\\/])/g, "$1");
  }

  function getNextFlightText(doc) {
    return Array.from(doc.querySelectorAll("script"))
      .map((script) => script.textContent || "")
      .filter((text) => /self\.__next_f\.push|twitterUrl|headImg|lyingUrl|blogUrl/.test(text))
      .map(decodeNextFlightText)
      .join("\n");
  }

  function findJsonLikeStringField(text, fieldName) {
    if (!text) return "";
    const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`"${escapedField}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`);
    const match = text.match(regex);
    return match ? decodeNextFlightText(match[1]) : "";
  }

  function getTopDetailNextFlightSlice(doc) {
    const text = getNextFlightText(doc);
    const fieldIndexes = ['"twitterUrl"', '"headImg"', '"lyingUrl"', '"blogUrl"']
      .map((field) => text.indexOf(field))
      .filter((index) => index >= 0);
    const firstUsefulFieldIndex = fieldIndexes.length ? Math.min(...fieldIndexes) : -1;
    const detailIndex =
      firstUsefulFieldIndex >= 0
        ? text.lastIndexOf('"detail":', firstUsefulFieldIndex)
        : text.indexOf('"detail":');
    if (detailIndex < 0) return "";

    // children 里面会有 relevantPerson / investProject 等大量关联实体，不能从那里拿 twitterUrl。
    const childrenIndex = text.indexOf('"children"', detailIndex);
    const endIndex = childrenIndex > detailIndex ? childrenIndex : detailIndex + 20000;
    return text.slice(detailIndex, endIndex);
  }

  function parseNextFlightDetailFields(doc) {
    const slice = getTopDetailNextFlightSlice(doc);
    if (!slice) return {};

    return {
      twitterUrl: normalizeXUrl(findJsonLikeStringField(slice, "twitterUrl")),
      linkedinUrl: cleanText(findJsonLikeStringField(slice, "lyingUrl")),
      blogUrl: cleanText(findJsonLikeStringField(slice, "blogUrl")),
      headImg: cleanText(findJsonLikeStringField(slice, "headImg")),
    };
  }

  function findNextFlightOfficialXUrl(doc) {
    return parseNextFlightDetailFields(doc).twitterUrl || "";
  }

  function getXLinkDebug(doc, detailUrl) {
    const links = Array.from(doc.querySelectorAll('a[href*="x.com"], a[href*="twitter.com"]'));
    return {
      headerXCount: doc.querySelectorAll('#base-info-header a[href*="x.com"], #base-info-header a[href*="twitter.com"]').length,
      asideXCount: doc.querySelectorAll('aside a[href*="x.com"], aside a[href*="twitter.com"]').length,
      allXCount: links.length,
      rawHtmlTitleMatchedXUrl: findRawHtmlTitleMatchedXUrl(doc, detailUrl),
      nextFlightDetail: parseNextFlightDetailFields(doc),
      candidates: links.slice(0, 8).map((anchor) => ({
        href: anchor.href || anchor.getAttribute("href") || "",
        text: cleanText(anchor.textContent).slice(0, 80),
        inHeader: Boolean(anchor.closest("#base-info-header")),
        inAside: Boolean(anchor.closest("aside")),
        handle: getXHandleFromUrl(anchor.href || anchor.getAttribute("href") || ""),
      })),
    };
  }

  function normalizeXUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      const url = new URL(rawUrl);
      const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      if (hostname !== "x.com" && hostname !== "twitter.com") return "";
      if (!url.pathname || url.pathname === "/") return "";
      if (/^\/RootDataCrypto\/?$/i.test(url.pathname)) return "";
      url.protocol = "https:";
      url.hostname = "x.com";
      url.hash = "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function sanitizeParsedSocialLinks(rawSocialLinks) {
    const entries = Object.entries(rawSocialLinks || {});
    const xEntry = entries.find(([rawKey, rawUrl]) => {
      const key = String(rawKey || "").toLowerCase();
      return (key === "x" || key === "twitter") && Boolean(normalizeXUrl(rawUrl));
    });
    const xUrl = xEntry ? normalizeXUrl(xEntry[1]) : "";

    // 坤哥要求：x 链接非常重要，不允许用官网/RootData 官方账号/任意外链兜底；没有合法 x.com 就整组丢弃。
    if (!xUrl) return {};

    const result = { x: xUrl };
    for (const [rawKey, rawUrl] of entries) {
      const key = String(rawKey || "").toLowerCase() === "twitter" ? "x" : String(rawKey || "").toLowerCase();
      const url = String(rawUrl || "").trim();
      if (!key || key === "x" || !/^https?:\/\//i.test(url)) continue;
      if (isRootDataOwnedExternalUrl(key, url)) continue;
      result[key] = url;
    }

    return result;
  }

  function placeholderEntityLink(projectName) {
    return `javascript:void(0)/${cleanText(projectName) || `unknown-${Date.now()}`}`;
  }

  function readEntityLink(anchor) {
    if (!anchor) return null;
    const link = canonicalRootDataDetailUrl(absoluteUrl(anchor.getAttribute("href") || anchor.href || ""));
    if (!/rootdata\.com\/(?:projects|Projects|investors|Investors)\/detail\//.test(link)) return null;
    const rawText = cleanText(anchor.querySelector("h2")?.textContent || anchor.textContent || "");
    const name = normalizeEntityName(rawText, link);
    if (!name && !link) return null;
    return { projectName: name, projectLink: link };
  }

  function readPlainInvestorEntity(element) {
    if (!element) return null;
    const rawName = cleanText(
      element.querySelector(".animate-underline, [class*='font-medium' i]")?.textContent || element.textContent || ""
    );
    const name = normalizeEntityName(rawName);
    if (!name) return null;
    return { projectName: name, projectLink: placeholderEntityLink(name) };
  }

  function isCurrentDetailLink(link, detailUrl) {
    try {
      const left = new URL(link, location.origin);
      const right = new URL(detailUrl, location.origin);
      return left.pathname.toLowerCase() === right.pathname.toLowerCase();
    } catch (_) {
      return false;
    }
  }

  function collectEntityLinks(scope, detailUrl, { allowProjects = true, allowInvestors = true } = {}) {
    const links = Array.from(
      scope.querySelectorAll(
        'a[href*="/investors/detail/"], a[href*="/Investors/detail/"], a[href*="/projects/detail/"], a[href*="/Projects/detail/"], a[href*="/member/"]'
      )
    );
    const result = [];
    const seen = new Set();

    for (const anchor of links) {
      const entity = readEntityLink(anchor);
      if (!entity) continue;
      if (!allowProjects && /\/(?:projects|Projects)\/detail\//.test(entity.projectLink)) continue;
      if (!allowInvestors && /\/(?:investors|Investors)\/detail\//.test(entity.projectLink)) continue;
      if (detailUrl && isCurrentDetailLink(entity.projectLink, detailUrl)) continue;
      if (seen.has(entity.projectLink)) continue;
      seen.add(entity.projectLink);
      result.push(entity);
    }

    return result;
  }

  function findSectionElementsByKeywords(doc, keywords) {
    const regex = new RegExp(keywords.join("|"), "i");
    const candidates = Array.from(doc.querySelectorAll("section, article, div, main"))
      .filter((node) => {
        const text = cleanText(node.textContent).slice(0, 300);
        return regex.test(text) && node.querySelector("a[href]");
      })
      .sort((a, b) => cleanText(a.textContent).length - cleanText(b.textContent).length);

    return candidates.slice(0, 8);
  }


  // ============================================================================
  // SECTION 5: DETAIL PAGE FUNDRAISING / INVESTMENT PARSERS
  // - Investors tab, Rounds tab, Lead marker merge
  // - Portfolio / Investment sections and entity-link collection
  // ============================================================================

  function hasExplicitLeadMarker(scope) {
    if (!scope) return false;
    if (scope.querySelector?.(".status_icon.status_position")) return true;
    return Array.from(scope.querySelectorAll?.("span, div, em, strong, i") || [])
      .some((node) => /^lead$/i.test(cleanText(node.textContent)));
  }

  function isLeadInvestorElement(element, text = "") {
    const localText = cleanText(text || element?.textContent || "");
    // RootData 旧版会在投资人名字后加 * 表示 Lead；只看当前链接/当前单元，不看整个 section。
    if (/\*/.test(localText)) return true;

    const card = element?.closest?.(
      [
        "a.card",
        "a.card-warp",
        ".card-warp",
        ".item",
        "tr",
        "td",
      ].join(", ")
    ) || element;

    return hasExplicitLeadMarker(card);
  }

  function findFundraisingInvestorScopes(doc) {
    const scopes = [];
    const pushScope = (scope) => {
      if (!scope || scopes.some((existing) => existing === scope || existing.contains(scope))) return;
      for (let index = scopes.length - 1; index >= 0; index -= 1) {
        if (scope.contains(scopes[index])) scopes.splice(index, 1);
      }
      scopes.push(scope);
    };

    Array.from(doc.querySelectorAll(".investor, #detail_section_financials_fundraising")).forEach(pushScope);

    Array.from(doc.querySelectorAll("section")).forEach((section) => {
      const heading = cleanText(section.querySelector("h1, h2, h3, h4, [role='heading']")?.textContent);
      if (!/^(Fundraising|Financing|Funding)$/i.test(heading)) return;

      const hasInvestorSignal = Array.from(section.querySelectorAll("button, [role='tab'], th"))
        .some((node) => /^(Investors?|Rounds?)$/i.test(cleanText(node.textContent)));
      if (!hasInvestorSignal) return;

      const hasEntityLinks = section.querySelector(
        'a[href*="/investors/detail/"], a[href*="/Investors/detail/"], a[href*="/projects/detail/"], a[href*="/Projects/detail/"]'
      );
      if (!hasEntityLinks) return;

      pushScope(section);
    });

    return scopes;
  }

  function parseInitialInvestors(doc, detailUrl) {
    let items = Array.from(doc.querySelectorAll(".investor .row .item"));
    if (!items.length) items = Array.from(doc.querySelectorAll(".investor .item"));

    if (items.length) {
      return items
        .map((item) => {
          const link = item.querySelector('a[href*="/investors/detail/"], a[href*="/Investors/detail/"], a[href*="/projects/detail/"], a[href*="/Projects/detail/"], a[href]');
          const entity = readEntityLink(link);
          if (!entity) return null;
          return {
            ...entity,
            lead: isLeadInvestorElement(item),
            source: "initial",
          };
        })
        .filter(Boolean);
    }

    const links = findFundraisingInvestorScopes(doc).flatMap((section) =>
      Array.from(
        section.querySelectorAll(
          'a[href*="/investors/detail/"], a[href*="/Investors/detail/"], a[href*="/projects/detail/"], a[href*="/Projects/detail/"]'
        )
      )
    );

    return uniqueByLink(
      links
        .map((anchor) => {
          const entity = readEntityLink(anchor);
          if (!entity || (detailUrl && isCurrentDetailLink(entity.projectLink, detailUrl))) return null;
          return {
            ...entity,
            lead: isLeadInvestorElement(anchor, anchor.textContent),
            source: "section",
          };
        })
        .filter(Boolean)
    );
  }

  function findFundraisingRoundTables(doc) {
    return Array.from(doc.querySelectorAll("table")).filter((table) => {
      const headerText = cleanText(
        Array.from(table.querySelectorAll("thead th, tr:first-child th, tr:first-child td"))
          .map((cell) => cell.textContent)
          .join(" ")
      ).toLowerCase();
      if (!/round|轮次/.test(headerText)) return false;
      if (!/amount|金额/.test(headerText)) return false;
      if (!/investor|backer|投资/.test(headerText)) return false;

      const sectionText = cleanText(table.closest("section, article, main, div")?.textContent || "").slice(0, 500).toLowerCase();
      return /fundraising|financing|funding|融资/.test(sectionText) || true;
    });
  }

  function parseRoundsInvestors(doc, detailUrl) {
    const result = [];
    const tables = findFundraisingRoundTables(doc);

    for (const table of tables) {
      const headerCells = Array.from(
        table.querySelectorAll("thead th, tr:first-child th, tr:first-child td")
      );
      const headerTexts = headerCells.map((th) => cleanText(th.textContent).toLowerCase());
      if (!headerTexts.length) continue;

      const findIndexBy = (regex, fallbackIndex) => {
        const index = headerTexts.findIndex((text) => regex.test(text));
        return index >= 0 ? index : fallbackIndex;
      };

      const idxRound = findIndexBy(/round|轮次/i, 0);
      const idxAmount = findIndexBy(/amount|金额/i, 1);
      const idxValuation = findIndexBy(/valuation|估值/i, 2);
      const idxDate = findIndexBy(/date|日期/i, 3);
      const idxInvestors = findIndexBy(/investor|backer|投资/i, headerCells.length - 1);

      Array.from(table.querySelectorAll("tbody tr, tr"))
        .filter((row) => row.querySelectorAll("td").length > 0)
        .forEach((row) => {
          const cells = row.querySelectorAll("td");
          const investorCell = cells[idxInvestors];
          if (!investorCell) return;

          const anchors = Array.from(
            investorCell.querySelectorAll(
              'a[href*="/investors/detail/"], a[href*="/Investors/detail/"], a[href*="/projects/detail/"], a[href*="/Projects/detail/"]'
            )
          );

          const plainInvestorElements = Array.from(
            investorCell.querySelectorAll("span.cursor-not-allowed")
          ).filter((element) => !element.closest("a"));

          const investorEntities = [
            ...anchors.map((anchor) => ({ entity: readEntityLink(anchor), element: anchor, text: cleanText(anchor.textContent) })),
            ...plainInvestorElements.map((element) => ({ entity: readPlainInvestorEntity(element), element, text: cleanText(element.textContent) })),
          ];

          investorEntities
            .map(({ entity, element, text }) => {
              if (!entity || (detailUrl && isCurrentDetailLink(entity.projectLink, detailUrl))) return null;
              return {
                ...entity,
                lead: isLeadInvestorElement(element, text),
                round: cleanText(cells[idxRound]?.textContent) || "--",
                amount: cleanText(cells[idxAmount]?.textContent) || null,
                valuation: cleanText(cells[idxValuation]?.textContent) || null,
                date: cleanText(cells[idxDate]?.textContent) || null,
                source: "rounds",
              };
            })
            .filter(Boolean)
            .forEach((item) => result.push(item));
        });
    }

    const seen = new Set();
    return result.filter((item) => {
      const key = `${item.projectLink}|${item.round || "--"}|${item.date || ""}|${item.amount || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function mergeInvestorData(initial, rounds) {
    const resultMap = new Map();
    const roundNames = new Set();
    const initialLeadByLink = new Map();
    const initialLeadByName = new Map();

    for (const item of initial || []) {
      if (!item?.lead) continue;
      if (item.projectLink) initialLeadByLink.set(item.projectLink, true);
      if (item.projectName) initialLeadByName.set(item.projectName, true);
    }

    for (const item of rounds || []) {
      roundNames.add(item.projectName);
      const key = `${item.projectLink}|${item.round || "--"}`;
      const mergedItem = {
        ...item,
        lead: Boolean(item.lead || initialLeadByLink.get(item.projectLink) || initialLeadByName.get(item.projectName)),
      };
      if (!resultMap.has(key)) resultMap.set(key, mergedItem);
      else if (!resultMap.get(key).lead && mergedItem.lead) resultMap.set(key, mergedItem);
    }

    for (const item of initial || []) {
      if (roundNames.has(item.projectName)) continue;
      const key = `${item.projectLink}|--`;
      if (!resultMap.has(key)) {
        resultMap.set(key, {
          ...item,
          round: "--",
          amount: null,
          valuation: null,
          date: null,
        });
      }
    }

    return Array.from(resultMap.values());
  }

  function findInvestmentProjectScopes(doc) {
    const scopes = [];
    const pushScope = (scope) => {
      if (!scope || scopes.some((existing) => existing === scope || existing.contains(scope))) return;
      for (let index = scopes.length - 1; index >= 0; index -= 1) {
        if (scope.contains(scopes[index])) scopes.splice(index, 1);
      }
      scopes.push(scope);
    };

    // 旧版 RootData 投资模块。
    Array.from(doc.querySelectorAll(".investment")).forEach(pushScope);

    // 新版 Project 页：Financials -> Investment 模块，例如 Coinbase。
    Array.from(doc.querySelectorAll("#detail_section_financials_investment")).forEach(pushScope);

    // 新版 Investor 页：Overview 内的明确 Investment/Portfolio 区块，例如 YZi Labs。
    Array.from(doc.querySelectorAll("section")).forEach((section) => {
      const heading = cleanText(section.querySelector("h1, h2, h3, h4, [role='heading']")?.textContent);
      if (!/^Investment$/i.test(heading)) return;

      const hasPortfolioTab = Array.from(section.querySelectorAll("button, [role='tab']"))
        .some((button) => /^Portfolio$/i.test(cleanText(button.textContent)));
      if (!hasPortfolioTab) return;

      const hasProjectLinks = section.querySelector(
        'a[href*="/projects/detail/"], a[href*="/Projects/detail/"]'
      );
      if (!hasProjectLinks) return;

      pushScope(section);
    });

    return scopes;
  }

  function parseInvestmentItems(doc, detailUrl) {
    // 对外投资只读 RootData 明确的投资模块；不要用关键词兜底扫描。
    // 否则融资表/新闻/翻译字典里出现 Investment、Portfolio 等词时，很容易把投资方误写成“对外投资项目”。
    return uniqueByLink(
      findInvestmentProjectScopes(doc).flatMap((scope) =>
        collectEntityLinks(scope, detailUrl, { allowProjects: true, allowInvestors: false })
      )
    );
  }

  function dispatchUserClick(doc, element) {
    const view = doc.defaultView || window;
    const PointerEventCtor = view.PointerEvent || PointerEvent;
    const MouseEventCtor = view.MouseEvent || MouseEvent;
    ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
      const Ctor = type.startsWith("pointer") ? PointerEventCtor : MouseEventCtor;
      element.dispatchEvent(new Ctor(type, { view, bubbles: true, cancelable: true }));
    });
    if (typeof element.click === "function") element.click();
  }

  function clickButtonsByText(doc, regex) {
    Array.from(doc.querySelectorAll("button, [role='tab']")).forEach((button) => {
      if (!regex.test(cleanText(button.textContent))) return;
      dispatchUserClick(doc, button);
    });
  }

  async function expandInvestmentProjectScopes(doc) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const buttons = findInvestmentProjectScopes(doc).flatMap((scope) =>
        Array.from(scope.querySelectorAll("button"))
          .filter((button) => /show\s*more/i.test(cleanText(button.textContent)))
      );
      if (!buttons.length) return;
      buttons.forEach((button) => dispatchUserClick(doc, button));
      await sleep(900);
    }
  }

  async function clickRoundsTab(doc) {
    const candidates = Array.from(doc.querySelectorAll("button, [role='tab']"));
    const roundsTab = candidates.find((button) => /^rounds$/i.test(cleanText(button.textContent)));
    if (!roundsTab) return false;

    const alreadyActive =
      roundsTab.getAttribute("aria-selected") === "true" ||
      roundsTab.getAttribute("data-state") === "active";
    if (!alreadyActive) dispatchUserClick(doc, roundsTab);

    const start = Date.now();
    while (Date.now() - start < 4000) {
      if (findFundraisingRoundTables(doc).length > 0) return true;
      await sleep(300);
    }
    return findFundraisingRoundTables(doc).length > 0;
  }

  async function scrapeInvestedProjectsFromDetail(doc, detailUrl) {
    if (findInvestmentProjectScopes(doc).length > 0) {
      clickButtonsByText(doc, /portfolio/i);
      await sleep(1800);
      await expandInvestmentProjectScopes(doc);
    }
    const portfolio = parseInvestmentItems(doc, detailUrl);

    let vc = [];
    if (findInvestmentProjectScopes(doc).length > 0 && /\/(?:investors|Investors)\/detail\//.test(detailUrl)) {
      clickButtonsByText(doc, /\bvc\b/i);
      await sleep(1800);
      await expandInvestmentProjectScopes(doc);
      vc = parseInvestmentItems(doc, detailUrl);
    }

    return uniqueByLink([...portfolio, ...vc]);
  }

  function isLikelyDetailSocialLink(link) {
    if (isNonEntityDetailScope(link)) return false;
    if (!isEntityInfoScope(link)) return false;

    const iconSrc = String(link?.querySelector?.("img")?.getAttribute("src") || "").toLowerCase();
    if (/detail_icon_|official_website|detail_icon_twitter|detail_icon_linkedin/.test(iconSrc)) return true;
    if (link.closest(".base_info .links, .base_info, [class*='base' i] [class*='link' i], [class*='social' i], [class*='contact' i]")) return true;
    return false;
  }


  // ============================================================================
  // SECTION 6: DETAIL BASIC PROFILE PARSER
  // - Social links, title/name, logo, team members, ready-state debug info
  // ============================================================================


  function normalizeTeamMember(member) {
    const profileLink = absoluteUrl(member?.profileLink || "");
    const name = cleanText(member?.name) || parseNameFromDetailUrl(profileLink);
    const position = cleanText(member?.position);
    const avatar = member?.avatar ? absoluteUrl(member.avatar) : "";
    const twitterUrl = member?.twitterUrl ? absoluteUrl(member.twitterUrl) : "";
    const linkedinUrl = member?.linkedinUrl ? absoluteUrl(member.linkedinUrl) : "";

    if (!name && !profileLink) return null;

    return {
      name,
      position,
      avatar,
      profileLink,
      ...(twitterUrl ? { twitterUrl } : {}),
      ...(linkedinUrl ? { linkedinUrl } : {}),
    };
  }

  function mergeTeamMembers(...groups) {
    const byKey = new Map();
    groups.flat().forEach((rawMember) => {
      const member = normalizeTeamMember(rawMember);
      if (!member) return;
      const key = (member.profileLink || member.name).toLowerCase();
      const existing = byKey.get(key) || {};
      byKey.set(key, { ...existing, ...member });
    });
    return Array.from(byKey.values()).slice(0, 200);
  }

  function parseLegacyTeamMembers(doc) {
    return Array.from(doc.querySelectorAll(".team_member .item, .team-member .item"))
      .map((member) => ({
        name: cleanText(member.querySelector(".content h2, h2")?.textContent),
        position: cleanText(member.querySelector(".content p, p")?.textContent),
        avatar: member.querySelector(".logo-wraper img, img")?.src || member.querySelector("img")?.src || "",
        profileLink: member.querySelector('a[href*="/member/"]')?.getAttribute("href") || member.querySelector("a.card, a[href]")?.getAttribute("href") || "",
      }));
  }

  function isTeamSectionTitle(text) {
    return /^(team|team members?|core team|founders?|团队|团队成员|核心团队|创始人)$/i.test(cleanText(text));
  }

  function findModernTeamSections(doc) {
    return Array.from(doc.querySelectorAll("section, [id*='team' i], [class*='team' i]"))
      .filter((section) => {
        if (!section.querySelector('a[href*="/member/"]')) return false;
        const title = cleanText(section.querySelector("h2, h3")?.textContent);
        const idClass = `${section.id || ""} ${section.className || ""}`;
        return isTeamSectionTitle(title) || /team/i.test(idClass);
      });
  }

  function parseModernTeamMembers(doc) {
    const sections = findModernTeamSections(doc);
    const roots = sections.length ? sections : [];

    return roots.flatMap((section) =>
      Array.from(section.querySelectorAll('a[href*="/member/"]')).map((link) => {
        const card = link.closest(".card-warp, [class*='card' i], li, article") || link.parentElement || link;
        const socialRoot = card;
        const name =
          cleanText(link.querySelector("p.truncate")?.textContent) ||
          cleanText(Array.from(link.querySelectorAll("p")).find((item) => /font-medium/.test(String(item.className || "")))?.textContent) ||
          cleanText(link.querySelector("h3, h4")?.textContent) ||
          cleanText(link.querySelector("img[alt]")?.getAttribute("alt")) ||
          parseNameFromDetailUrl(link.href);
        const position =
          cleanText(link.querySelector("p.line-clamp-2")?.textContent) ||
          cleanText(Array.from(link.querySelectorAll("p")).find((item) => cleanText(item.textContent) !== name)?.textContent);
        const avatar = link.querySelector("img[alt]")?.src || link.querySelector("img")?.src || "";
        let twitterUrl = "";
        let linkedinUrl = "";

        socialRoot.querySelectorAll('a[href^="http"]').forEach((socialLink) => {
          if (socialLink === link || socialLink.href.includes("/member/")) return;
          const type = inferSocialType(socialLink);
          if (type === "x" && !twitterUrl) twitterUrl = socialLink.href;
          if (type === "linkedin" && !linkedinUrl) linkedinUrl = socialLink.href;
        });

        return {
          name,
          position,
          avatar,
          profileLink: link.getAttribute("href") || link.href || "",
          twitterUrl,
          linkedinUrl,
        };
      })
    );
  }

  function parseTeamMembers(doc) {
    return mergeTeamMembers(parseLegacyTeamMembers(doc), parseModernTeamMembers(doc));
  }

  function parseBasicDetail(doc, detailUrl) {
    const socialLinks = {};
    const officialXUrl =
      findOfficialAsideXUrl(doc, detailUrl) ||
      findHeaderXUrl(doc) ||
      findTitleMatchedXUrl(doc, detailUrl) ||
      findNextFlightOfficialXUrl(doc) ||
      findRawHtmlTitleMatchedXUrl(doc, detailUrl);
    if (officialXUrl) socialLinks.x = officialXUrl;

    const nextFlightDetail = parseNextFlightDetailFields(doc);
    if (nextFlightDetail.linkedinUrl) socialLinks.linkedin = nextFlightDetail.linkedinUrl;
    if (nextFlightDetail.blogUrl) socialLinks.website = nextFlightDetail.blogUrl;

    const detailRoot = doc.querySelector("main") || doc.body || doc;
    detailRoot.querySelectorAll("a[href]").forEach((link) => {
      if (link.closest("aside")) return;
      if (!isLikelyDetailSocialLink(link)) return;
      if (isRootDataOwnedExternalLink(link)) return;

      const inferredType = inferSocialType(link);
      const labelType = cleanText(link.querySelector("span")?.textContent).toLowerCase();
      const type = /^(website|x|twitter|linkedin|discord|telegram|medium|github|docs?)$/.test(inferredType)
        ? inferredType
        : (labelType || inferredType);
      const href = link.href || "";
      if (!type || !/^https?:\/\//i.test(href)) return;
      if (/^https?:\/\/(?:www\.)?rootdata\.com\//i.test(href)) return;
      socialLinks[type] = href;
    });

    const safeSocialLinks = sanitizeParsedSocialLinks(socialLinks);

    const teamMembers = parseTeamMembers(doc);

    const projectName =
      getDetailTitle(doc) ||
      cleanText(doc.querySelector(".detail_info_head h1.name, .detail_info_head h1, h1.name")?.textContent) ||
      cleanText(doc.querySelector('meta[property="og:title"], meta[name="twitter:title"]')?.getAttribute("content")) ||
      cleanText(doc.title).replace(/\s*[-|]\s*RootData.*$/i, "") ||
      parseNameFromDetailUrl(detailUrl);
    const logo = pickEntityLogo(doc) || nextFlightDetail.headImg || "";

    return {
      socialLinks: safeSocialLinks,
      teamMembers,
      projectName: normalizeEntityName(projectName, detailUrl),
      logo,
    };
  }

  function parseDetailDocument(doc, detailUrl, { isInitial = true, dryRun = false, initialInvestors: preloadedInitialInvestors = null } = {}) {
    const basic = parseBasicDetail(doc, detailUrl);
    const isMemberDetail = isRootDataMemberUrl(detailUrl);
    // member 人物页只修基础资料（头像 / 官方 X），不能把 Work History / 相关项目误当成融资关系。
    const initialInvestors = isInitial && !isMemberDetail
      ? (Array.isArray(preloadedInitialInvestors) ? preloadedInitialInvestors : parseInitialInvestors(doc, detailUrl))
      : [];
    const roundsInvestors = isInitial && !isMemberDetail ? parseRoundsInvestors(doc, detailUrl) : [];
    const investors = isInitial && !isMemberDetail ? mergeInvestorData(initialInvestors, roundsInvestors) : [];
    const bodyText = cleanText(doc.body?.innerText || "");
    const rootDataEntityLinkCount = collectEntityLinks(doc, detailUrl).length;
    const detailShellFound =
      doc.querySelectorAll(
        ".detail_info_head, .base_info, .team_member, .team-member, .investor, .investment"
      ).length > 0 ||
      rootDataEntityLinkCount > 0 ||
      Object.keys(basic.socialLinks).length > 0;
    const detailDataFound =
      Boolean(basic.logo) ||
      Object.keys(basic.socialLinks).length > 0 ||
      basic.teamMembers.length > 0 ||
      investors.length > 0 ||
      doc.querySelectorAll(".investment .item, .investment a.card").length > 0 ||
      rootDataEntityLinkCount > 0;

    return {
      // 不能只靠 URL slug + bodyText 判定 ready，否则 Next/Vue 还没渲染详情内容时会过早入库空详情。
      ready: Boolean(basic.projectName) && detailShellFound && detailDataFound,
      dryRun,
      ...basic,
      investors,
      investedProjects: [],
      debug: {
        title: doc.title,
        bodyText: bodyText.slice(0, 300),
        detailShellFound,
        detailDataFound,
        rootDataEntityLinkCount,
        socialLinkKeys: Object.keys(basic.socialLinks),
        xLinkDebug: getXLinkDebug(doc, detailUrl),
        teamMembers: basic.teamMembers.length,
        investorItems: doc.querySelectorAll(".investor .item").length,
        investorRows: doc.querySelectorAll(".investor tr").length,
        roundTables: findFundraisingRoundTables(doc).length,
        roundsInvestors: roundsInvestors.length,
        investmentItems: doc.querySelectorAll(".investment .item").length,
        investmentSections: findInvestmentProjectScopes(doc).length,
      },
    };
  }

  async function crawlDetailPage(frame, item, { isInitial = true } = {}) {
    const detailUrl = canonicalRootDataDetailUrl(absoluteUrl(item.projectLink));
    const doc = await loadDetailDocument(frame, detailUrl);

    clickButtonsByText(doc, /expand\s*more/i);
    await sleep(800);

    const isMemberDetail = isRootDataMemberUrl(detailUrl);
    // 新版 RootData 的 Lead 标记只在 Fundraising -> Investors tab 的卡片上，
    // Rounds tab 表格里通常没有 Lead 信息；切换 Rounds 前先缓存 Investors tab。
    const investorsTabInvestors = isInitial && !isMemberDetail ? parseInitialInvestors(doc, detailUrl) : [];
    if (isInitial && !isMemberDetail) {
      await clickRoundsTab(doc);
      await sleep(600);
    }

    const details = parseDetailDocument(doc, detailUrl, { isInitial, initialInvestors: investorsTabInvestors });
    if (!isMemberDetail) {
      details.investedProjects = await scrapeInvestedProjectsFromDetail(doc, detailUrl);
    }

    if (!details.ready) {
      throw Object.assign(new Error("详情页未解析到有效数据"), { details: details.debug });
    }

    return {
      source: "tampermonkey",
      projectName: details.projectName || item.projectName || parseNameFromDetailUrl(detailUrl),
      projectLink: detailUrl,
      logo: details.logo || item.logo || "",
      socialLinks: details.socialLinks,
      teamMembers: details.teamMembers,
      investors: details.investors,
      investedProjects: details.investedProjects,
      isInitial,
      pageUrl: location.href,
      detailUrl,
      scrapedAt: nowIso(),
      debug: details.debug,
    };
  }

  function requestJson({ url, method = "POST", headers = {}, body }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: {
          "Content-Type": "application/json",
          "x-collector-client-token": CONFIG.CLIENT_TOKEN,
          ...headers,
        },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 15000,
        onload: (response) => {
          const text = response.responseText || "";
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch (_) {
            data = text;
          }

          if (response.status >= 200 && response.status < 300) resolve(data);
          else reject(new Error(`HTTP ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`));
        },
        onerror: reject,
        ontimeout: () => reject(new Error("request timeout")),
      });
    });
  }

  function buildUrlWithQuery(url, query = {}) {
    const target = new URL(url, location.origin);
    for (const [key, value] of Object.entries(query || {})) {
      if (value === null || value === undefined || value === "") continue;
      target.searchParams.set(key, String(value));
    }
    return target.toString();
  }

  async function sendAlert(payload) {
    const url = `${CONFIG.API_BASE}${CONFIG.ALERT_ENDPOINT}`;
    console.warn("[RootData Reader] sending alert:", payload);

    try {
      await requestJson({
        url,
        body: {
          source: "tampermonkey",
          eventType: "rootdata_fundraising_page_blocked",
          pageUrl: location.href,
          userAgent: navigator.userAgent,
          occurredAt: nowIso(),
          ...payload,
        },
      });
      console.log("[RootData Reader] alert sent");
      return true;
    } catch (error) {
      console.error("[RootData Reader] alert failed:", error);
      return false;
    }
  }

  async function testConnection({ silent = false } = {}) {
    const url = `${CONFIG.API_BASE}${CONFIG.PING_ENDPOINT}`;
    const startedAt = Date.now();

    if (!silent) {
      console.log("[RootData Reader] testing collector token connection:", {
        apiBase: CONFIG.API_BASE,
        endpoint: CONFIG.PING_ENDPOINT,
        tokenConfigured:
          Boolean(CONFIG.CLIENT_TOKEN) &&
          CONFIG.CLIENT_TOKEN !== "REPLACE_WITH_LONG_RANDOM_TOKEN",
      });
    }

    try {
      const result = await requestJson({ url, method: "GET" });
      const costMs = Date.now() - startedAt;
      console.log("[RootData Reader] ✅ token connection ok:", {
        costMs,
        result,
      });
      return { ok: true, costMs, result };
    } catch (error) {
      const costMs = Date.now() - startedAt;
      console.error("[RootData Reader] ❌ token connection failed:", {
        costMs,
        error: error.message,
        apiBase: CONFIG.API_BASE,
        endpoint: CONFIG.PING_ENDPOINT,
      });
      return { ok: false, costMs, error };
    }
  }


  // ============================================================================
  // SECTION 7: API CLIENT / SERVER SUBMISSION
  // - GM_xmlhttpRequest wrapper and submit/failure/cleanup endpoints
  // ============================================================================

  async function submitData(data, job) {
    return requestJson({
      url: `${CONFIG.API_BASE}${CONFIG.IMPORT_ENDPOINT}`,
      body: {
        source: "tampermonkey",
        page: 1,
        pageUrl: location.href,
        scheduleSlot: job?.slot || null,
        rows: data,
        scrapedAt: nowIso(),
      },
    });
  }

  async function submitDetailCleanup(items, job) {
    return requestJson({
      url: `${CONFIG.API_BASE}${CONFIG.DETAIL_CLEANUP_ENDPOINT}`,
      body: {
        source: "tampermonkey",
        scheduleSlot: job?.slot || null,
        pageUrl: location.href,
        items: normalizeRecrawlItems(items),
        scrapedAt: nowIso(),
      },
    });
  }

  async function fetchDetailQueue(phase, limit, job) {
    const url = buildUrlWithQuery(`${CONFIG.API_BASE}${CONFIG.DETAIL_QUEUE_ENDPOINT}`, {
      phase,
      limit,
      scheduleSlot: job?.slot || null,
    });
    const result = await requestJson({ url, method: "GET" });
    const items = normalizeRecrawlItems(result?.data?.items || []);
    console.log("[RootData Reader] detail queue fetched:", {
      phase,
      limit,
      count: items.length,
      serverCount: result?.data?.count,
      serverTime: result?.data?.serverTime,
    });
    return items;
  }

  async function submitDetailData(detail, job) {
    if (isDebugDetailTarget(detail)) {
      console.log("[RootData Reader][DEBUG Variational] submit detail payload:", summarizeDetailForDebug(detail));
    }

    const result = await requestJson({
      url: `${CONFIG.API_BASE}${CONFIG.DETAIL_IMPORT_ENDPOINT}`,
      body: {
        ...detail,
        scheduleSlot: job?.slot || null,
        forceRefreshInvestedRelationships: job?.forceRefreshInvestedRelationships === true,
        forceRefreshInvestmentRelationships: job?.forceRefreshInvestmentRelationships === true,
        cleanupWindowStart: job?.cleanupWindowStart || null,
      },
    });

    if (isDebugDetailTarget(detail)) {
      console.log("[RootData Reader][DEBUG Variational] detail import response:", result);
    }

    return result;
  }

  async function submitDetailFailure(item, job, error, { isInitial = true } = {}) {
    return requestJson({
      url: `${CONFIG.API_BASE}${CONFIG.DETAIL_FAILURE_ENDPOINT}`,
      body: {
        source: "tampermonkey",
        projectName: item?.projectName || parseNameFromDetailUrl(item?.projectLink || ""),
        projectLink: item?.projectLink || "",
        isInitial,
        scheduleSlot: job?.slot || null,
        pageUrl: location.href,
        error: error?.message || String(error || "detail crawl failed"),
        details: error?.details || null,
        scrapedAt: nowIso(),
      },
    });
  }


  function isRootDataMemberUrl(rawUrl) {
    const link = canonicalRootDataDetailUrl(absoluteUrl(rawUrl || ""));
    return /rootdata\.com\/member\//.test(link);
  }

  function isRootDataEntityDetailUrl(rawUrl, { allowInvestors = false } = {}) {
    const link = canonicalRootDataDetailUrl(absoluteUrl(rawUrl || ""));
    if (/rootdata\.com\/(?:projects|Projects)\/detail\//.test(link)) return true;
    if (allowInvestors && /rootdata\.com\/(?:investors|Investors)\/detail\//.test(link)) return true;
    if (allowInvestors && /rootdata\.com\/member\//.test(link)) return true;
    return false;
  }

  function buildDetailQueueFromRows(rows, { allowInvestors = false } = {}) {
    return uniqueByLink(rows)
      .filter((item) => isRootDataEntityDetailUrl(item.projectLink, { allowInvestors }))
      .slice(0, CONFIG.detailMaxProjectsPerRun);
  }

  function normalizeRecrawlItems(items) {
    const list = Array.isArray(items) ? items : [items];
    return uniqueByLink(
      list
        .map((item) => {
          const rawLink = typeof item === "string" ? item : item?.projectLink || item?.link || "";
          const projectLink = canonicalRootDataDetailUrl(absoluteUrl(rawLink));
          return {
            projectName:
              (typeof item === "object" && cleanText(item.projectName || item.name)) ||
              parseNameFromDetailUrl(projectLink),
            projectLink,
          };
        })
        .filter(
          (item) =>
            item.projectName &&
            (/rootdata\.com\/(?:projects|Projects|investors|Investors)\/detail\//.test(item.projectLink) ||
              /rootdata\.com\/member\//.test(item.projectLink))
        )
    );
  }

  function emptyDetailStats({ initialTotal = 0, subTotal = 0 } = {}) {
    return {
      enabled: true,
      initialTotal,
      initialSuccess: 0,
      initialFailed: 0,
      subTotal,
      subSuccess: 0,
      subFailed: 0,
      errors: [],
    };
  }

  function mergeDetailStats(base, patch) {
    return {
      enabled: true,
      initialTotal: Math.max(Number(base?.initialTotal || 0), Number(patch?.initialTotal || 0)),
      initialSuccess: Number(base?.initialSuccess || 0) + Number(patch?.initialSuccess || 0),
      initialFailed: Number(base?.initialFailed || 0) + Number(patch?.initialFailed || 0),
      subTotal: Math.max(Number(base?.subTotal || 0), Number(patch?.subTotal || 0)),
      subSuccess: Number(base?.subSuccess || 0) + Number(patch?.subSuccess || 0),
      subFailed: Number(base?.subFailed || 0) + Number(patch?.subFailed || 0),
      errors: [
        ...(base?.errors || []),
        ...(patch?.errors || []),
      ].slice(-CONFIG.maxStoredRecrawlErrors),
    };
  }

  function normalizeSubDetailItems(items) {
    return normalizeRecrawlItems(items)
      .filter((item) => isRootDataEntityDetailUrl(item.projectLink, { allowInvestors: true }))
      .slice(0, CONFIG.subDetailMaxProjectsPerRun);
  }

  function getJobMaxSub(job) {
    const value = Number(job?.maxSub);
    if (Number.isFinite(value)) return Math.max(0, value);
    return Math.max(0, Number(CONFIG.subDetailMaxProjectsPerRun || 0));
  }

  function normalizeSubDetailItemsForJob(items, job) {
    const maxSub = getJobMaxSub(job);
    if (maxSub <= 0) return [];
    return normalizeSubDetailItems(items).slice(0, maxSub);
  }

  function compactDetailJobForStorage(job) {
    const items = normalizeRecrawlItems(job?.items || []).slice(0, CONFIG.maxStoredDetailItems);
    const subItems = normalizeSubDetailItemsForJob(job?.subItems || [], job).slice(0, CONFIG.maxStoredDetailItems);
    const phase = job?.phase === "sub" ? "sub" : "initial";
    return {
      id: String(job?.id || `details-${Date.now()}`),
      slot: cleanText(job?.slot || "manual-console-details-batched"),
      reason: cleanText(job?.reason || "details_batched"),
      nextAction: job?.nextAction === "details_after_reload" ? "details_after_reload" : null,
      queueMode: job?.queueMode === "server" ? "server" : "local",
      loadMode: job?.loadMode === "iframe" ? "iframe" : "page",
      phase,
      cursor: Math.min(Math.max(0, Number(job?.cursor || 0)), items.length),
      subCursor: Math.min(Math.max(0, Number(job?.subCursor || 0)), subItems.length),
      batchSize: Math.max(1, Number(job?.batchSize || CONFIG.detailBatchSize || 10)),
      maxSub: getJobMaxSub(job),
      forceRefreshInvestedRelationships: job?.forceRefreshInvestedRelationships === true,
      forceRefreshInvestmentRelationships: job?.forceRefreshInvestmentRelationships === true,
      cleanupWindowStart: job?.cleanupWindowStart ? String(job.cleanupWindowStart).slice(0, 80) : null,
      items,
      subItems,
      stats: compactStatsForStorage(job?.stats, items.length) || emptyDetailStats({ initialTotal: items.length }),
      createdAt: job?.createdAt || nowIso(),
      updatedAt: job?.updatedAt || nowIso(),
      lastError: job?.lastError ? String(job.lastError).slice(0, 500) : null,
    };
  }


  // ============================================================================
  // SECTION 8: DETAIL / RECRAWL JOB ORCHESTRATION
  // - Current-tab and iframe detail crawl loops, batch resume, sub-detail crawl
  // ============================================================================

  function getDetailJob() {
    return safeJsonParse(localStorage.getItem(CONFIG.storageKeys.detailJob), null);
  }

  function setDetailJob(job) {
    const compactJob = compactDetailJobForStorage(job);
    try {
      localStorage.setItem(CONFIG.storageKeys.detailJob, JSON.stringify(compactJob));
    } catch (error) {
      // 详情任务只保存最小队列和统计；配额满时丢弃最近预览缓存与错误列表再重试。
      console.warn("[RootData Reader] detail job storage failed, pruning caches:", error);
      localStorage.removeItem(CONFIG.storageKeys.lastResult);
      compactJob.stats = compactStatsForStorage({ ...compactJob.stats, errors: [] }, compactJob.items.length);
      localStorage.setItem(CONFIG.storageKeys.detailJob, JSON.stringify(compactJob));
    }
  }

  function clearDetailJob() {
    localStorage.removeItem(CONFIG.storageKeys.detailJob);
  }

  function summarizeDetailJob(job) {
    if (!job) return null;
    return {
      id: job.id,
      slot: job.slot,
      phase: job.phase || "initial",
      queueMode: job.queueMode || "local",
      loadMode: job.loadMode || "page",
      cursor: Number(job.cursor || 0),
      total: Array.isArray(job.items) ? job.items.length : 0,
      subCursor: Number(job.subCursor || 0),
      subTotal: Array.isArray(job.subItems) ? job.subItems.length : 0,
      batchSize: job.batchSize,
      maxSub: job.maxSub,
      forceRefreshInvestedRelationships: job.forceRefreshInvestedRelationships === true,
      forceRefreshInvestmentRelationships: job.forceRefreshInvestmentRelationships === true,
      cleanupWindowStart: job.cleanupWindowStart || null,
      stats: job.stats || null,
      updatedAt: job.updatedAt || null,
      createdAt: job.createdAt || null,
      lastError: job.lastError || null,
    };
  }

  function summarizeRecrawlJob(job) {
    if (!job) return null;
    return {
      id: job.id,
      slot: job.slot,
      cursor: Number(job.cursor || 0),
      total: Array.isArray(job.items) ? job.items.length : 0,
      batchSize: job.batchSize,
      maxSub: job.maxSub,
      forceRefreshInvestedRelationships: job.forceRefreshInvestedRelationships === true,
      forceRefreshInvestmentRelationships: job.forceRefreshInvestmentRelationships === true,
      cleanupWindowStart: job.cleanupWindowStart || null,
      stats: job.stats || null,
      updatedAt: job.updatedAt || null,
      createdAt: job.createdAt || null,
      lastError: job.lastError || null,
    };
  }

  async function runRecrawlBatchJob(job) {
    if (!job || !Array.isArray(job.items) || !job.items.length) {
      clearRecrawlJob();
      return { ok: false, error: "empty_recrawl_job" };
    }

    if ((job.loadMode || CONFIG.detailLoadMode) === "page") {
      const detailJob = {
        id: `${job.id || "recrawl"}-page`,
        slot: job.slot || "manual-console-recrawl-details-page",
        reason: "manual_console_recrawl_details_page",
        nextAction: "details_after_reload",
        queueMode: "local",
        loadMode: "page",
        phase: "initial",
        cursor: Math.max(0, Number(job.cursor || 0)),
        subCursor: 0,
        batchSize: Math.max(1, Number(job.batchSize || CONFIG.detailBatchSize || 10)),
        maxSub: getJobMaxSub(job),
        forceRefreshInvestedRelationships: job.forceRefreshInvestedRelationships === true,
        forceRefreshInvestmentRelationships: job.forceRefreshInvestmentRelationships === true,
        cleanupWindowStart: job.cleanupWindowStart || null,
        items: normalizeRecrawlItems(job.items || []),
        subItems: [],
        stats: job.stats || emptyDetailStats({ initialTotal: job.items.length }),
        createdAt: job.createdAt || nowIso(),
        updatedAt: nowIso(),
      };
      clearRecrawlJob();
      setDetailJob(detailJob);
      console.log("[RootData Reader] recrawl job converted to current-tab detail job:", summarizeDetailJob(detailJob));
      return runDetailBatchJob(detailJob);
    }

    const total = job.items.length;
    const cursor = Math.max(0, Number(job.cursor || 0));
    const batchSize = Math.max(1, Number(job.batchSize || 10));
    const batch = job.items.slice(cursor, cursor + batchSize);

    if (!batch.length) {
      clearRecrawlJob();
      releaseDetailResources();
      renderPanel({
        ok: true,
        status: "recrawl_batched_done_reloading",
        retryCount: 0,
        data: job.items,
        detailStats: job.stats || null,
      });
      reloadAfterRelease("recrawl_batched_done_empty_batch");
      return { ok: true, done: true, stats: job.stats || null };
    }

    const batchNo = Math.floor(cursor / batchSize) + 1;
    const batchTotal = Math.ceil(total / batchSize);
    const batchJob = {
      id: `${job.id}-batch-${batchNo}`,
      slot: job.slot || "manual-console-recrawl-details-batched",
      reason: "manual_console_recrawl_details_batched",
      retryCount: 0,
      createdAt: nowIso(),
      batchNo,
      batchTotal,
      forceRefreshInvestedRelationships: job.forceRefreshInvestedRelationships === true,
      forceRefreshInvestmentRelationships: job.forceRefreshInvestmentRelationships === true,
      cleanupWindowStart: job.cleanupWindowStart || null,
    };

    renderPanel({
      ok: true,
      status: `recrawl_batch:${batchNo}/${batchTotal} items:${cursor + 1}-${cursor + batch.length}/${total}`,
      retryCount: 0,
      data: batch,
      detailStats: job.stats || null,
    });

    const oldMaxInitial = CONFIG.detailMaxProjectsPerRun;
    const oldMaxSub = CONFIG.subDetailMaxProjectsPerRun;
    CONFIG.detailMaxProjectsPerRun = batch.length;
    CONFIG.subDetailMaxProjectsPerRun = Math.max(0, Number(job.maxSub || 0));

    let batchStats = null;
    try {
      batchStats = await crawlDetailsForRows(batch, batchJob, { allowInvestors: true });
    } catch (error) {
      batchStats = {
        enabled: true,
        initialTotal: batch.length,
        initialSuccess: 0,
        initialFailed: batch.length,
        subTotal: 0,
        subSuccess: 0,
        subFailed: 0,
        errors: batch.map((item) => ({
          projectName: item.projectName,
          projectLink: item.projectLink,
          error: error.message,
        })),
      };
      console.error("[RootData Reader] recrawl batch crashed:", error);
    } finally {
      CONFIG.detailMaxProjectsPerRun = oldMaxInitial;
      CONFIG.subDetailMaxProjectsPerRun = oldMaxSub;
    }

    const stats = {
      enabled: true,
      initialTotal: total,
      initialSuccess: Number(job.stats?.initialSuccess || 0) + Number(batchStats?.initialSuccess || 0),
      initialFailed: Number(job.stats?.initialFailed || 0) + Number(batchStats?.initialFailed || 0),
      subTotal: Number(job.stats?.subTotal || 0) + Number(batchStats?.subTotal || 0),
      subSuccess: Number(job.stats?.subSuccess || 0) + Number(batchStats?.subSuccess || 0),
      subFailed: Number(job.stats?.subFailed || 0) + Number(batchStats?.subFailed || 0),
      errors: [
        ...(job.stats?.errors || []),
        ...(batchStats?.errors || []),
      ].slice(-CONFIG.maxStoredRecrawlErrors),
    };

    const nextCursor = cursor + batch.length;
    const nextJob = {
      ...job,
      cursor: nextCursor,
      stats,
      lastBatchStats: batchStats,
      nextAction: "recrawl_after_reload",
      updatedAt: nowIso(),
    };

    if (nextCursor >= total) {
      clearRecrawlJob();
      releaseDetailResources();
      renderPanel({
        ok: true,
        status: "recrawl_batched_done_reloading",
        retryCount: 0,
        data: job.items,
        detailStats: stats,
      });
      console.log("[RootData Reader] ✅ recrawl batched done:", stats);
      reloadAfterRelease("recrawl_batched_done");
      return { ok: true, done: true, stats };
    }

    setRecrawlJob(nextJob);
    renderPanel({
      ok: true,
      status: `recrawl_batch_done_reloading:${nextCursor}/${total}`,
      retryCount: 0,
      data: batch,
      detailStats: stats,
    });
    console.log("[RootData Reader] recrawl batch done, reload to continue:", summarizeRecrawlJob(nextJob));
    reloadAfterRelease("recrawl_batch_continue");
    return { ok: true, done: false, nextCursor, total, stats };
  }

  async function crawlDetailItemsBatch(items, job, {
    isInitial = true,
    rowsForPanel = items,
    stats = emptyDetailStats(),
    globalOffset = 0,
    globalTotal = items.length,
    statusPrefix = isInitial ? "details_batch" : "sub_details_batch",
  } = {}) {
    const frame = ensureDetailFrame();
    const batchStats = emptyDetailStats({
      initialTotal: isInitial ? items.length : 0,
      subTotal: isInitial ? 0 : items.length,
    });
    const discoveredSubItems = [];

    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        renderPanel({
          ok: true,
          status: `${statusPrefix}:${globalOffset + index + 1}/${globalTotal}`,
          retryCount: job.retryCount || 0,
          data: rowsForPanel,
          detailStats: stats,
        });

        try {
          const detail = await crawlDetailPage(frame, item, { isInitial });
          const submitJob = isInitial
            ? job
            : { ...job, forceRefreshInvestedRelationships: false, forceRefreshInvestmentRelationships: false, cleanupWindowStart: null };
          await submitDetailData(detail, submitJob);

          if (isInitial) {
            batchStats.initialSuccess += 1;
            for (const investor of detail.investors || []) {
              if (!investor.projectLink) continue;
              discoveredSubItems.push({
                projectName: investor.projectName,
                projectLink: investor.projectLink,
              });
            }
          } else {
            batchStats.subSuccess += 1;
          }

          console.log(isInitial ? "[RootData Reader] ✅ detail imported:" : "[RootData Reader] ✅ sub detail imported:", {
            projectName: detail.projectName,
            investors: detail.investors.length,
            investedProjects: detail.investedProjects.length,
          });
        } catch (error) {
          if (isInitial) batchStats.initialFailed += 1;
          else batchStats.subFailed += 1;

          batchStats.errors.push({ projectName: item.projectName, projectLink: item.projectLink, error: error.message });
          console.error(isInitial ? "[RootData Reader] detail failed:" : "[RootData Reader] sub detail failed:", item, error);
          try {
            await submitDetailFailure(item, job, error, { isInitial });
          } catch (failureError) {
            console.error("[RootData Reader] detail failure report failed:", failureError);
          }
        }

        await sleep(CONFIG.detailBetweenMs);
      }

      return {
        stats: batchStats,
        discoveredSubItems: normalizeSubDetailItemsForJob(discoveredSubItems, job),
      };
    } finally {
      removeDetailFrame();
    }
  }

  function getCurrentDetailJobItem(job) {
    if (!job) return null;
    if (job.phase === "sub") {
      const subItems = normalizeSubDetailItemsForJob(job.subItems || [], job);
      return {
        item: subItems[Math.max(0, Number(job.subCursor || 0))] || null,
        index: Math.max(0, Number(job.subCursor || 0)),
        total: subItems.length,
        isInitial: false,
        items: subItems,
      };
    }

    const items = normalizeRecrawlItems(job.items || []).slice(0, CONFIG.detailMaxProjectsPerRun);
    return {
      item: items[Math.max(0, Number(job.cursor || 0))] || null,
      index: Math.max(0, Number(job.cursor || 0)),
      total: items.length,
      isInitial: true,
      items,
    };
  }

  async function waitForCurrentDetailDocument(detailUrl, { isInitial = true } = {}) {
    const start = Date.now();
    let lastDetails = null;
    let readyAt = 0;
    const isMemberDetail = isRootDataMemberUrl(detailUrl);

    while (Date.now() - start < CONFIG.detailFrameTimeoutMs) {
      const blocked = detectBlockedDocument(document, detailUrl);
      if (blocked.blocked && blocked.reason !== "blank_page") {
        throw Object.assign(new Error(`详情页异常：${blocked.reason}`), { details: blocked });
      }

      lastDetails = parseDetailDocument(document, detailUrl, { isInitial, dryRun: true });
      const hasSocialLinks = (lastDetails.debug?.socialLinkKeys || []).length > 0;
      if (lastDetails.ready) {
        if (hasSocialLinks) return document;
        if (!readyAt) readyAt = Date.now();
        const socialWaitMs = isMemberDetail ? 5000 : 2500;
        if (Date.now() - readyAt > socialWaitMs) return document;
      }

      await sleep(CONFIG.detailFramePollIntervalMs);
    }

    throw Object.assign(new Error(`详情页等待超时：${detailUrl}`), {
      details: {
        reason: "timeout_current_detail_page",
        url: location.href,
        title: document.title,
        bodyText: cleanText(document.body?.innerText || "").slice(0, 1000),
        htmlLength: (document.documentElement?.outerHTML || "").length,
        lastDetails,
      },
    });
  }

  async function crawlCurrentDetailPage(item, { isInitial = true } = {}) {
    const detailUrl = canonicalRootDataDetailUrl(absoluteUrl(item.projectLink));
    await waitForCurrentDetailDocument(detailUrl, { isInitial });

    clickButtonsByText(document, /expand\s*more/i);
    await sleep(800);

    const isMemberDetail = isRootDataMemberUrl(detailUrl);
    // 新版 RootData 的 Lead 标记只在 Fundraising -> Investors tab 的卡片上，
    // Rounds tab 表格里通常没有 Lead 信息；切换 Rounds 前先缓存 Investors tab。
    const investorsTabInvestors = isInitial && !isMemberDetail ? parseInitialInvestors(document, detailUrl) : [];
    if (isInitial && !isMemberDetail) {
      await clickRoundsTab(document);
      await sleep(600);
    }

    const details = parseDetailDocument(document, detailUrl, { isInitial, initialInvestors: investorsTabInvestors });
    if (!isMemberDetail) {
      details.investedProjects = await scrapeInvestedProjectsFromDetail(document, detailUrl);
    }

    if (!details.ready) {
      throw Object.assign(new Error("详情页未解析到有效数据"), { details: details.debug });
    }

    return {
      source: "tampermonkey",
      projectName: details.projectName || item.projectName || parseNameFromDetailUrl(detailUrl),
      projectLink: detailUrl,
      logo: details.logo || item.logo || "",
      socialLinks: details.socialLinks,
      teamMembers: details.teamMembers,
      investors: details.investors,
      investedProjects: details.investedProjects,
      isInitial,
      pageUrl: location.href,
      detailUrl,
      scrapedAt: nowIso(),
      debug: details.debug,
    };
  }

  async function runDetailPageJob(job) {
    if (!CONFIG.detailEnabled) {
      clearDetailJob();
      navigateTo(CONFIG.FUNDRAISING_URL, "details_disabled");
      return { ok: false, error: "details_disabled" };
    }

    const current = getCurrentDetailJobItem(job);
    if (!current?.item) {
      clearDetailJob();
      navigateTo(CONFIG.FUNDRAISING_URL, "empty_detail_page_job");
      return { ok: false, error: "empty_detail_page_job" };
    }

    const targetUrl = canonicalRootDataDetailUrl(absoluteUrl(current.item.projectLink));
    const currentUrl = canonicalRootDataDetailUrl(location.href);
    if (!isDetailPage() || currentUrl !== targetUrl) {
      renderPanel({
        ok: true,
        status: `${current.isInitial ? "details" : "sub_details"}_navigate:${current.index + 1}/${current.total}`,
        retryCount: 0,
        data: current.items,
        detailStats: job.stats || null,
      });
      navigateTo(targetUrl, "detail_page_job_next_item");
      return { ok: true, navigating: true, targetUrl };
    }

    const stats = job.stats || emptyDetailStats({
      initialTotal: current.isInitial ? current.total : Number(job.stats?.initialTotal || 0),
      subTotal: current.isInitial ? 0 : current.total,
    });
    renderPanel({
      ok: true,
      status: `${current.isInitial ? "details_page" : "sub_details_page"}:${current.index + 1}/${current.total}`,
      retryCount: 0,
      data: current.items,
      detailStats: stats,
    });

    const patchStats = emptyDetailStats({
      initialTotal: current.isInitial ? 1 : 0,
      subTotal: current.isInitial ? 0 : 1,
    });
    let discoveredSubItems = [];

    try {
      const detail = await crawlCurrentDetailPage(current.item, { isInitial: current.isInitial });
      const submitJob = current.isInitial
        ? job
        : { ...job, forceRefreshInvestedRelationships: false, forceRefreshInvestmentRelationships: false, cleanupWindowStart: null };
      await submitDetailData(detail, submitJob);
      if (current.isInitial) {
        patchStats.initialSuccess = 1;
        discoveredSubItems = normalizeSubDetailItemsForJob((detail.investors || []).map((investor) => ({
          projectName: investor.projectName,
          projectLink: investor.projectLink,
        })), job);
      } else {
        patchStats.subSuccess = 1;
      }
      console.log(current.isInitial ? "[RootData Reader] ✅ detail imported:" : "[RootData Reader] ✅ sub detail imported:", detail.projectName);
    } catch (error) {
      if (current.isInitial) patchStats.initialFailed = 1;
      else patchStats.subFailed = 1;
      patchStats.errors.push({
        projectName: current.item.projectName,
        projectLink: current.item.projectLink,
        error: error.message,
      });
      console.error(current.isInitial ? "[RootData Reader] detail failed:" : "[RootData Reader] sub detail failed:", current.item, error);
      try {
        await submitDetailFailure(current.item, job, error, { isInitial: current.isInitial });
      } catch (failureError) {
        console.error("[RootData Reader] detail failure report failed:", failureError);
      }
    }

    const nextStats = mergeDetailStats(stats, patchStats);

    if (current.isInitial) {
      const nextCursor = current.index + 1;
      nextStats.initialTotal = current.total;

      if (nextCursor < current.total) {
        const nextJob = {
          ...job,
          items: current.items,
          subItems: job.queueMode === "server" ? [] : normalizeSubDetailItemsForJob([...(job.subItems || []), ...discoveredSubItems], job),
          cursor: nextCursor,
          stats: nextStats,
          nextAction: "details_after_reload",
          updatedAt: nowIso(),
        };
        setDetailJob(nextJob);
        if (nextCursor % Math.max(1, Number(job.batchSize || CONFIG.detailBatchSize || 10)) === 0) {
          navigateTo(CONFIG.FUNDRAISING_URL, "detail_page_batch_refresh");
        } else {
          const nextItem = current.items[nextCursor];
          navigateTo(canonicalRootDataDetailUrl(absoluteUrl(nextItem.projectLink)), "detail_page_next_initial");
        }
        return { ok: true, done: false, stats: nextStats };
      }

      let subItems = [];
      if (job.queueMode === "server") {
        try {
          subItems = await fetchDetailQueue("sub", getJobMaxSub(job), job);
        } catch (error) {
          console.error("[RootData Reader] fetch sub queue failed after current-tab initial phase, fallback to discovered sub items:", error);
          subItems = normalizeSubDetailItemsForJob([...(job.subItems || []), ...discoveredSubItems], job);
        }
      } else {
        subItems = normalizeSubDetailItemsForJob([...(job.subItems || []), ...discoveredSubItems], job);
      }

      nextStats.subTotal = subItems.length;
      if (!subItems.length) {
        clearDetailJob();
        renderPanel({ ok: true, status: "details_page_done_reloading", retryCount: 0, data: current.items, detailStats: nextStats });
        navigateTo(CONFIG.FUNDRAISING_URL, "detail_page_done_no_sub");
        return { ok: true, done: true, stats: nextStats };
      }

      const nextJob = {
        ...job,
        items: current.items,
        subItems,
        phase: "sub",
        cursor: nextCursor,
        subCursor: 0,
        stats: nextStats,
        nextAction: "details_after_reload",
        updatedAt: nowIso(),
      };
      setDetailJob(nextJob);
      navigateTo(CONFIG.FUNDRAISING_URL, "detail_page_start_sub_after_refresh");
      return { ok: true, done: false, phase: "sub", stats: nextStats };
    }

    const nextSubCursor = current.index + 1;
    nextStats.subTotal = current.total;

    if (nextSubCursor >= current.total) {
      clearDetailJob();
      renderPanel({ ok: true, status: "sub_details_page_done_reloading", retryCount: 0, data: current.items, detailStats: nextStats });
      navigateTo(CONFIG.FUNDRAISING_URL, "sub_detail_page_done");
      return { ok: true, done: true, stats: nextStats };
    }

    const nextJob = {
      ...job,
      subItems: current.items,
      subCursor: nextSubCursor,
      stats: nextStats,
      nextAction: "details_after_reload",
      updatedAt: nowIso(),
    };
    setDetailJob(nextJob);
    if (nextSubCursor % Math.max(1, Number(job.batchSize || CONFIG.detailBatchSize || 10)) === 0) {
      navigateTo(CONFIG.FUNDRAISING_URL, "sub_detail_page_batch_refresh");
    } else {
      const nextItem = current.items[nextSubCursor];
      navigateTo(canonicalRootDataDetailUrl(absoluteUrl(nextItem.projectLink)), "detail_page_next_sub");
    }
    return { ok: true, done: false, stats: nextStats };
  }

  async function runDetailBatchJob(job) {
    if ((job?.loadMode || CONFIG.detailLoadMode) === "page") {
      return runDetailPageJob(job);
    }

    if (!CONFIG.detailEnabled) {
      clearDetailJob();
      reloadAfterRelease("details_disabled");
      return { ok: false, error: "details_disabled" };
    }

    const phase = job?.phase === "sub" ? "sub" : "initial";
    if (
      !job ||
      (
        phase !== "sub" &&
        (!Array.isArray(job.items) || !job.items.length)
      )
    ) {
      clearDetailJob();
      reloadAfterRelease("empty_detail_job");
      return { ok: false, error: "empty_detail_job" };
    }

    const batchSize = Math.max(1, Number(job.batchSize || CONFIG.detailBatchSize || 10));
    const initialItems = normalizeRecrawlItems(job.items).slice(0, CONFIG.detailMaxProjectsPerRun);
    const stats = job.stats || emptyDetailStats({ initialTotal: initialItems.length });

    if (phase === "initial") {
      const cursor = Math.max(0, Number(job.cursor || 0));
      const batch = initialItems.slice(cursor, cursor + batchSize);
      const batchNo = Math.floor(cursor / batchSize) + 1;
      const batchTotal = Math.ceil(initialItems.length / batchSize);

      if (batch.length) {
        const batchJob = {
          ...job,
          id: `${job.id}-initial-${batchNo}`,
          batchNo,
          batchTotal,
          retryCount: 0,
        };
        const result = await crawlDetailItemsBatch(batch, batchJob, {
          isInitial: true,
          rowsForPanel: initialItems,
          stats,
          globalOffset: cursor,
          globalTotal: initialItems.length,
          statusPrefix: `details_batch:${batchNo}/${batchTotal}`,
        });

        const nextCursor = cursor + batch.length;
        const discoveredSubItems = normalizeSubDetailItemsForJob([...(job.subItems || []), ...result.discoveredSubItems], job);
        const nextStats = mergeDetailStats(stats, result.stats);
        nextStats.initialTotal = initialItems.length;

        if (nextCursor < initialItems.length) {
          const nextJob = {
            ...job,
            items: initialItems,
            // server queue 模式下第三步 subDetailsCrawl 必须等 initial 全部跑完后再从接口取；
            // 本地模式才需要跨批次累积页面中发现的投资方。
            subItems: job.queueMode === "server" ? [] : discoveredSubItems,
            cursor: nextCursor,
            stats: nextStats,
            nextAction: "details_after_reload",
            updatedAt: nowIso(),
          };
          setDetailJob(nextJob);
          renderPanel({
            ok: true,
            status: `details_batch_done_reloading:${nextCursor}/${initialItems.length}`,
            retryCount: 0,
            data: batch,
            detailStats: nextStats,
          });
          console.log("[RootData Reader] details initial batch done, reload to continue:", summarizeDetailJob(nextJob));
          reloadAfterRelease("details_initial_batch_continue");
          return { ok: true, done: false, phase: "initial", nextCursor, total: initialItems.length, stats: nextStats };
        }

        let subItems = [];
        if (job.queueMode === "server") {
          try {
            subItems = await fetchDetailQueue("sub", getJobMaxSub(job), job);
          } catch (error) {
            console.error("[RootData Reader] fetch sub queue failed after initial phase, fallback to discovered sub items:", error);
            subItems = discoveredSubItems;
          }
        } else {
          subItems = discoveredSubItems;
        }
        nextStats.subTotal = subItems.length;
        const nextJob = {
          ...job,
          items: initialItems,
          subItems,
          phase: "sub",
          cursor: nextCursor,
          subCursor: 0,
          stats: nextStats,
          nextAction: "details_after_reload",
          updatedAt: nowIso(),
        };

        if (!subItems.length) {
          clearDetailJob();
          renderPanel({
            ok: true,
            status: "details_batched_done_reloading",
            retryCount: 0,
            data: initialItems,
            detailStats: nextStats,
          });
          console.log("[RootData Reader] ✅ details batched done without sub queue:", nextStats);
          reloadAfterRelease("details_batched_done_no_sub");
          return { ok: true, done: true, stats: nextStats };
        }

        setDetailJob(nextJob);
        renderPanel({
          ok: true,
          status: `details_initial_done_reloading_sub_queue:${subItems.length}`,
          retryCount: 0,
          data: batch,
          detailStats: nextStats,
        });
        console.log("[RootData Reader] details initial phase done, reload for sub details:", summarizeDetailJob(nextJob));
        reloadAfterRelease("details_initial_done_start_sub");
        return { ok: true, done: false, phase: "sub", stats: nextStats };
      }
    }

    const subItems = normalizeSubDetailItemsForJob(job.subItems || [], job);
    const subCursor = Math.max(0, Number(job.subCursor || 0));
    const subBatch = subItems.slice(subCursor, subCursor + batchSize);

    if (!subBatch.length) {
      clearDetailJob();
      const finalStats = { ...stats, initialTotal: initialItems.length, subTotal: subItems.length };
      renderPanel({
        ok: true,
        status: "details_batched_done_reloading",
        retryCount: 0,
        data: initialItems,
        detailStats: finalStats,
      });
      console.log("[RootData Reader] ✅ details batched done:", finalStats);
      reloadAfterRelease("details_batched_done");
      return { ok: true, done: true, stats: finalStats };
    }

    const subBatchNo = Math.floor(subCursor / batchSize) + 1;
    const subBatchTotal = Math.ceil(subItems.length / batchSize);
    const subJob = {
      ...job,
      id: `${job.id}-sub-${subBatchNo}`,
      batchNo: subBatchNo,
      batchTotal: subBatchTotal,
      retryCount: 0,
    };
    const subResult = await crawlDetailItemsBatch(subBatch, subJob, {
      isInitial: false,
      rowsForPanel: subBatch,
      stats,
      globalOffset: subCursor,
      globalTotal: subItems.length,
      statusPrefix: `sub_details_batch:${subBatchNo}/${subBatchTotal}`,
    });
    const nextSubCursor = subCursor + subBatch.length;
    const nextStats = mergeDetailStats(stats, subResult.stats);
    nextStats.initialTotal = initialItems.length;
    nextStats.subTotal = subItems.length;

    if (nextSubCursor >= subItems.length) {
      clearDetailJob();
      renderPanel({
        ok: true,
        status: "details_batched_done_reloading",
        retryCount: 0,
        data: initialItems,
        detailStats: nextStats,
      });
      console.log("[RootData Reader] ✅ details batched done:", nextStats);
      reloadAfterRelease("details_batched_done");
      return { ok: true, done: true, stats: nextStats };
    }

    const nextJob = {
      ...job,
      items: initialItems,
      subItems,
      phase: "sub",
      subCursor: nextSubCursor,
      stats: nextStats,
      nextAction: "details_after_reload",
      updatedAt: nowIso(),
    };
    setDetailJob(nextJob);
    renderPanel({
      ok: true,
      status: `sub_details_batch_done_reloading:${nextSubCursor}/${subItems.length}`,
      retryCount: 0,
      data: subBatch,
      detailStats: nextStats,
    });
    console.log("[RootData Reader] sub details batch done, reload to continue:", summarizeDetailJob(nextJob));
    reloadAfterRelease("details_sub_batch_continue");
    return { ok: true, done: false, phase: "sub", nextSubCursor, total: subItems.length, stats: nextStats };
  }

  async function crawlDetailsForRows(rows, job, options = {}) {
    if (!CONFIG.detailEnabled) {
      return { enabled: false, initialSuccess: 0, initialFailed: 0, subSuccess: 0, subFailed: 0 };
    }

    const frame = ensureDetailFrame();
    const initialQueue = buildDetailQueueFromRows(rows, options);
    const subDetailMap = new Map();
    const stats = {
      enabled: true,
      initialTotal: initialQueue.length,
      initialSuccess: 0,
      initialFailed: 0,
      subTotal: 0,
      subSuccess: 0,
      subFailed: 0,
      errors: [],
    };

    try {
      for (let index = 0; index < initialQueue.length; index += 1) {
        const item = initialQueue[index];
        renderPanel({
          ok: true,
          status: `details:${index + 1}/${initialQueue.length}`,
          retryCount: job.retryCount || 0,
          data: rows,
          detailStats: stats,
        });

        try {
          const detail = await crawlDetailPage(frame, item, { isInitial: true });
          await submitDetailData(detail, job);
          stats.initialSuccess += 1;

          for (const investor of detail.investors || []) {
            if (!investor.projectLink || subDetailMap.has(investor.projectLink)) continue;
            subDetailMap.set(investor.projectLink, {
              projectName: investor.projectName,
              projectLink: investor.projectLink,
            });
          }

          console.log("[RootData Reader] ✅ detail imported:", {
            projectName: detail.projectName,
            investors: detail.investors.length,
            investedProjects: detail.investedProjects.length,
          });
        } catch (error) {
          stats.initialFailed += 1;
          stats.errors.push({ projectName: item.projectName, projectLink: item.projectLink, error: error.message });
          console.error("[RootData Reader] detail failed:", item, error);
          try {
            await submitDetailFailure(item, job, error, { isInitial: true });
          } catch (failureError) {
            console.error("[RootData Reader] detail failure report failed:", failureError);
          }
        }

        await sleep(CONFIG.detailBetweenMs);
      }

      const subQueue = normalizeSubDetailItems(Array.from(subDetailMap.values())).slice(0, CONFIG.subDetailMaxProjectsPerRun);
      stats.subTotal = subQueue.length;

      for (let index = 0; index < subQueue.length; index += 1) {
        const item = subQueue[index];
        renderPanel({
          ok: true,
          status: `sub_details:${index + 1}/${subQueue.length}`,
          retryCount: job.retryCount || 0,
          data: rows,
          detailStats: stats,
        });

        try {
          const detail = await crawlDetailPage(frame, item, { isInitial: false });
          await submitDetailData(detail, { ...job, forceRefreshInvestedRelationships: false, forceRefreshInvestmentRelationships: false, cleanupWindowStart: null });
          stats.subSuccess += 1;
          console.log("[RootData Reader] ✅ sub detail imported:", detail.projectName);
        } catch (error) {
          stats.subFailed += 1;
          stats.errors.push({ projectName: item.projectName, projectLink: item.projectLink, error: error.message });
          console.error("[RootData Reader] sub detail failed:", item, error);
          try {
            await submitDetailFailure(item, job, error, { isInitial: false });
          } catch (failureError) {
            console.error("[RootData Reader] sub detail failure report failed:", failureError);
          }
        }

        await sleep(CONFIG.detailBetweenMs);
      }

      return stats;
    } finally {
      removeDetailFrame();
    }
  }

  function createPanel() {
    let panel = document.getElementById(CONFIG.panelId);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = CONFIG.panelId;
    panel.style.cssText = [
      "position: fixed",
      "right: 16px",
      "bottom: 16px",
      "z-index: 999999",
      "width: 380px",
      "max-height: 560px",
      "overflow: auto",
      "background: #0f172a",
      "color: #e5e7eb",
      "border: 1px solid rgba(255,255,255,.16)",
      "border-radius: 12px",
      "box-shadow: 0 18px 50px rgba(15,23,42,.35)",
      "font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      "font-size: 12px",
      "line-height: 1.5",
      "padding: 12px",
    ].join(";");

    document.body.appendChild(panel);
    return panel;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }


  // ============================================================================
  // SECTION 9: PANEL UI AND PAGE-LEVEL WORKFLOWS
  // - Floating status panel, scrape current page, scheduler loop, bootstrap
  // ============================================================================

  function getNextScheduleInfo(date = new Date()) {
    const bj = getBeijingParts(date);
    const [year, month, day] = bj.date.split("-").map(Number);
    const nowTime = date.getTime();
    const candidates = [];

    for (const dayOffset of [0, 1]) {
      for (const slot of CONFIG.scheduleBeijingTimes) {
        const [hour, minute] = String(slot).split(":").map(Number);
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
        // Beijing is UTC+8. Date.UTC creates UTC time, so subtract 8 hours.
        const triggerTime = Date.UTC(year, month - 1, day + dayOffset, hour - 8, minute, 0, 0);
        if (triggerTime > nowTime) candidates.push({ slot, triggerTime });
      }
    }

    candidates.sort((a, b) => a.triggerTime - b.triggerTime);
    const next = candidates[0] || null;
    if (!next) return null;

    const triggerDate = new Date(next.triggerTime);
    const triggerBeijing = getBeijingParts(triggerDate);
    return {
      slot: next.slot,
      triggerTime: next.triggerTime,
      triggerBeijing: triggerBeijing.full,
      remainingMs: Math.max(0, next.triggerTime - nowTime),
    };
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (value) => String(value).padStart(2, "0");
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
  }

  function isIdlePanelState(state) {
    const status = String(state?.status || "");
    return status === "idle" || status === "copied" || status === "copy_failed";
  }

  function renderPanel(state) {
    const panel = createPanel();
    const data = state.data || [];
    const preview = data.slice(0, 5);
    const nextSchedule = isIdlePanelState(state) ? getNextScheduleInfo() : null;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <strong style="font-size:13px;color:#f8fafc;">RootData Fundraising Scheduler</strong>
        <button id="rd-fr-close" style="cursor:pointer;border:0;border-radius:6px;padding:2px 8px;background:#334155;color:#e5e7eb;">×</button>
      </div>
      <div style="margin-bottom:6px;color:#cbd5e1;">Beijing Time: ${escapeHtml(getBeijingParts().full)}</div>
      <div style="margin-bottom:6px;color:#cbd5e1;">Status:
        <span style="color:${state.ok ? "#86efac" : "#fca5a5"}">${escapeHtml(state.status || "-")}</span>
      </div>
      ${
        nextSchedule
          ? `<div style="margin-bottom:6px;color:#cbd5e1;">Next Auto Run:
              <strong id="rd-fr-countdown" data-next-trigger="${nextSchedule.triggerTime}" style="color:#38bdf8;">${escapeHtml(formatDuration(nextSchedule.remainingMs))}</strong>
              <span style="color:#94a3b8;">(${escapeHtml(nextSchedule.triggerBeijing)} BJT)</span>
            </div>`
          : ""
      }
      <div style="margin-bottom:6px;color:#cbd5e1;">Rows:
        <strong style="color:#facc15;">${data.length}</strong>
      </div>
      <div style="margin-bottom:8px;color:#cbd5e1;">Retries:
        <strong>${state.retryCount || 0}/${CONFIG.maxRetries}</strong>
      </div>
      ${
        state.detailStats
          ? `<div style="margin-bottom:8px;color:#cbd5e1;">Details:
              <strong style="color:#86efac;">${state.detailStats.initialSuccess || 0}</strong>/<span>${state.detailStats.initialTotal || 0}</span>
              initial,
              <strong style="color:#93c5fd;">${state.detailStats.subSuccess || 0}</strong>/<span>${state.detailStats.subTotal || 0}</span>
              sub,
              <span style="color:#fca5a5;">failed ${(state.detailStats.initialFailed || 0) + (state.detailStats.subFailed || 0)}</span>
            </div>`
          : ""
      }
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <button id="rd-fr-manual" style="cursor:pointer;border:0;border-radius:8px;padding:6px 10px;background:#2563eb;color:white;">Refresh & Run</button>
        <button id="rd-fr-copy" style="cursor:pointer;border:0;border-radius:8px;padding:6px 10px;background:#475569;color:white;">Copy JSON</button>
      </div>
      ${
        state.error
          ? `<pre style="white-space:pre-wrap;background:#450a0a;color:#fecaca;border-radius:8px;padding:8px;margin:0 0 10px;max-height:140px;overflow:auto;">${escapeHtml(state.error)}</pre>`
          : ""
      }
      <pre style="white-space:pre-wrap;background:#020617;border-radius:8px;padding:8px;margin:0;max-height:300px;overflow:auto;">${escapeHtml(
        JSON.stringify(preview, null, 2)
      )}</pre>
    `;

    panel.querySelector("#rd-fr-close")?.addEventListener("click", () => panel.remove());
    panel.querySelector("#rd-fr-manual")?.addEventListener("click", () => {
      startRefreshThenScrape({ slot: "manual", reason: "manual_button" });
    });
    panel.querySelector("#rd-fr-copy")?.addEventListener("click", async () => {
      const text = JSON.stringify(data, null, 2);
      try {
        if (typeof GM_setClipboard === "function") GM_setClipboard(text);
        else await navigator.clipboard.writeText(text);
        renderPanel({ ...state, status: "copied" });
      } catch (error) {
        renderPanel({ ...state, status: "copy_failed", error: error.message });
      }
    });

    updateIdleCountdown(panel);
  }

  function updateIdleCountdown(panel = createPanel()) {
    const countdown = panel.querySelector("#rd-fr-countdown");
    if (!countdown) return;
    const triggerTime = Number(countdown.getAttribute("data-next-trigger") || 0);
    if (!Number.isFinite(triggerTime) || triggerTime <= 0) return;
    const remainingMs = Math.max(0, triggerTime - Date.now());
    countdown.textContent = formatDuration(remainingMs);
  }

  function saveLastResult(result) {
    const compactResult = {
      ...result,
      data: Array.isArray(result?.data) ? result.data.slice(0, CONFIG.maxStoredLastResultRows) : [],
      rowsCount: Number(result?.rowsCount || result?.data?.length || 0),
    };

    try {
      localStorage.setItem(CONFIG.storageKeys.lastResult, JSON.stringify(compactResult));
    } catch (error) {
      console.warn("[RootData Reader] last result storage failed, dropping cached result:", error);
      localStorage.removeItem(CONFIG.storageKeys.lastResult);
    }
  }

  async function startBatchedDetailsForRows(rows, job) {
    let items = [];
    try {
      items = await fetchDetailQueue("initial", CONFIG.detailMaxProjectsPerRun, job);
    } catch (error) {
      console.error("[RootData Reader] fetch initial detail queue failed:", error);
      await sendAlert({
        scheduleSlot: job?.slot,
        reason: `detail_queue_failed: ${error.message}`,
        retryCount: job?.retryCount || 0,
        maxRetries: CONFIG.maxRetries,
        details: { phase: "initial", error: error.message },
        job,
      });
      throw error;
    }

    if (!items.length) {
      try {
        const subItems = await fetchDetailQueue("sub", CONFIG.subDetailMaxProjectsPerRun, job);
        if (subItems.length) {
          const subOnlyJob = {
            id: `${job.id || job.slot || "run"}-details-${Date.now()}`,
            slot: job.slot || "manual-console-details-batched",
            reason: `${job.reason || "run"}_sub_details_batched`,
            nextAction: "details_after_reload",
            queueMode: "server",
            loadMode: CONFIG.detailLoadMode,
            phase: "sub",
            cursor: 0,
            subCursor: 0,
            batchSize: Math.max(1, Number(CONFIG.detailBatchSize || 10)),
            maxSub: Math.max(0, Number(CONFIG.subDetailMaxProjectsPerRun || 0)),
            items: [],
            subItems,
            stats: emptyDetailStats({ initialTotal: 0, subTotal: subItems.length }),
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
          setDetailJob(subOnlyJob);
          console.log("[RootData Reader] sub details batched job started:", summarizeDetailJob(subOnlyJob));
          return runDetailBatchJob(subOnlyJob);
        }
      } catch (error) {
        console.error("[RootData Reader] fetch sub detail queue failed after empty initial queue:", error);
        await sendAlert({
          scheduleSlot: job?.slot,
          reason: `sub_detail_queue_failed: ${error.message}`,
          retryCount: job?.retryCount || 0,
          maxRetries: CONFIG.maxRetries,
          details: { phase: "sub", error: error.message },
          job,
        });
        throw error;
      }

      clearDetailJob();
      renderPanel({
        ok: true,
        status: "detail_queue_empty_reloading",
        retryCount: job.retryCount || 0,
        data: rows,
      });
      reloadAfterRelease("detail_queue_empty");
      return { ok: true, done: true, stats: emptyDetailStats() };
    }

    const detailJob = {
      id: `${job.id || job.slot || "run"}-details-${Date.now()}`,
      slot: job.slot || "manual-console-details-batched",
      reason: `${job.reason || "run"}_details_batched`,
      nextAction: "details_after_reload",
      queueMode: "server",
      loadMode: CONFIG.detailLoadMode,
      phase: "initial",
      cursor: 0,
      subCursor: 0,
      batchSize: Math.max(1, Number(CONFIG.detailBatchSize || 10)),
      maxSub: Math.max(0, Number(CONFIG.subDetailMaxProjectsPerRun || 0)),
      items,
      subItems: [],
      stats: emptyDetailStats({ initialTotal: items.length }),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    setDetailJob(detailJob);
    console.log("[RootData Reader] details batched job started:", summarizeDetailJob(detailJob));
    return runDetailBatchJob(detailJob);
  }

  function startRefreshThenScrape({ slot, reason }) {
    const job = {
      id: `${slot}-${Date.now()}`,
      slot,
      reason,
      retryCount: 0,
      createdAt: nowIso(),
      nextAction: "scrape_after_reload",
    };

    clearDetailJob();
    setPendingJob(job);
    renderPanel({ ok: true, status: `refreshing_before_scrape:${slot}`, retryCount: 0, data: [] });
    if (isFundraisingPage()) location.reload();
    else navigateTo(CONFIG.FUNDRAISING_URL, "start_run_from_detail_page", 100);
  }

  async function retryOrAlert(job, error) {
    const retryCount = Number(job.retryCount || 0);
    const details = error?.details || {};

    if (retryCount < CONFIG.maxRetries) {
      const nextJob = {
        ...job,
        retryCount: retryCount + 1,
        lastError: error.message,
        lastErrorDetails: details,
        updatedAt: nowIso(),
      };

      setPendingJob(nextJob);
      renderPanel({
        ok: false,
        status: `retrying_after_${CONFIG.retryDelayMs / 1000}s`,
        retryCount: nextJob.retryCount,
        error: error.message,
        data: [],
      });

      setTimeout(() => location.reload(), CONFIG.retryDelayMs);
      return;
    }

    clearPendingJob();
    await sendAlert({
      scheduleSlot: job.slot,
      reason: error.message,
      retryCount,
      maxRetries: CONFIG.maxRetries,
      details,
      job,
    });

    renderPanel({
      ok: false,
      status: "blocked_alert_sent",
      retryCount,
      error: `${error.message}\n${JSON.stringify(details, null, 2)}`,
      data: [],
    });
  }

  async function scrapeCurrentPage(job) {
    renderPanel({ ok: true, status: "waiting_rows", retryCount: job.retryCount || 0, data: [] });

    try {
      await testConnection({ silent: true });
      const data = await waitForRowsOrBlocked();
      if (!data.length) throw new Error("解析结果为空");

      window.__ROOTDATA_FUNDRAISING_DATA__ = data;
      console.log("[RootData Reader] ✅ page data available:", {
        rowsCount: data.length,
        firstRow: data[0] || null,
        pageUrl: location.href,
      });

      const result = {
        ok: true,
        status: "success",
        scheduleSlot: job.slot,
        rowsCount: data.length,
        pageUrl: location.href,
        scrapedAt: nowIso(),
        data,
      };

      saveLastResult(result);
      clearPendingJob();
      console.log("[RootData Reader] parsed rows:", data.length, data);

      let importResult = null;
      try {
        importResult = await submitData(data, job);
      } catch (submitError) {
        console.error("[RootData Reader] list import failed:", submitError);
        await sendAlert({
          scheduleSlot: job.slot,
          reason: `import_failed: ${submitError.message}`,
          retryCount: job.retryCount || 0,
          maxRetries: CONFIG.maxRetries,
          details: {
            pageUrl: location.href,
            rowsCount: data.length,
            error: submitError.message,
          },
          job,
        });
        renderPanel({
          ok: false,
          status: "success_but_import_failed",
          retryCount: job.retryCount || 0,
          error: submitError.message,
          data,
        });
        return;
      }

      console.log("[RootData Reader] import result:", importResult);
      renderPanel({ ok: true, status: "success_imported_crawling_details", retryCount: job.retryCount || 0, data });

      try {
        await startBatchedDetailsForRows(data, job);
      } catch (detailError) {
        console.error("[RootData Reader] detail queue/crawl failed:", detailError);
        renderPanel({
          ok: false,
          status: "success_imported_but_detail_failed",
          retryCount: job.retryCount || 0,
          error: detailError.message,
          data,
        });
      }
    } catch (error) {
      await retryOrAlert(job, error);
    }
  }

  function checkSchedule() {
    if (!isFundraisingPage()) return;
    const bj = getBeijingParts();
    const lastRunMap = getLastRunMap();

    for (const slot of CONFIG.scheduleBeijingTimes) {
      if (bj.time !== slot) continue;

      const slotKey = `${bj.date}-${slot}`;
      if (lastRunMap[slotKey]) continue;

      setLastRun(slotKey, { triggeredAt: nowIso(), beijingTime: bj.full });
      console.log(`[RootData Reader] scheduled job triggered: ${slot}`);
      startRefreshThenScrape({ slot, reason: "schedule" });
      break;
    }
  }

  function initScheduleLoop() {
    if (!isFundraisingPage()) return;
    setInterval(checkSchedule, CONFIG.scheduleCheckIntervalMs);
    setInterval(() => updateIdleCountdown(), CONFIG.idleCountdownRefreshMs);
    checkSchedule();
  }

  async function bootstrap() {
    cleanupLocalStorageState();

    const recrawlJob = getRecrawlJob();
    if (recrawlJob?.nextAction === "recrawl_after_reload") {
      console.log("[RootData Reader] recrawl job found after reload:", summarizeRecrawlJob(recrawlJob));
      await runRecrawlBatchJob(recrawlJob);
      return;
    }

    const detailJob = getDetailJob();
    if (detailJob?.nextAction === "details_after_reload") {
      console.log("[RootData Reader] detail job found after reload:", summarizeDetailJob(detailJob));
      await runDetailBatchJob(detailJob);
      return;
    }

    const pendingJob = getPendingJob();

    if (pendingJob?.nextAction === "scrape_after_reload") {
      console.log("[RootData Reader] pending job found after reload:", pendingJob);
      await scrapeCurrentPage(pendingJob);
      return;
    }

    const lastResult = safeJsonParse(localStorage.getItem(CONFIG.storageKeys.lastResult), null);
    renderPanel({ ok: true, status: "idle", retryCount: 0, data: lastResult?.data || [] });
  }


  // ============================================================================
  // SECTION 10: DEBUG / CONSOLE API
  // - RootDataFundraisingCollector public methods for manual operations
  // ============================================================================

  function exposeDebugApi() {
    const debugApi = {
      /**
       * 手动触发完整流程：先刷新页面，再等待页面加载后采集并提交。
       * 控制台调用：RootDataFundraisingCollector.run()
       */
      run() {
        startRefreshThenScrape({ slot: "manual-console", reason: "manual_console" });
      },

      /**
       * 不刷新，直接解析当前页面并提交。适合页面已经加载完成后快速验证。
       * 控制台调用：await RootDataFundraisingCollector.scrapeNow()
       */
      async scrapeNow() {
        const job = {
          id: `manual-console-no-refresh-${Date.now()}`,
          slot: "manual-console-no-refresh",
          reason: "manual_console_no_refresh",
          retryCount: 0,
          createdAt: nowIso(),
          nextAction: "scrape_without_reload",
        };
        await scrapeCurrentPage(job);
      },

      /**
       * 清理当前 Fundraising 首页前 N 个项目的详情字段和投融资关系，然后导入首页列表并重爬详情。
       * 控制台调用：await RootDataFundraisingCollector.cleanAndRecrawlHomepageTop(30)
       */
      async cleanAndRecrawlHomepageTop(limit = 30, options = {}) {
        if (!isFundraisingPage()) {
          throw new Error("请先打开 https://www.rootdata.com/fundraising 页面");
        }

        const count = Math.max(1, Math.min(Number(limit) || 30, 100));
        const data = parseFundraisingRows().slice(0, count);
        if (!data.length) throw new Error("当前首页没有解析到 Fundraising 项目");

        const job = {
          id: `manual-clean-homepage-top-${count}-${Date.now()}`,
          slot: options.slot || `manual-clean-homepage-top-${count}`,
          reason: "manual_clean_homepage_top_and_recrawl",
          retryCount: 0,
          createdAt: nowIso(),
        };

        console.log("[RootData Reader] clean homepage top projects:", {
          count,
          items: data.map((item) => ({ projectName: item.projectName, projectLink: item.projectLink })),
        });

        const cleanupResult = await submitDetailCleanup(data, job);
        const importResult = await submitData(data, job);

        const recrawlResult = await this.recrawlDetails(data, {
          batchSize: options.batchSize || CONFIG.detailBatchSize || 10,
          maxSub: Number.isFinite(Number(options.maxSub)) ? Number(options.maxSub) : 0,
          loadMode: options.loadMode || CONFIG.detailLoadMode,
          forceRefreshInvestmentRelationships: true,
          forceRefreshInvestedRelationships: true,
          cleanupWindowStart: null,
          slot: job.slot,
          reloadOnDone: options.reloadOnDone,
        });

        return {
          ok: true,
          count,
          cleanupResult,
          importResult,
          recrawlResult,
        };
      },

      /**
       * 只解析当前 DOM，不提交服务端。
       * 控制台调用：RootDataFundraisingCollector.parse()
       */
      parse() {
        const data = parseFundraisingRows();
        window.__ROOTDATA_FUNDRAISING_DATA__ = data;
        console.log(data.length > 0 ? "[RootData Reader] ✅ parse data ok:" : "[RootData Reader] ⚠️ parse data empty:", {
          rowsCount: data.length,
          firstRow: data[0] || null,
          data,
          pageUrl: location.href,
        });
        return data;
      },

      /**
       * 只跑详情页采集：会按 detailBatchSize 分批打开详情，批次之间刷新页面并自动续跑。
       * 控制台调用：await RootDataFundraisingCollector.crawlDetailsNow()
       */
      async crawlDetailsNow() {
        const data = parseFundraisingRows();
        const job = {
          id: `manual-console-details-${Date.now()}`,
          slot: "manual-console-details",
          reason: "manual_console_details",
          retryCount: 0,
          createdAt: nowIso(),
        };
        return startBatchedDetailsForRows(data, job);
      },

      /**
       * 按审计脚本输出的项目清单重爬详情并提交服务端。
       * 控制台调用：await RootDataFundraisingCollector.recrawlDetails([{ projectName, projectLink }], { batchSize: 10, maxSub: 0 })
       * 清理并重建“对外投资”关系：
       * await RootDataFundraisingCollector.recrawlDetails(items, {
       *   batchSize: 10,
       *   maxSub: 0,
       *   forceRefreshInvestmentRelationships: true,
       *   forceRefreshInvestedRelationships: true,
       *   cleanupWindowStart: "2026-05-24T16:00:00.000Z"
       * })
       */
      async recrawlDetails(items, options = {}) {
        const data = normalizeRecrawlItems(items);
        const batchSize = Math.max(1, Number(options.batchSize || options.reloadEvery || 10));
        const shouldBatch = options.reloadBetweenBatches !== false && data.length > batchSize;
        const maxSub = Number.isFinite(Number(options.maxSub)) ? Math.max(0, Number(options.maxSub)) : 0;
        const forceRefreshInvestmentRelationships = options.forceRefreshInvestmentRelationships === true;
        const forceRefreshInvestedRelationships = options.forceRefreshInvestedRelationships === true;
        const cleanupWindowStart = options.cleanupWindowStart ? String(options.cleanupWindowStart) : null;

        if ((options.loadMode || CONFIG.detailLoadMode) === "page") {
          const job = {
            id: `manual-console-recrawl-details-page-${Date.now()}`,
            slot: options.slot || "manual-console-recrawl-details-page",
            reason: "manual_console_recrawl_details_page",
            nextAction: "details_after_reload",
            queueMode: "local",
            loadMode: "page",
            phase: "initial",
            cursor: 0,
            subCursor: 0,
            batchSize,
            maxSub,
            forceRefreshInvestedRelationships,
            forceRefreshInvestmentRelationships,
            cleanupWindowStart,
            items: data,
            subItems: [],
            stats: emptyDetailStats({ initialTotal: data.length }),
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };

          clearRecrawlJob();
          setDetailJob(job);
          console.log("[RootData Reader] recrawl current-tab job started:", summarizeDetailJob(job));
          return runDetailBatchJob(job);
        }

        if (shouldBatch) {
          const job = {
            id: `manual-console-recrawl-details-batched-${Date.now()}`,
            slot: options.slot || "manual-console-recrawl-details-batched",
            reason: "manual_console_recrawl_details_batched",
            nextAction: "recrawl_after_reload",
            cursor: 0,
            batchSize,
            maxSub,
            forceRefreshInvestedRelationships,
            forceRefreshInvestmentRelationships,
            cleanupWindowStart,
            items: data,
            stats: {
              enabled: true,
              initialTotal: data.length,
              initialSuccess: 0,
              initialFailed: 0,
              subTotal: 0,
              subSuccess: 0,
              subFailed: 0,
              errors: [],
            },
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };

          setRecrawlJob(job);
          console.log("[RootData Reader] recrawl batched job started:", summarizeRecrawlJob(job));
          return runRecrawlBatchJob(job);
        }

        const oldMaxInitial = CONFIG.detailMaxProjectsPerRun;
        const oldMaxSub = CONFIG.subDetailMaxProjectsPerRun;
        if (Number.isFinite(Number(options.maxInitial))) CONFIG.detailMaxProjectsPerRun = Number(options.maxInitial);
        else CONFIG.detailMaxProjectsPerRun = data.length;
        CONFIG.subDetailMaxProjectsPerRun = maxSub;

        const job = {
          id: `manual-console-recrawl-details-${Date.now()}`,
          slot: options.slot || "manual-console-recrawl-details",
          reason: "manual_console_recrawl_details",
          retryCount: 0,
          forceRefreshInvestedRelationships,
          forceRefreshInvestmentRelationships,
          cleanupWindowStart,
          createdAt: nowIso(),
        };

        try {
          return await crawlDetailsForRows(data, job, { allowInvestors: true });
        } finally {
          CONFIG.detailMaxProjectsPerRun = oldMaxInitial;
          CONFIG.subDetailMaxProjectsPerRun = oldMaxSub;
          if (options.reloadOnDone !== false) {
            clearRecrawlJob();
            reloadAfterRelease("recrawl_direct_done");
          }
        }
      },

      /**
       * 继续/查看/清理批量重爬任务。
       */
      async resumeRecrawlDetails() {
        const job = getRecrawlJob();
        if (!job) {
          const detailJob = getDetailJob();
          if (detailJob?.nextAction === "details_after_reload") return runDetailBatchJob(detailJob);
          return { ok: false, error: "no_recrawl_job" };
        }
        return runRecrawlBatchJob(job);
      },

      recrawlStatus() {
        return summarizeRecrawlJob(getRecrawlJob()) || summarizeDetailJob(getDetailJob());
      },

      /**
       * 诊断单个详情页 iframe 是否能打开、能解析到多少数据。
       * 控制台调用：await RootDataFundraisingCollector.debugDetail("https://www.rootdata.com/projects/detail/Variational?k=NTc4Mg%3D%3D")
       */
      async debugDetail(url) {
        const frame = ensureDetailFrame();
        try {
          const item = {
            projectName: parseNameFromDetailUrl(url),
            projectLink: canonicalRootDataDetailUrl(absoluteUrl(url)),
          };
          const detail = await crawlDetailPage(frame, item, { isInitial: true });
          console.log("[RootData Reader] detail debug:", detail);
          return detail;
        } finally {
          removeDetailFrame();
        }
      },

      /**
       * 测试服务端是否可达，以及当前 CLIENT_TOKEN 是否有效。
       * 控制台调用：await RootDataFundraisingCollector.testConnection()
       */
      testConnection,

      /**
       * 发送一条测试告警，验证服务端告警接口和邮件。
       * 控制台调用：await RootDataFundraisingCollector.sendTestAlert()
       */
      async sendTestAlert() {
        return sendAlert({
          scheduleSlot: "manual-console-test",
          reason: "manual test alert from console",
          retryCount: 0,
          maxRetries: CONFIG.maxRetries,
          details: {
            test: true,
            pageUrl: location.href,
            title: document.title,
          },
        });
      },

      /**
       * 查看当前配置、pending job、最近结果。
       * 控制台调用：RootDataFundraisingCollector.status()
       */
      status() {
        return {
          config: {
            apiBase: CONFIG.API_BASE,
            alertEndpoint: CONFIG.ALERT_ENDPOINT,
            importEndpoint: CONFIG.IMPORT_ENDPOINT,
            detailQueueEndpoint: CONFIG.DETAIL_QUEUE_ENDPOINT,
            detailImportEndpoint: CONFIG.DETAIL_IMPORT_ENDPOINT,
            detailFailureEndpoint: CONFIG.DETAIL_FAILURE_ENDPOINT,
            pingEndpoint: CONFIG.PING_ENDPOINT,
            scheduleBeijingTimes: CONFIG.scheduleBeijingTimes,
            maxRetries: CONFIG.maxRetries,
            detailEnabled: CONFIG.detailEnabled,
            detailMaxProjectsPerRun: CONFIG.detailMaxProjectsPerRun,
            subDetailMaxProjectsPerRun: CONFIG.subDetailMaxProjectsPerRun,
            detailBatchSize: CONFIG.detailBatchSize,
            detailLoadMode: CONFIG.detailLoadMode,
            tokenConfigured:
              Boolean(CONFIG.CLIENT_TOKEN) &&
              CONFIG.CLIENT_TOKEN !== "REPLACE_WITH_LONG_RANDOM_TOKEN",
          },
          pendingJob: getPendingJob(),
          recrawlJob: summarizeRecrawlJob(getRecrawlJob()),
          detailJob: summarizeDetailJob(getDetailJob()),
          lastResult: safeJsonParse(localStorage.getItem(CONFIG.storageKeys.lastResult), null),
          beijingTime: getBeijingParts().full,
        };
      },

      clearPendingJob,
      clearRecrawlJob,
      clearDetailJob,
    };

    window.RootDataFundraisingCollector = debugApi;
    PAGE_WINDOW.RootDataFundraisingCollector = debugApi;

    console.log(
      "[RootData Reader] debug api ready: RootDataFundraisingCollector.run(), scrapeNow(), cleanAndRecrawlHomepageTop(30), parse(), crawlDetailsNow(), recrawlDetails(items), resumeRecrawlDetails(), recrawlStatus(), debugDetail(url), testConnection(), sendTestAlert(), status()"
    );
  }

  exposeDebugApi();
  testConnection({ silent: false });
  initScheduleLoop();
  bootstrap();
})();
