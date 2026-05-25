# RootData Fundraising Tampermonkey 采集方案技术文档

## 1. 背景

当前旧版 `src/services/rootdata-crawler.js` 通过服务器侧 axios / Puppeteer 访问 RootData 融资列表：

```txt
https://www.rootdata.com/fundraising?page=1
```

线上已经多次触发 RootData WAF：

- `WAF Block Page`
- `Your request has been interrupted`
- `sg.captcha.qcloud.com/Captcha.js`
- `/WafCaptcha`

说明 RootData 对服务器出口 IP、Headless 浏览器、请求特征或代理线路做了拦截。为降低服务器侧爬虫被拦概率，计划将融资列表第一页采集迁移到：

```txt
Windows Server 真实浏览器 + Tampermonkey 用户脚本 + 页面 DOM 采集 + 回传服务端
```

第一阶段先跑通页面内读取；第二阶段再接入服务端 API；稳定后可逐步替代 `scheduler.js` 中的 RootData quick update 定时任务。

---

## 2. 目标

### 2.1 第一阶段目标

在 Windows 服务器浏览器中打开：

```txt
https://www.rootdata.com/fundraising?page=1
```

Tampermonkey 自动完成：

1. 等待页面表格加载。
2. 从 DOM 解析第一页融资项目数据。
3. 在 Console 与页面右下角面板展示结果。
4. 每次抓取前刷新页面。
5. 定时执行，时间与原 `scheduler.js` 保持一致。
6. 遇到验证码、WAF、白屏、登录页、解析为空时最多重试 3 次。
7. 重试失败后调用告警接口。

### 2.2 第二阶段目标

新增服务端接收 API，Tampermonkey 自动提交采集结果：

```txt
POST /api/internal/rootdata/fundraising/import
```

### 2.3 第三阶段目标

稳定后，用 Tampermonkey 采集替代旧服务器侧 RootData fundraising 列表抓取，减少：

```js
this.startRootDataCrawl()
```

中对 RootData fundraising 列表页的直接访问。

---

## 3. 原定时任务时间映射

当前 `src/services/scheduler.js` 中有两段 RootData quick update：

```js
this.morningJob = schedule.scheduleJob("10 23 * * *", async () => {
  await this.startRootDataCrawl();
});

this.eveningJob = schedule.scheduleJob("10 10 * * *", async () => {
  await this.startRootDataCrawl();
});
```

该 cron 按服务器当前时区/UTC 注释理解，对应北京时间：

| 原 cron | UTC 时间 | 北京时间 |
|---|---:|---:|
| `10 23 * * *` | 23:10 | 次日 07:10 |
| `10 10 * * *` | 10:10 | 当日 18:10 |

Tampermonkey 脚本中固定使用 `Asia/Shanghai` 计算时间，计划触发点：

```txt
07:10
18:10
```

---

## 4. 总体架构

```txt
┌────────────────────────────────────┐
│ Windows Server                      │
│                                    │
│  Chrome / Edge                     │
│  + Tampermonkey                    │
│                                    │
│  https://www.rootdata.com/         │
│  fundraising?page=1                │
│                                    │
│  1. 定时触发                       │
│  2. 刷新页面                       │
│  3. 读取 DOM                       │
│  4. 解析表格                       │
│  5. 异常重试                       │
│  6. 告警 / 提交 API                │
└──────────────────┬─────────────────┘
                   │ HTTPS POST
                   ▼
┌────────────────────────────────────┐
│ luykin-chaineye-service             │
│                                    │
│  /api/internal/rootdata/...         │
│                                    │
│  - token 校验                       │
│  - 告警接收                         │
│  - 数据接收                         │
│  - upsert Fundraising.Project       │
│  - 可选触发详情更新                 │
└────────────────────────────────────┘
```

---

## 5. RootData 当前页面结构

当前 RootData fundraising 页面已不是旧版：

```css
.main_container
```

而是 Next.js 表格结构：

```html
<table data-slot="table">
  <thead>
    <tr>
      <th>Project</th>
      <th>Round</th>
      <th>Amount</th>
      <th>Valuation</th>
      <th>Date</th>
      <th>Source</th>
      <th>Investors</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        <a href="/projects/detail/JPYC?k=MjIxNjM%3D">JPYC</a>
      </td>
      <td>Series B</td>
      <td>--</td>
      <td>--</td>
      <td>May 23</td>
      <td>...</td>
      <td>...</td>
    </tr>
  </tbody>
</table>
```

Tampermonkey 主要选择器：

```css
table tbody tr
a[href*="/projects/detail/"]
a[href*="/Projects/detail/"]
```

---

## 6. 采集字段设计

第一阶段采集字段：

