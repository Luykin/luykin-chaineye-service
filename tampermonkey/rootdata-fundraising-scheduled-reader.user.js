// ==UserScript==
// @name         RootData Fundraising Scheduled Reader
// @namespace    https://cryptohunt.ai/
// @version      0.3.0
// @description  Scheduled RootData fundraising reader with refresh, retry, import and alert.
// @author       luykin
// @match        https://www.rootdata.com/fundraising*
// @match        https://www.rootdata.com/Fundraising*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    // TODO: 部署时改成真实 API 域名，例如 https://api.cryptohunt.ai
    API_BASE: "https://your-api-domain.com",
    ALERT_ENDPOINT: "/api/internal/rootdata/fundraising/alert",
    IMPORT_ENDPOINT: "/api/internal/rootdata/fundraising/import",
    CLIENT_TOKEN: "REPLACE_WITH_LONG_RANDOM_TOKEN",

    // 北京时间：对应原 scheduler 的 07:10 与 18:10
    scheduleBeijingTimes: ["07:10", "18:10"],
    scheduleCheckIntervalMs: 30 * 1000,

    maxWaitMs: 30 * 1000,
    pollIntervalMs: 500,
    maxRetries: 3,
    retryDelayMs: 10 * 1000,

    panelId: "rd-fundraising-reader-panel-v3",
    storageKeys: {
      pendingJob: "rd_fr_pending_job_v3",
      lastRunMap: "rd_fr_last_run_map_v3",
      lastResult: "rd_fr_last_result_v3",
    },
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

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

  function nowIso() {
    return new Date().toISOString();
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
        name: cleanText(link.textContent).replace(/\*$/, "").trim(),
        link: absoluteUrl(link.getAttribute("href")),
        rawText: cleanText(link.textContent),
      }))
      .filter((item) => item.name || item.link);

    if (linkedInvestors.length) return linkedInvestors;

    return cleanText(cell.textContent)
      .split(/\s{2,}|\n/)
      .map((name) => cleanText(name))
      .filter(Boolean)
      .map((name) => ({ name, link: "" }));
  }

  function parseFundraisingRows() {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));

    return rows
      .map((row, index) => {
        const cells = row.querySelectorAll("td");
        const projectCell = cells[0];
        const projectLinkEl = findProjectLink(projectCell);
        const projectLink = absoluteUrl(projectLinkEl?.getAttribute("href") || "");
        const projectName =
          cleanText(projectLinkEl?.textContent) ||
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
        matched: html.length < 1000 || bodyText.length < 20,
      },
      {
        type: "login_page",
        matched: /log in|sign in|登录|登入/i.test(bodyText),
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
      tableCount: document.querySelectorAll("table").length,
      rowCount: document.querySelectorAll("table tbody tr").length,
      projectLinkCount: document.querySelectorAll(
        'a[href*="/projects/detail/"], a[href*="/Projects/detail/"]'
      ).length,
      url: location.href,
    };
  }

  async function waitForRowsOrBlocked() {
    const start = Date.now();

    while (Date.now() - start < CONFIG.maxWaitMs) {
      const blocked = detectBlockedPage();
      if (blocked.blocked) {
        throw Object.assign(new Error(`页面异常：${blocked.reason}`), { details: blocked });
      }

      const data = parseFundraisingRows();
      if (data.length > 0) return data;

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

  function requestJson({ url, method = "POST", headers = {}, body }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: {
          "Content-Type": "application/json",
          "x-rootdata-client-token": CONFIG.CLIENT_TOKEN,
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

  function renderPanel(state) {
    const panel = createPanel();
    const data = state.data || [];
    const preview = data.slice(0, 5);

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <strong style="font-size:13px;color:#f8fafc;">RootData Fundraising Scheduler</strong>
        <button id="rd-fr-close" style="cursor:pointer;border:0;border-radius:6px;padding:2px 8px;background:#334155;color:#e5e7eb;">×</button>
      </div>
      <div style="margin-bottom:6px;color:#cbd5e1;">Beijing Time: ${escapeHtml(getBeijingParts().full)}</div>
      <div style="margin-bottom:6px;color:#cbd5e1;">Status:
        <span style="color:${state.ok ? "#86efac" : "#fca5a5"}">${escapeHtml(state.status || "-")}</span>
      </div>
      <div style="margin-bottom:6px;color:#cbd5e1;">Rows:
        <strong style="color:#facc15;">${data.length}</strong>
      </div>
      <div style="margin-bottom:8px;color:#cbd5e1;">Retries:
        <strong>${state.retryCount || 0}/${CONFIG.maxRetries}</strong>
      </div>
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
  }

  function saveLastResult(result) {
    localStorage.setItem(CONFIG.storageKeys.lastResult, JSON.stringify(result));
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

    setPendingJob(job);
    renderPanel({ ok: true, status: `refreshing_before_scrape:${slot}`, retryCount: 0, data: [] });
    location.reload();
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
      const data = await waitForRowsOrBlocked();
      if (!data.length) throw new Error("解析结果为空");

      window.__ROOTDATA_FUNDRAISING_DATA__ = data;

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

      try {
        const importResult = await submitData(data, job);
        console.log("[RootData Reader] import result:", importResult);
        renderPanel({ ok: true, status: "success_imported", retryCount: job.retryCount || 0, data });
      } catch (submitError) {
        console.error("[RootData Reader] import failed:", submitError);
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
      }
    } catch (error) {
      await retryOrAlert(job, error);
    }
  }

  function checkSchedule() {
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
    setInterval(checkSchedule, CONFIG.scheduleCheckIntervalMs);
    checkSchedule();
  }

  async function bootstrap() {
    const pendingJob = getPendingJob();

    if (pendingJob?.nextAction === "scrape_after_reload") {
      console.log("[RootData Reader] pending job found after reload:", pendingJob);
      await scrapeCurrentPage(pendingJob);
      return;
    }

    const lastResult = safeJsonParse(localStorage.getItem(CONFIG.storageKeys.lastResult), null);
    renderPanel({ ok: true, status: "idle", retryCount: 0, data: lastResult?.data || [] });
  }

  initScheduleLoop();
  bootstrap();
})();
