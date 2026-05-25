// ==UserScript==
// @name         RootData Fundraising Scheduled Reader
// @namespace    https://cryptohunt.ai/
// @version      0.4.1
// @description  Scheduled RootData fundraising reader with refresh, retry, import and alert.
// @author       luykin
// @match        https://www.rootdata.com/fundraising*
// @match        https://www.rootdata.com/Fundraising*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    // TODO: 部署时改成真实 API 域名，例如 https://api.cryptohunt.ai
    API_BASE: "https://kb.cryptohunt.ai",
    ALERT_ENDPOINT: "/api/internal/rootdata/fundraising/alert",
    IMPORT_ENDPOINT: "/api/internal/rootdata/fundraising/import",
    DETAIL_IMPORT_ENDPOINT: "/api/internal/rootdata/fundraising/details/import",
    DETAIL_FAILURE_ENDPOINT: "/api/internal/rootdata/fundraising/details/failure",
    PING_ENDPOINT: "/api/internal/rootdata/fundraising/ping",
    CLIENT_TOKEN: "ct_uWOoKsZ9_MzozUUrVkc9gGnyvBQAp96pVmvLu7R1WE4",

    // 北京时间：对应原 scheduler 的 07:10 与 18:10
    scheduleBeijingTimes: ["07:10", "18:10"],
    scheduleCheckIntervalMs: 30 * 1000,

    maxWaitMs: 30 * 1000,
    pollIntervalMs: 500,
    maxRetries: 3,
    retryDelayMs: 10 * 1000,
    detailEnabled: true,
    detailMaxProjectsPerRun: 30,
    subDetailMaxProjectsPerRun: 80,
    detailFrameTimeoutMs: 20 * 1000,
    detailFramePollIntervalMs: 500,
    detailBetweenMs: 1200,

    panelId: "rd-fundraising-reader-panel-v3",
    detailFrameId: "rd-fundraising-detail-frame-v3",
    storageKeys: {
      pendingJob: "rd_fr_pending_job_v3",
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
      const match = url.pathname.match(/^\/(?:projects|Projects|investors|Investors)\/detail\/([^/?#]+)/);
      if (!match?.[1]) return url.toString();

      const type = /\/(?:investors|Investors)\//.test(url.pathname) ? "Investors" : "Projects";
      url.protocol = "https:";
      url.hostname = "www.rootdata.com";
      url.pathname = `/${type}/detail/${match[1]}`;

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

  function parseNameFromDetailUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      const url = new URL(rawUrl, location.origin);
      const match = url.pathname.match(/\/(?:projects|Projects|investors|Investors)\/detail\/([^/?#]+)/);
      if (!match?.[1]) return "";
      return decodeURIComponent(match[1]).replace(/\+/g, " ").trim();
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
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = [
      "position: fixed",
      "left: -10000px",
      "top: 0",
      "width: 1280px",
      "height: 900px",
      "opacity: 0.01",
      "pointer-events: none",
      "border: 0",
      "z-index: -1",
    ].join(";");
    document.body.appendChild(frame);
    return frame;
  }

  function removeDetailFrame() {
    document.getElementById(CONFIG.detailFrameId)?.remove();
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
    let lastDetails = null;
    let loadedAt = 0;

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
      if (lastDetails.ready) return doc;
      if (
        !loadedAt &&
        doc.readyState === "complete" &&
        cleanText(doc.body?.innerText || "").length > 200
      ) {
        loadedAt = Date.now();
      }
      // RootData 详情页现在 class 变化较频繁，不能一直死等旧 class；
      // 页面 complete 后给 React/Next 再渲染 2 秒，然后交给通用解析器兜底。
      if (loadedAt && Date.now() - loadedAt > 2000) return doc;

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

  function isRootDataOwnedExternalLink(link) {
    const href = String(link?.href || "");
    const text = cleanText(link?.textContent || link?.getAttribute("aria-label") || "").toLowerCase();
    if (!href) return true;

    try {
      const url = new URL(href);
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

  function normalizeXUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      const url = new URL(rawUrl);
      const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      if (hostname !== "x.com" && hostname !== "twitter.com") return "";
      if (!url.pathname || url.pathname === "/") return "";
      url.protocol = "https:";
      url.hostname = "x.com";
      url.hash = "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function sanitizeParsedSocialLinks(rawSocialLinks) {
    const result = {};

    for (const [rawKey, rawUrl] of Object.entries(rawSocialLinks || {})) {
      const key = rawKey === "twitter" ? "x" : rawKey;
      if (key === "x") {
        const xUrl = normalizeXUrl(rawUrl);
        if (xUrl) result.x = xUrl;
        continue;
      }
      if (result.x && rawUrl) result[key] = rawUrl;
    }

    // 坤哥要求：没有合法 x.com 的 x，就整组 socialLinks 丢弃，避免污染 twitterUrl。
    return result.x ? result : {};
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
        'a[href*="/investors/detail/"], a[href*="/Investors/detail/"], a[href*="/projects/detail/"], a[href*="/Projects/detail/"]'
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
            lead: !!item.querySelector(".status_icon.status_position") || /\*/.test(cleanText(item.textContent)),
            source: "initial",
          };
        })
        .filter(Boolean);
    }

    const sections = findSectionElementsByKeywords(doc, [
      "investor",
      "investors",
      "funding",
      "financing",
      "round",
      "backers",
      "投资",
      "融资",
    ]);

    return uniqueByLink(
      sections.flatMap((section) =>
        collectEntityLinks(section, detailUrl).map((entity) => ({
          ...entity,
          lead: /\*/.test(cleanText(section.textContent)),
          source: "section",
        }))
      )
    );
  }

  function parseRoundsInvestors(doc) {
    const result = [];
    const tables = Array.from(doc.querySelectorAll(".investor table, table"));

    for (const table of tables) {
      const headerCells = Array.from(
        table.querySelectorAll("thead th, tr:first-child th, tr:first-child td")
      );
      const headerTexts = headerCells.map((th) => cleanText(th.textContent).toLowerCase());
      if (!headerTexts.length) continue;

      const hasInvestorColumn = headerTexts.some((text) => /investor|backer|投资/.test(text));
      const hasRoundColumn = headerTexts.some((text) => /round|轮次|amount|valuation|date|金额|估值|日期/.test(text));
      if (!hasInvestorColumn && !hasRoundColumn) continue;

      const findIndexBy = (regex, fallbackIndex) => {
        const index = headerTexts.findIndex((text) => regex.test(text));
        return index >= 0 ? index : fallbackIndex;
      };

      const idxRound = findIndexBy(/round|轮次/i, 0);
      const idxAmount = findIndexBy(/amount|金额/i, 1);
      const idxValuation = findIndexBy(/valuation|估值/i, 2);
      const idxDate = findIndexBy(/date|日期/i, 3);
      const idxInvestors = findIndexBy(/investor|backer|投资/i, Math.max(headerCells.length - 1, 0));

      Array.from(table.querySelectorAll("tr"))
        .slice(1)
        .forEach((row) => {
        const cells = row.querySelectorAll("td");
        const investorCell = cells[idxInvestors];
          if (!investorCell) return;

          Array.from(investorCell.querySelectorAll("a[href]"))
          .map((anchor) => {
            const entity = readEntityLink(anchor);
            if (!entity) return null;
            const anchorText = cleanText(anchor.textContent);
            return {
              ...entity,
              lead: anchorText.includes("*"),
              round: cleanText(cells[idxRound]?.textContent) || "--",
              amount: cleanText(cells[idxAmount]?.textContent),
              valuation: cleanText(cells[idxValuation]?.textContent),
              date: cleanText(cells[idxDate]?.textContent),
              source: "rounds",
            };
          })
            .filter(Boolean)
            .forEach((item) => result.push(item));
        });
    }

    const seen = new Set();
    return result.filter((item) => {
      const key = `${item.projectLink}|${item.round || "--"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function mergeInvestorData(initial, rounds) {
    const resultMap = new Map();
    const roundNames = new Set();

    for (const item of rounds || []) {
      roundNames.add(item.projectName);
      const key = `${item.projectLink}|${item.round || "--"}`;
      if (!resultMap.has(key)) resultMap.set(key, item);
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

  function parseInvestmentItems(doc, detailUrl) {
    const oldItems = Array.from(doc.querySelectorAll(".investment .row.list .item a.card, .investment a.card"))
      .map(readEntityLink)
      .filter(Boolean);
    if (oldItems.length) return uniqueByLink(oldItems);

    const sections = findSectionElementsByKeywords(doc, [
      "portfolio",
      "investments",
      "investment",
      "invested",
      "投资组合",
      "对外投资",
    ]);

    return uniqueByLink(
      sections.flatMap((section) =>
        collectEntityLinks(section, detailUrl, { allowProjects: true, allowInvestors: false })
      )
    );
  }

  function clickButtonsByText(doc, regex) {
    Array.from(doc.querySelectorAll("button")).forEach((button) => {
      if (!regex.test(cleanText(button.textContent))) return;
      const EventCtor = doc.defaultView?.MouseEvent || MouseEvent;
      button.dispatchEvent(new EventCtor("click", { view: doc.defaultView, bubbles: true, cancelable: true }));
    });
  }

  async function scrapeInvestedProjectsFromDetail(doc, detailUrl) {
    if (doc.querySelector(".investment")) {
      clickButtonsByText(doc, /portfolio/i);
      await sleep(1800);
    }
    const portfolio = parseInvestmentItems(doc, detailUrl);

    let vc = [];
    if (doc.querySelector(".investment") && /\/(?:investors|Investors)\/detail\//.test(detailUrl)) {
      clickButtonsByText(doc, /\bvc\b/i);
      await sleep(1800);
      vc = parseInvestmentItems(doc, detailUrl);
    }

    return uniqueByLink([...portfolio, ...vc]);
  }

  function parseBasicDetail(doc, detailUrl) {
    const socialLinks = {};
    const detailRoot = doc.querySelector("main") || doc.body || doc;
    detailRoot.querySelectorAll(
      [
        ".base_info .links a[href]",
        ".base_info a[href]",
        '[class*="base" i] [class*="link" i] a[href]',
        '[class*="social" i] a[href]',
        '[class*="contact" i] a[href]',
        'a[href^="http"]',
      ].join(",")
    ).forEach((link) => {
      if (link.closest("header, footer, nav")) return;
      if (isRootDataOwnedExternalLink(link)) return;
      const inferredType = inferSocialType(link);
      const labelType = cleanText(link.querySelector("span")?.textContent).toLowerCase();
      const type = /^(website|x|twitter|linkedin|discord|telegram|medium|github|docs?)$/.test(inferredType)
        ? inferredType
        : (labelType || inferredType);
      const href = link.href || "";
      if (!type || !/^https?:\/\//i.test(href)) return;
      // 详情页内部 RootData 链接不算 socialLinks，避免把项目/投资方详情链接误存成官网。
      if (/^https?:\/\/(?:www\.)?rootdata\.com\//i.test(href)) return;
      socialLinks[type] = href;
    });

    const safeSocialLinks = sanitizeParsedSocialLinks(socialLinks);

    const teamMembers = Array.from(doc.querySelectorAll(".team_member .item, .team-member .item"))
      .map((member) => ({
        name: cleanText(member.querySelector(".content h2, h2")?.textContent),
        position: cleanText(member.querySelector(".content p, p")?.textContent),
        avatar: member.querySelector(".logo-wraper img, img")?.src || "",
        profileLink: absoluteUrl(member.querySelector("a.card, a[href]")?.getAttribute("href") || ""),
      }))
      .filter((member) => member.name || member.profileLink);

    const projectName =
      cleanText(doc.querySelector(".detail_info_head h1.name, .detail_info_head h1, h1.name")?.textContent) ||
      cleanText(doc.querySelector('meta[property="og:title"], meta[name="twitter:title"]')?.getAttribute("content")) ||
      cleanText(doc.title).replace(/\s*[-|]\s*RootData.*$/i, "") ||
      parseNameFromDetailUrl(detailUrl);
    const logo =
      doc.querySelector(".detail_info_head .logo, .detail_info_head img, img.logo")?.src ||
      doc.querySelector('meta[property="og:image"], meta[name="twitter:image"]')?.getAttribute("content") ||
      Array.from(doc.querySelectorAll("img[src]"))
        .map((img) => img.src)
        .find((src) => /public\.rootdata\.com|\/images\//i.test(src)) ||
      "";

    return {
      socialLinks: safeSocialLinks,
      teamMembers,
      projectName: normalizeEntityName(projectName, detailUrl),
      logo,
    };
  }

  function parseDetailDocument(doc, detailUrl, { isInitial = true, dryRun = false } = {}) {
    const basic = parseBasicDetail(doc, detailUrl);
    const initialInvestors = isInitial ? parseInitialInvestors(doc, detailUrl) : [];
    const roundsInvestors = isInitial ? parseRoundsInvestors(doc) : [];
    const investors = isInitial ? mergeInvestorData(initialInvestors, roundsInvestors) : [];
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
        teamMembers: basic.teamMembers.length,
        investorItems: doc.querySelectorAll(".investor .item").length,
        investorRows: doc.querySelectorAll(".investor tr").length,
        investmentItems: doc.querySelectorAll(".investment .item").length,
      },
    };
  }

  async function crawlDetailPage(frame, item, { isInitial = true } = {}) {
    const detailUrl = canonicalRootDataDetailUrl(absoluteUrl(item.projectLink));
    const doc = await loadDetailDocument(frame, detailUrl);

    clickButtonsByText(doc, /expand\s*more/i);
    await sleep(800);

    if (isInitial) {
      clickButtonsByText(doc, /rounds/i);
      await sleep(1000);
    }

    const details = parseDetailDocument(doc, detailUrl, { isInitial });
    if (isInitial) {
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

  async function submitDetailData(detail, job) {
    return requestJson({
      url: `${CONFIG.API_BASE}${CONFIG.DETAIL_IMPORT_ENDPOINT}`,
      body: {
        ...detail,
        scheduleSlot: job?.slot || null,
      },
    });
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

  function buildDetailQueueFromRows(rows) {
    return uniqueByLink(rows)
      .filter((item) => /rootdata\.com\/(?:projects|Projects)\/detail\//.test(item.projectLink))
      .slice(0, CONFIG.detailMaxProjectsPerRun);
  }

  async function crawlDetailsForRows(rows, job) {
    if (!CONFIG.detailEnabled) {
      return { enabled: false, initialSuccess: 0, initialFailed: 0, subSuccess: 0, subFailed: 0 };
    }

    const frame = ensureDetailFrame();
    const initialQueue = buildDetailQueueFromRows(rows);
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

      const subQueue = Array.from(subDetailMap.values()).slice(0, CONFIG.subDetailMaxProjectsPerRun);
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
          await submitDetailData(detail, job);
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

      try {
        const importResult = await submitData(data, job);
        console.log("[RootData Reader] import result:", importResult);
        renderPanel({ ok: true, status: "success_imported_crawling_details", retryCount: job.retryCount || 0, data });
        const detailStats = await crawlDetailsForRows(data, job);
        console.log("[RootData Reader] detail crawl result:", detailStats);
        renderPanel({
          ok: true,
          status: "success_imported_with_details",
          retryCount: job.retryCount || 0,
          data,
          detailStats,
        });
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
       * 只跑详情页采集：会用隐藏 iframe 顺序打开第一页项目详情，不会跳走当前列表页。
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
        return crawlDetailsForRows(data, job);
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
            detailImportEndpoint: CONFIG.DETAIL_IMPORT_ENDPOINT,
            detailFailureEndpoint: CONFIG.DETAIL_FAILURE_ENDPOINT,
            pingEndpoint: CONFIG.PING_ENDPOINT,
            scheduleBeijingTimes: CONFIG.scheduleBeijingTimes,
            maxRetries: CONFIG.maxRetries,
            detailEnabled: CONFIG.detailEnabled,
            detailMaxProjectsPerRun: CONFIG.detailMaxProjectsPerRun,
            subDetailMaxProjectsPerRun: CONFIG.subDetailMaxProjectsPerRun,
            tokenConfigured:
              Boolean(CONFIG.CLIENT_TOKEN) &&
              CONFIG.CLIENT_TOKEN !== "REPLACE_WITH_LONG_RANDOM_TOKEN",
          },
          pendingJob: getPendingJob(),
          lastResult: safeJsonParse(localStorage.getItem(CONFIG.storageKeys.lastResult), null),
          beijingTime: getBeijingParts().full,
        };
      },

      clearPendingJob,
    };

    window.RootDataFundraisingCollector = debugApi;
    PAGE_WINDOW.RootDataFundraisingCollector = debugApi;

    console.log(
      "[RootData Reader] debug api ready: RootDataFundraisingCollector.run(), scrapeNow(), parse(), crawlDetailsNow(), debugDetail(url), testConnection(), sendTestAlert(), status()"
    );
  }

  exposeDebugApi();
  testConnection({ silent: false });
  initScheduleLoop();
  bootstrap();
})();