| 字段 | 说明 | 来源 |
|---|---|---|
| `index` | 当前页行号 | 行序号 |
| `projectName` | 项目名 | 第 1 列项目链接文本 / 图片 alt |
| `projectLink` | RootData 项目链接 | 第 1 列项目链接 |
| `projectId` | RootData 项目 ID | `projectLink` 的 `k` 参数 base64 解码 |
| `logo` | 项目 logo | 第 1 列 img src |
| `round` | 融资轮次 | 第 2 列 |
| `amount` | 金额原文 | 第 3 列 |
| `valuation` | 估值原文 | 第 4 列 |
| `date` | 日期原文 | 第 5 列 |
| `sourceUrl` | 新闻源链接 | 第 6 列外链 |
| `investors` | 投资方列表 | 第 7 列链接或文本 |
| `pageUrl` | 采集页面 | `location.href` |
| `scrapedAt` | 采集时间 | 当前时间 ISO |

示例：

```json
{
  "index": 1,
  "projectName": "JPYC",
  "projectLink": "https://www.rootdata.com/projects/detail/JPYC?k=MjIxNjM%3D",
  "projectId": 22163,
  "logo": "https://public.rootdata.com/images/...webp",
  "round": "Series B",
  "amount": "--",
  "valuation": "--",
  "date": "May 23",
  "sourceUrl": "https://coinpost.jp/?p=710602",
  "investors": [
    {
      "name": "Life Design Fund",
      "link": ""
    }
  ],
  "pageUrl": "https://www.rootdata.com/fundraising?page=1",
  "scrapedAt": "2026-05-25T...Z"
}
```

---

## 7. 异常检测策略

Tampermonkey 需要在页面内检测以下异常：

| 异常类型 | 检测依据 | 处理 |
|---|---|---|
| WAF Block | `WAF Block Page` / `Your request has been interrupted` / `web application firewall` | 重试 |
| 腾讯云验证码 | `CaptchaScript` / `sg.captcha.qcloud.com` / `/WafCaptcha` / `__captcha` | 重试 |
| Cloudflare | `cloudflare` / `checking your browser` / `verify you are human` | 重试 |
| 白屏 | HTML 太短或正文太少 | 重试 |
| 登录页 | `log in` / `sign in` / `登录` | 重试 |
| 表格为空 | 超时后 `Rows = 0` | 重试 |

重试策略：

```txt
失败
→ 等待 10 秒
→ 刷新页面
→ 重新解析
→ 最多 3 次
→ 仍失败则调用告警接口
```

---

## 8. Tampermonkey 脚本 v2

> 注意：`API_BASE`、`ALERT_ENDPOINT`、`CLIENT_TOKEN`、`@connect` 需要替换为真实值。第一阶段可以先保留告警接口不可用，主要验证定时、刷新、解析和面板展示。

```js
// ==UserScript==
// @name         RootData Fundraising Scheduled Reader
// @namespace    https://cryptohunt.ai/
// @version      0.2.0
// @description  Scheduled RootData fundraising reader with refresh, retry and alert.
// @author       luykin
// @match        https://www.rootdata.com/fundraising*
// @match        https://www.rootdata.com/Fundraising*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      your-api-domain.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    API_BASE: "https://your-api-domain.com",
    ALERT_ENDPOINT: "/api/internal/rootdata/fundraising/alert",
    SUBMIT_ENDPOINT: "/api/internal/rootdata/fundraising/import",
    CLIENT_TOKEN: "REPLACE_WITH_LONG_RANDOM_TOKEN",

    // 北京时间：对应原 scheduler 的 07:10 与 18:10
    scheduleBeijingTimes: ["07:10", "18:10"],
    scheduleCheckIntervalMs: 30 * 1000,

    maxWaitMs: 30 * 1000,
    pollIntervalMs: 500,
    maxRetries: 3,
    retryDelayMs: 10 * 1000,

    panelId: "rd-fundraising-reader-panel-v2",
    storageKeys: {
      pendingJob: "rd_fr_pending_job_v2",
      lastRunMap: "rd_fr_last_run_map_v2",
      lastResult: "rd_fr_last_result_v2",
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
    // 第二阶段启用：服务端 import API 完成后删除 return false。
    return false;

    /*
    return requestJson({
      url: `${CONFIG.API_BASE}${CONFIG.SUBMIT_ENDPOINT}`,
      body: {
        source: "tampermonkey",
        page: 1,
        pageUrl: location.href,
        scheduleSlot: job?.slot || null,
        rows: data,
        scrapedAt: nowIso(),
      },
    });
    */
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
        await submitData(data, job);
      } catch (submitError) {
        console.warn("[RootData Reader] submit skipped/failed:", submitError);
      }

      renderPanel({ ok: true, status: "success", retryCount: job.retryCount || 0, data });
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
```

---

## 9. 使用部署步骤

### 9.1 Windows 服务器准备

1. 安装 Chrome 或 Edge。
2. 安装 Tampermonkey。
3. 打开 RootData 页面：

```txt
https://www.rootdata.com/fundraising?page=1
```

4. 如果出现验证码，人工通过。
5. 保持浏览器和该标签页运行。

### 9.2 安装脚本

1. Tampermonkey 新建脚本。
2. 粘贴上方 v2 脚本。
3. 修改：

```js
API_BASE
ALERT_ENDPOINT
CLIENT_TOKEN
```

4. 修改脚本头：

```js
// @connect your-api-domain.com
```

为真实 API 域名。

### 9.3 手动验证

点击右下角面板：

```txt
Refresh & Run
```

成功时显示：

```txt
Status: success
Rows: 30
```

Console 可查看：

```js
window.__ROOTDATA_FUNDRAISING_DATA__
```

---

## 10. 服务端接口设计建议

### 10.1 告警接口

```txt
POST /api/internal/rootdata/fundraising/alert
```

请求头：

```txt
Content-Type: application/json
x-collector-client-token: <token>
```

请求体：

```json
{
  "source": "tampermonkey",
  "eventType": "rootdata_fundraising_page_blocked",
  "pageUrl": "https://www.rootdata.com/fundraising?page=1",
  "userAgent": "...",
  "occurredAt": "2026-05-25T...Z",
  "scheduleSlot": "07:10",
  "reason": "页面异常：captcha",
  "retryCount": 3,
  "maxRetries": 3,
  "details": {
    "reason": "captcha",
    "title": "",
    "bodyText": "...",
    "htmlLength": 1774,
    "tableCount": 0,
    "rowCount": 0,
    "projectLinkCount": 0,
    "url": "https://www.rootdata.com/fundraising?page=1"
  }
}
```

服务端处理：

1. 校验 `x-collector-client-token`。
2. 写日志。
3. 发 Telegram / 管理后台通知。
4. 返回 `{ success: true }`。

### 10.2 数据导入接口

```txt
POST /api/internal/rootdata/fundraising/import
```

请求头：

```txt
Content-Type: application/json
x-collector-client-token: <token>
```

请求体：

```json
{
  "source": "tampermonkey",
  "page": 1,
  "pageUrl": "https://www.rootdata.com/fundraising?page=1",
  "scheduleSlot": "07:10",
  "rows": [],
  "scrapedAt": "2026-05-25T...Z"
}
```

服务端处理：

1. token 校验。
2. 字段白名单校验。
3. `projectLink` 去重。
4. 复用现有 `parseAmount` / `parseDate` 等逻辑。
5. upsert `Fundraising.Project`。
6. 可选触发项目详情更新。

---

## 11. 安全设计

### 11.1 不使用 admin JWT

Tampermonkey 不应持有管理员 JWT。建议独立 token：

```txt
COLLECTOR_CLIENT_TOKEN=<long-random-secret>
```

### 11.2 Header 校验

```txt
x-collector-client-token
```

### 11.3 可选增强

1. IP 白名单：只允许 Windows 服务器出口 IP。
2. timestamp + signature 防重放。
3. 限制单次 rows 数量，比如最大 100。
4. 只允许字段白名单。
5. 记录每次提交 audit log。

---

## 12. 风险与限制

1. **Tampermonkey 依赖浏览器打开页面**：浏览器关闭则不会执行定时。
2. **RootData 仍可能弹验证码**：需要人工介入。
3. **DOM 结构可能变化**：需要维护 selector。
4. **Windows 服务器不能睡眠**：需保持会话、浏览器、网络可用。
5. **提交 API 需处理重复数据**：不能假设每次都是新项目。
6. **浏览器刷新后脚本依赖 localStorage pending job**：如果手动清理站点数据，会丢失状态。

---

## 13. 后续迁移策略

推荐分阶段：

### 阶段 1：只读验证

Tampermonkey 读取 DOM，显示 Rows，人工确认。

### 阶段 2：告警接口

接入：

```txt
/api/internal/rootdata/fundraising/alert
```

验证验证码 / 白屏 / WAF 时能通知。

### 阶段 3：导入接口

接入：

```txt
/api/internal/rootdata/fundraising/import
```

开始自动入库。

### 阶段 4：逐步替代旧 scheduler

旧任务可以先保留但关闭 fundraising 页抓取，或改为 fallback。

最终可考虑移除/禁用：

```js
this.morningJob = schedule.scheduleJob("10 23 * * *", ...)
this.eveningJob = schedule.scheduleJob("10 10 * * *", ...)
```

中对 RootData fundraising 页面服务器侧直接访问的部分。

---

## 14. 验收标准

### 第一阶段

- 手动点击 `Refresh & Run` 后：

```txt
Rows > 0
Status: success
```

- Console 可访问：

```js
window.__ROOTDATA_FUNDRAISING_DATA__
```

### 第二阶段

- 人为制造异常或遇验证码时，3 次重试后服务端收到告警。

### 第三阶段

- 每天 07:10、18:10 自动刷新并采集。
- 服务端成功入库。
- 重复项目不重复创建。
- 异常有告警。

