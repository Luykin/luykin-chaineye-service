// ==UserScript==
// @name         Crunchbase Company Research Reader
// @namespace    https://cryptohunt.ai/
// @version      0.1.3
// @description  Browser-side Crunchbase company list/profile/financial details reader for research. No backend submit in this test version.
// @author       luykin
// @match        https://www.crunchbase.com/*
// @match        https://*.crunchbase.com/*
// @include      https://www.crunchbase.com/*
// @include      https://*.crunchbase.com/*
// @include      http://www.crunchbase.com/*
// @include      http://*.crunchbase.com/*
// @noframes
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================================
  // SECTION 1: CONFIG AND STATE
  // ============================================================================

  const CONFIG = {
    panelId: "cb-company-reader-panel-v1",
    panelHostId: "cb-company-reader-panel-host-v1",
    maxWaitMs: 60 * 1000,
    pollIntervalMs: 500,
    navigateDelayMs: 900,
    detailBetweenMs: 3000,
    storageKeys: {
      detailJob: "cb_company_detail_job_v1",
      lastList: "cb_company_last_list_v1",
      lastResult: "cb_company_last_result_v1",
    },
  };

  const PAGE_WINDOW =
    typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;

  console.log("[Crunchbase Reader] userscript loaded", {
    href: location.href,
    title: document.title,
    runAt: nowIso(),
  });

  // ============================================================================
  // SECTION 2: COMMON UTILITIES
  // ============================================================================

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\u200B/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function absoluteUrl(href) {
    if (!href) return "";
    try {
      return new URL(href, location.origin).toString();
    } catch (_) {
      return href;
    }
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value || "");
    } catch (_) {
      return fallback;
    }
  }

  function getStorage(key, fallback) {
    return safeJsonParse(localStorage.getItem(key), fallback);
  }

  function setStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function removeStorage(key) {
    localStorage.removeItem(key);
  }

  function unique(values) {
    return [...new Set(values.map(cleanText).filter(Boolean))];
  }

  function getUniqueTitles(root) {
    if (!root) return [];
    return unique(
      [...root.querySelectorAll("[title]")].map((el) => el.getAttribute("title"))
    );
  }

  function getLinks(root) {
    if (!root) return [];
    return [...root.querySelectorAll("a[href]")]
      .map((a) => ({
        text: cleanText(
          a.getAttribute("title") || a.getAttribute("aria-label") || a.textContent
        ),
        href: absoluteUrl(a.getAttribute("href")),
      }))
      .filter((link) => link.text || link.href);
  }

  function slugFromUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      const url = new URL(rawUrl, location.origin);
      return url.pathname.match(/^\/organization\/([^/?#]+)/)?.[1] || "";
    } catch (_) {
      return String(rawUrl).match(/\/organization\/([^/?#]+)/)?.[1] || "";
    }
  }

  function currentOrganizationSlug() {
    return location.pathname.match(/^\/organization\/([^/?#]+)/)?.[1] || "";
  }

  function companyUrl(slug) {
    return slug ? `https://www.crunchbase.com/organization/${slug}` : "";
  }

  function financialDetailsUrl(slug) {
    return slug
      ? `https://www.crunchbase.com/organization/${slug}/financial_details`
      : "";
  }

  function isDiscoverPage() {
    return /^\/discover\/organization\.companies\//.test(location.pathname);
  }

  function isOrganizationProfilePage() {
    return /^\/organization\/[^/?#]+\/?$/.test(location.pathname);
  }

  function isFinancialDetailsPage() {
    return /^\/organization\/[^/?#]+\/financial_details\/?$/.test(location.pathname);
  }

  function detectPageWarnings(doc = document) {
    const text = cleanText(doc.body?.textContent || "");
    const patterns = [
      "You've reached your monthly limit",
      "You’ve reached your monthly limit",
      "Sign in",
      "Log in",
      "Verify you are human",
      "Access Denied",
      "Too Many Requests",
      "Something went wrong",
    ];
    return patterns.filter((pattern) => text.includes(pattern));
  }

  async function waitForSelector(selector, timeoutMs = CONFIG.maxWaitMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (document.querySelector(selector)) return true;
      await sleep(CONFIG.pollIntervalMs);
    }
    return false;
  }

  async function waitForStableTableRows(timeoutMs = 10 * 1000) {
    const start = Date.now();
    let lastCount = -1;
    let stableTicks = 0;

    while (Date.now() - start < timeoutMs) {
      const count = document.querySelectorAll("table tbody tr").length;
      if (count > 0 && count === lastCount) {
        stableTicks += 1;
        if (stableTicks >= 3) return count;
      } else {
        stableTicks = 0;
        lastCount = count;
      }
      await sleep(CONFIG.pollIntervalMs);
    }

    return document.querySelectorAll("table tbody tr").length;
  }

  async function prepareFinancialDetailsPage() {
    await waitForSelector("table, mat-card", CONFIG.maxWaitMs);

    // Crunchbase uses Angular + lazy-rendered cards. A small scroll pass helps
    // trigger financial tables without trying to bypass any permission limits.
    const originalX = window.scrollX;
    const originalY = window.scrollY;
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const stops = [...new Set([0, Math.round(maxY * 0.35), Math.round(maxY * 0.7), originalY])];

    for (const y of stops) {
      window.scrollTo(originalX, y);
      await sleep(450);
    }
    window.scrollTo(originalX, originalY);
    await waitForStableTableRows();
  }

  function navigateTo(url, reason, delayMs = CONFIG.navigateDelayMs) {
    if (!url) return;
    console.log("[Crunchbase Reader] navigate", { reason, url, delayMs });
    renderPanel(`Navigating: ${reason}`);
    setTimeout(() => {
      location.href = url;
    }, delayMs);
  }

  async function copyText(text) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text, "text");
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  }

  // ============================================================================
  // SECTION 3: LIST PAGE PARSER
  // ============================================================================

  function parseCompanyListRows(doc = document) {
    const rows = [...doc.querySelectorAll("grid-row:not(.blurred-row)")];

    const parsed = rows
      .map((row, index) => {
        const cell = (id) => row.querySelector(`grid-cell[data-columnid="${id}"]`);
        const identifierCell = cell("identifier");
        const link = identifierCell?.querySelector('a[href*="/organization/"]');
        const href = absoluteUrl(link?.getAttribute("href") || "");
        const slug = slugFromUrl(href);
        const shortDescriptionCell = cell("short_description");

        const categories = getUniqueTitles(cell("categories"));
        const locations = getUniqueTitles(cell("location_identifiers"));

        return {
          source: "crunchbase",
          index: index + 1,
          name: cleanText(
            link?.getAttribute("title") ||
              link?.getAttribute("aria-label") ||
              link?.textContent
          ),
          slug,
          detailUrl: href || companyUrl(slug),
          financialDetailsUrl: financialDetailsUrl(slug),
          logo: absoluteUrl(
            identifierCell?.querySelector("img")?.getAttribute("src") || ""
          ),
          categories,
          lastFundingAtText: cleanText(cell("last_funding_at")?.textContent),
          locations,
          shortDescription: cleanText(
            shortDescriptionCell
              ?.querySelector("[title]")
              ?.getAttribute("title") || shortDescriptionCell?.textContent
          ),
          rankOrg: cleanText(cell("rank_org")?.textContent),
          rankOrgCompany: cleanText(cell("rank_org_company")?.textContent),
          pageUrl: location.href,
          scrapedAt: nowIso(),
        };
      })
      .filter((row) => row.name && row.slug && row.detailUrl);

    const result = {
      source: "crunchbase",
      type: "company_list",
      pageUrl: location.href,
      title: document.title,
      rowCount: parsed.length,
      skippedBlurredRows: doc.querySelectorAll("grid-row.blurred-row").length,
      warnings: detectPageWarnings(doc),
      rows: parsed,
      scrapedAt: nowIso(),
    };

    setStorage(CONFIG.storageKeys.lastList, result);
    setStorage(CONFIG.storageKeys.lastResult, result);
    console.log("[Crunchbase Reader] parsed list", result);
    return result;
  }

  // ============================================================================
  // SECTION 4: PROFILE PAGE PARSER
  // ============================================================================

  function parseTileFields(root = document) {
    const fields = {};

    for (const tile of root.querySelectorAll("tile-field")) {
      const label = cleanText(tile.querySelector("label-with-info")?.textContent);
      const formatter = tile.querySelector("field-formatter");
      if (!label || !formatter) continue;

      const value = {
        text: cleanText(formatter.textContent),
        links: getLinks(formatter),
      };

      if (!fields[label]) {
        fields[label] = value;
      } else if (Array.isArray(fields[label])) {
        fields[label].push(value);
      } else {
        fields[label] = [fields[label], value];
      }
    }

    return fields;
  }

  function findCardByHeading(headingText, doc = document) {
    const wanted = headingText.toLowerCase();
    return [...doc.querySelectorAll("mat-card")].find((card) => {
      const heading = cleanText(
        card.querySelector("h1,h2,h3,mat-card-title")?.textContent || ""
      ).toLowerCase();
      return heading.includes(wanted);
    });
  }

  function parseKeyPeople(doc = document) {
    const card = findCardByHeading("Key People", doc);
    if (!card) return [];

    const links = getLinks(card).filter((link) => /\/person\//.test(link.href));
    if (links.length) return links;

    return cleanText(card.textContent)
      .replace(/^Key People/i, "")
      .split(/(?=[A-Z][A-Za-z .'-]+:)/)
      .map(cleanText)
      .filter(Boolean)
      .map((text) => ({ text, href: "" }));
  }

  function parseProductsAndServices(doc = document) {
    const card = findCardByHeading("Products & Services", doc);
    if (!card) return [];
    return [...card.querySelectorAll("h3, h4, [title]")]
      .map((el) => cleanText(el.getAttribute("title") || el.textContent))
      .filter((text) => text && text !== "Products & Services")
      .slice(0, 30);
  }

  function parseCompanyProfile(doc = document) {
    const slug = currentOrganizationSlug();
    const rawFields = parseTileFields(doc);
    const aboutCard = findCardByHeading("About", doc);
    const detailsCard = findCardByHeading("Details", doc);

    const titleName = cleanText(
      doc.querySelector("h1")?.textContent ||
        doc.title.replace(/\s+-\s+Crunchbase.*$/i, "")
    );

    const websiteLink = [...doc.querySelectorAll('a[href^="http"]')].find((a) => {
      const href = a.getAttribute("href") || "";
      return !href.includes("crunchbase.com") && !href.includes("crunchbase-production-res.cloudinary.com");
    });

    const profile = {
      source: "crunchbase",
      type: "company_profile",
      slug,
      name: titleName,
      detailUrl: companyUrl(slug),
      pageUrl: location.href,
      title: doc.title,
      warnings: detectPageWarnings(doc),
      rawFields,
      aboutText: cleanText(aboutCard?.textContent || ""),
      detailsText: cleanText(detailsCard?.textContent || ""),
      keyPeople: parseKeyPeople(doc),
      productsAndServices: parseProductsAndServices(doc),
      website: absoluteUrl(websiteLink?.getAttribute("href") || ""),
      links: getLinks(doc)
        .filter((link) => /\/organization\/|\/person\/|\/funding_round\//.test(link.href))
        .slice(0, 120),
      scrapedAt: nowIso(),
    };

    console.log("[Crunchbase Reader] parsed profile", profile);
    return profile;
  }

  // ============================================================================
  // SECTION 5: FINANCIAL DETAILS PARSER
  // ============================================================================

  function isObfuscatedText(value) {
    return /obfuscated|blurred|hidden|unlock|subscribe/i.test(cleanText(value));
  }

  function parseCompactMoney(value) {
    const raw = cleanText(value);
    if (!raw || raw === "—" || raw === "-") {
      return {
        raw,
        obfuscated: false,
        currencyCode: "",
        currencySymbol: "",
        amount: null,
        unit: "",
        multiplier: 1,
        valueInOriginalCurrency: null,
      };
    }

    if (isObfuscatedText(raw)) {
      return {
        raw,
        obfuscated: true,
        currencyCode: "",
        currencySymbol: "",
        amount: null,
        unit: "",
        multiplier: 1,
        valueInOriginalCurrency: null,
      };
    }

    const currencyMap = [
      ["CN¥", "CNY"],
      ["RMB", "CNY"],
      ["CNY", "CNY"],
      ["HK$", "HKD"],
      ["HKD", "HKD"],
      ["US$", "USD"],
      ["USD", "USD"],
      ["A$", "AUD"],
      ["AUD", "AUD"],
      ["CA$", "CAD"],
      ["C$", "CAD"],
      ["CAD", "CAD"],
      ["S$", "SGD"],
      ["SGD", "SGD"],
      ["NZ$", "NZD"],
      ["NZD", "NZD"],
      ["€", "EUR"],
      ["EUR", "EUR"],
      ["£", "GBP"],
      ["GBP", "GBP"],
      ["¥", "JPY"],
      ["JPY", "JPY"],
      ["₹", "INR"],
      ["INR", "INR"],
      ["₩", "KRW"],
      ["KRW", "KRW"],
      ["$", "USD"],
    ];

    const normalized = raw.replace(/,/g, "").trim();
    const match = normalized.match(
      /^(CN¥|RMB|CNY|HK\$|HKD|US\$|USD|A\$|AUD|CA\$|C\$|CAD|S\$|SGD|NZ\$|NZD|€|EUR|£|GBP|¥|JPY|₹|INR|₩|KRW|\$)?\s*([0-9]+(?:\.[0-9]+)?)\s*(T|B|M|K|万亿|千亿|百亿|十亿|亿|千万|百万|万)?/i
    );

    if (!match) {
      return {
        raw,
        obfuscated: false,
        currencyCode: "",
        currencySymbol: "",
        amount: null,
        unit: "",
        multiplier: 1,
        valueInOriginalCurrency: null,
      };
    }

    const currencySymbol = match[1] || "";
    const amount = Number(match[2]);
    const unit = (match[3] || "").toUpperCase();
    const currencyCode =
      currencyMap.find(([symbol]) => symbol.toUpperCase() === currencySymbol.toUpperCase())?.[1] ||
      "";
    const multipliers = {
      K: 1e3,
      M: 1e6,
      B: 1e9,
      T: 1e12,
      "万": 1e4,
      "百万": 1e6,
      "千万": 1e7,
      "亿": 1e8,
      "十亿": 1e9,
      "百亿": 1e10,
      "千亿": 1e11,
      "万亿": 1e12,
    };
    const multiplier = multipliers[unit] || 1;

    return {
      raw,
      obfuscated: false,
      currencyCode,
      currencySymbol,
      amount: Number.isFinite(amount) ? amount : null,
      unit,
      multiplier,
      valueInOriginalCurrency: Number.isFinite(amount) ? amount * multiplier : null,
    };
  }

  function rowSignature(row, headers) {
    return headers
      .map((header) => {
        const cell = row[header] || {};
        const links = (cell.links || []).map((link) => link.href || link.text).join(",");
        return `${header}:${cell.text || ""}:${links}`;
      })
      .join("|");
  }

  function dedupeRows(rows, headers) {
    const seen = new Set();
    const output = [];
    for (const row of rows) {
      const signature = rowSignature(row, headers);
      if (!signature || seen.has(signature)) continue;
      seen.add(signature);
      output.push(row);
    }
    return output;
  }

  function dedupeObjects(items, getKey) {
    const seen = new Set();
    const output = [];
    for (const item of items || []) {
      const key = cleanText(getKey(item));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }
    return output;
  }

  function parseTable(table) {
    const headers = [...table.querySelectorAll("thead th")].map((th) =>
      cleanText(th.textContent)
    );

    const rows = [...table.querySelectorAll("tbody tr")]
      .map((tr) => {
        const cells = [...tr.querySelectorAll("td")];
        const row = {};

        headers.forEach((header, index) => {
          const td = cells[index];
          if (!td || !header) return;
          row[header] = {
            text: cleanText(td.textContent),
            links: getLinks(td),
          };
        });

        return row;
      })
      .filter((row) => Object.keys(row).length > 0);

    return dedupeRows(rows, headers);
  }

  function normalizeFundingRoundRow(row) {
    const transaction = row["Transaction Name"] || {};
    const leadInvestors = row["Lead Investors"] || {};
    const moneyRaisedRaw = row["Money Raised"]?.text || "";
    const moneyRaisedParsed = parseCompactMoney(moneyRaisedRaw);

    return {
      announcedDate: row["Announced Date"]?.text || "",
      transactionName: transaction.text || "",
      transactionUrl: transaction.links?.[0]?.href || "",
      numberOfInvestors: row["Number of Investors"]?.text || "",
      moneyRaised: moneyRaisedParsed.obfuscated ? "" : moneyRaisedRaw,
      moneyRaisedRaw,
      moneyRaisedParsed,
      moneyRaisedObfuscated: moneyRaisedParsed.obfuscated,
      leadInvestorsText: leadInvestors.text || "",
      leadInvestors: leadInvestors.links || [],
      fundingType: row["Funding Type"]?.text || "",
      raw: row,
    };
  }

  function normalizeInvestorRow(row) {
    const investor = row["Investor Name"] || {};
    const fundingRound = row["Funding Round"] || {};
    const partners = row["Partners"] || {};

    return {
      investorName: investor.text || "",
      investorUrl: investor.links?.[0]?.href || "",
      isLeadInvestor: /^(yes|true)$/i.test(row["Lead Investor"]?.text || ""),
      leadInvestorText: row["Lead Investor"]?.text || "",
      fundingRoundName: fundingRound.text || "",
      fundingRoundUrl: fundingRound.links?.[0]?.href || "",
      partnersText: partners.text || "",
      partners: partners.links || [],
      raw: row,
    };
  }

  function firstFieldValue(fields, labels) {
    for (const label of labels) {
      const value = fields?.[label];
      if (!value) continue;
      const first = Array.isArray(value) ? value[0] : value;
      if (first?.text || first?.links?.length) return first;
    }
    return null;
  }

  function buildFinancialNormalized(financials) {
    const summary = financials.summaryFields || {};
    const totalFunding = firstFieldValue(summary, ["Total Funding Amount"]);
    const fundingRoundsCount = firstFieldValue(summary, [
      "Funding Rounds",
      "Number of Funding Rounds",
    ]);
    const investorsCount = firstFieldValue(summary, ["Investors", "Number of Investors"]);
    const leadInvestorsCount = firstFieldValue(summary, [
      "Lead Investors",
      "Number of Lead Investors",
    ]);
    const ipoValuation = firstFieldValue(summary, ["Valuation at IPO"]);
    const latestFundingRound = financials.fundingRounds?.[0] || null;

    return {
      totalFundingAmount: totalFunding?.text || "",
      totalFundingAmountParsed: parseCompactMoney(totalFunding?.text || ""),
      fundingRoundCount: fundingRoundsCount?.text || "",
      investorCount: investorsCount?.text || "",
      leadInvestorCount: leadInvestorsCount?.text || "",
      ipoValuation: ipoValuation?.text || "",
      ipoValuationParsed: parseCompactMoney(ipoValuation?.text || ""),
      latestFundingRound,
      latestFundingDate: latestFundingRound?.announcedDate || "",
      latestFundingType: latestFundingRound?.fundingType || "",
      latestMoneyRaised: latestFundingRound?.moneyRaised || "",
      latestMoneyRaisedParsed: latestFundingRound?.moneyRaisedParsed || null,
      latestLeadInvestors: latestFundingRound?.leadInvestors || [],
    };
  }

  function parseFinancialDetails(doc = document) {
    const slug = currentOrganizationSlug();
    const tables = [...doc.querySelectorAll("table")].map((table) => {
      const headers = [...table.querySelectorAll("thead th")].map((th) =>
        cleanText(th.textContent)
      );
      return { headers, rows: parseTable(table) };
    });

    const fundingRoundTable = tables.find(
      (table) =>
        table.headers.includes("Announced Date") &&
        table.headers.includes("Transaction Name")
    );
    const investorTable = tables.find(
      (table) =>
        table.headers.includes("Investor Name") &&
        table.headers.includes("Funding Round")
    );

    const fundingRounds = dedupeObjects(
      (fundingRoundTable?.rows || []).map(normalizeFundingRoundRow),
      (row) =>
        row.transactionUrl ||
        `${row.announcedDate}|${row.transactionName}|${row.fundingType}|${row.moneyRaisedRaw}`
    );
    const investors = dedupeObjects(
      (investorTable?.rows || []).map(normalizeInvestorRow),
      (row) =>
        `${row.investorUrl || row.investorName}|${row.fundingRoundUrl || row.fundingRoundName}`
    );

    const financials = {
      source: "crunchbase",
      type: "financial_details",
      slug,
      financialDetailsUrl: financialDetailsUrl(slug),
      pageUrl: location.href,
      title: doc.title,
      warnings: detectPageWarnings(doc),
      summaryFields: parseTileFields(doc),
      fundingRounds,
      investors,
      rawTables: tables,
      scrapedAt: nowIso(),
    };
    financials.normalized = buildFinancialNormalized(financials);

    console.log("[Crunchbase Reader] parsed financial details", financials);
    return financials;
  }

  function parseCurrentPage() {
    if (isDiscoverPage()) return parseCompanyListRows();
    if (isFinancialDetailsPage()) return parseFinancialDetails();
    if (isOrganizationProfilePage()) return parseCompanyProfile();
    return {
      source: "crunchbase",
      type: "unsupported_page",
      pageUrl: location.href,
      title: document.title,
      warnings: detectPageWarnings(),
      scrapedAt: nowIso(),
    };
  }

  // ============================================================================
  // SECTION 6: DETAIL JOB ORCHESTRATION
  // ============================================================================

  function getDetailJob() {
    return getStorage(CONFIG.storageKeys.detailJob, null);
  }

  function setDetailJob(job) {
    job.updatedAt = nowIso();
    setStorage(CONFIG.storageKeys.detailJob, job);
    setStorage(CONFIG.storageKeys.lastResult, job);
  }

  function clearDetailJob() {
    removeStorage(CONFIG.storageKeys.detailJob);
  }

  function upsertResult(job, slug, patch) {
    const index = job.results.findIndex((item) => item.slug === slug);
    if (index >= 0) {
      job.results[index] = {
        ...job.results[index],
        ...patch,
        updatedAt: nowIso(),
      };
    } else {
      const listRow = job.queue.find((item) => item.slug === slug) || { slug };
      job.results.push({ ...listRow, ...patch, updatedAt: nowIso() });
    }
  }

  function createDetailJobFromRows(rows, options = {}) {
    const limit = Number(options.limit || rows.length || 0);
    const queue = rows.slice(0, limit).map((row, index) => ({
      ...row,
      queueIndex: index,
      detailUrl: row.detailUrl || companyUrl(row.slug),
      financialDetailsUrl: row.financialDetailsUrl || financialDetailsUrl(row.slug),
    }));

    return {
      id: `cb_${Date.now()}`,
      source: "crunchbase",
      type: "company_detail_job",
      status: "running",
      sourceListUrl: location.href,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      index: 0,
      stage: "profile",
      queue,
      results: queue.map((row) => ({ slug: row.slug, listRow: row })),
      errors: [],
      options: {
        detailBetweenMs: CONFIG.detailBetweenMs,
      },
    };
  }

  async function startDetailCrawl(options = {}) {
    if (!isDiscoverPage()) {
      throw new Error("Please start detail crawl on a Crunchbase discover company list page.");
    }

    await waitForSelector('grid-row:not(.blurred-row) grid-cell[data-columnid="identifier"] a[href*="/organization/"]');
    const list = parseCompanyListRows();
    if (!list.rows.length) throw new Error("No visible company rows parsed.");

    const job = createDetailJobFromRows(list.rows, options);
    setDetailJob(job);
    renderPanel(`Started detail crawl: ${job.queue.length} companies`);

    const first = job.queue[0];
    navigateTo(first.detailUrl, `profile ${first.slug}`);
    return job;
  }

  function finishJob(job) {
    job.status = "completed";
    job.completedAt = nowIso();
    setDetailJob(job);
    renderPanel(`Completed: ${job.results.length} companies`);
    console.log("[Crunchbase Reader] detail job completed", job);
    return job;
  }

  function advanceJob(job, reason) {
    const item = job.queue[job.index];
    if (item) {
      upsertResult(job, item.slug, {
        status: "completed",
        completedAt: nowIso(),
      });
    }
    job.index += 1;
    job.stage = "profile";
    setDetailJob(job);

    if (job.index >= job.queue.length) return finishJob(job);

    const next = job.queue[job.index];
    navigateTo(next.detailUrl, `next profile ${next.slug} after ${reason}`, CONFIG.detailBetweenMs);
    return job;
  }

  function recordJobError(job, error, context = {}) {
    const message = error?.message || String(error || "unknown error");
    const item = job.queue[job.index];
    const entry = {
      message,
      context,
      slug: item?.slug || currentOrganizationSlug(),
      pageUrl: location.href,
      at: nowIso(),
    };
    job.errors.push(entry);
    if (item?.slug) {
      upsertResult(job, item.slug, { status: "error", lastError: entry });
    }
    console.warn("[Crunchbase Reader] job error", entry);
  }

  async function processCurrentJob() {
    const job = getDetailJob();
    if (!job || job.status !== "running") return null;

    const item = job.queue[job.index];
    if (!item) return finishJob(job);

    const expectedSlug = item.slug;
    const currentSlug = currentOrganizationSlug();

    try {
      if (job.stage === "profile") {
        if (!isOrganizationProfilePage() || currentSlug !== expectedSlug) {
          navigateTo(item.detailUrl, `expected profile ${expectedSlug}`);
          return job;
        }

        renderPanel(`Parsing profile ${job.index + 1}/${job.queue.length}: ${expectedSlug}`);
        await waitForSelector("mat-card, tile-field, h1", CONFIG.maxWaitMs);
        const profile = parseCompanyProfile();
        upsertResult(job, expectedSlug, {
          status: "profile_parsed",
          profile,
          profileParsedAt: nowIso(),
        });
        job.stage = "financial";
        setDetailJob(job);
        navigateTo(item.financialDetailsUrl, `financial details ${expectedSlug}`);
        return job;
      }

      if (job.stage === "financial") {
        if (!isFinancialDetailsPage() || currentSlug !== expectedSlug) {
          navigateTo(item.financialDetailsUrl, `expected financial details ${expectedSlug}`);
          return job;
        }

        renderPanel(`Parsing financials ${job.index + 1}/${job.queue.length}: ${expectedSlug}`);
        await prepareFinancialDetailsPage();
        const financials = parseFinancialDetails();
        upsertResult(job, expectedSlug, {
          status: "financial_parsed",
          financials,
          financialParsedAt: nowIso(),
        });
        setDetailJob(job);
        return advanceJob(job, `financial ${expectedSlug}`);
      }

      job.stage = "profile";
      setDetailJob(job);
      return job;
    } catch (error) {
      recordJobError(job, error, { stage: job.stage, index: job.index });
      setDetailJob(job);
      return advanceJob(job, `error ${expectedSlug}`);
    }
  }

  function pauseJob() {
    const job = getDetailJob();
    if (!job) return null;
    job.status = "paused";
    setDetailJob(job);
    renderPanel("Paused");
    return job;
  }

  function resumeJob() {
    const job = getDetailJob();
    if (!job) return null;
    job.status = "running";
    setDetailJob(job);
    const item = job.queue[job.index];
    if (item) {
      navigateTo(job.stage === "financial" ? item.financialDetailsUrl : item.detailUrl, "resume job");
    }
    return job;
  }

  async function copyLastResult() {
    const result = getStorage(CONFIG.storageKeys.lastResult, null) || parseCurrentPage();
    const text = JSON.stringify(result, null, 2);
    await copyText(text);
    renderPanel(`Copied JSON (${text.length} chars)`);
    return result;
  }

  // ============================================================================
  // SECTION 7: PANEL UI
  // ============================================================================

  function getPanelStatusText(extra = "") {
    const job = getDetailJob();
    const list = getStorage(CONFIG.storageKeys.lastList, null);
    const lines = [];

    lines.push(`<strong>Crunchbase Reader</strong>`);
    lines.push(`<span>${cleanText(extra || "Ready")}</span>`);
    lines.push(`<span>Page: ${isDiscoverPage() ? "List" : isFinancialDetailsPage() ? "Financial" : isOrganizationProfilePage() ? "Profile" : "Other"}</span>`);

    if (job) {
      lines.push(
        `<span>Job: ${job.status} ${Math.min(job.index + 1, job.queue.length)}/${job.queue.length} · ${job.stage}</span>`
      );
      if (job.errors?.length) lines.push(`<span>Errors: ${job.errors.length}</span>`);
    } else if (list) {
      lines.push(`<span>Last list: ${list.rowCount || 0} rows</span>`);
    }

    const warnings = detectPageWarnings();
    if (warnings.length) lines.push(`<span class="warn">Warnings: ${warnings.join(", ")}</span>`);

    return lines.join("");
  }

  function ensurePanel() {
    let host = document.getElementById(CONFIG.panelHostId);
    let root;

    if (!host) {
      host = document.createElement("div");
      host.id = CONFIG.panelHostId;
      host.style.cssText = [
        "position: fixed",
        "right: 16px",
        "bottom: 16px",
        "z-index: 2147483647",
        "width: 330px",
        "max-width: calc(100vw - 32px)",
        "display: block",
        "visibility: visible",
        "opacity: 1",
        "pointer-events: auto",
      ].join(";");
      (document.body || document.documentElement).appendChild(host);
    }

    root = host.shadowRoot || host.attachShadow({ mode: "open" });

    let panel = root.getElementById(CONFIG.panelId);
    if (panel) return panel;

    root.innerHTML = `
      <style>
        :host { all: initial; }
        #${CONFIG.panelId} {
          box-sizing: border-box;
          width: 330px;
          max-width: calc(100vw - 32px);
          background: rgba(17, 24, 39, 0.96);
          color: #fff;
          border: 1px solid rgba(255,255,255,0.22);
          border-radius: 12px;
          box-shadow: 0 14px 40px rgba(0,0,0,0.34);
          font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 12px;
          display: block;
          visibility: visible;
          opacity: 1;
          pointer-events: auto;
        }
        .cb-reader-body {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 10px;
          word-break: break-word;
        }
        .cb-reader-body strong { font-size: 13px; }
        .warn { color: #fbbf24; }
        .cb-reader-buttons {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        button {
          cursor: pointer;
          border: 1px solid rgba(255,255,255,0.18);
          border-radius: 8px;
          padding: 5px 8px;
          background: rgba(255,255,255,0.10);
          color: #fff;
          font-size: 12px;
          font-family: inherit;
        }
        button:hover { background: rgba(255,255,255,0.18); }
      </style>
      <div id="${CONFIG.panelId}">
        <div class="cb-reader-body"></div>
        <div class="cb-reader-buttons">
          <button data-action="parse">Parse</button>
          <button data-action="start">Start Details</button>
          <button data-action="pause">Pause</button>
          <button data-action="resume">Resume</button>
          <button data-action="copy">Copy JSON</button>
          <button data-action="clear">Clear</button>
        </div>
      </div>
    `;

    panel = root.getElementById(CONFIG.panelId);

    panel.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.getAttribute("data-action");

      try {
        if (action === "parse") {
          const result = parseCurrentPage();
          setStorage(CONFIG.storageKeys.lastResult, result);
          renderPanel(`Parsed ${result.rowCount || result.fundingRounds?.length || result.type}`);
        } else if (action === "start") {
          await startDetailCrawl();
        } else if (action === "pause") {
          pauseJob();
        } else if (action === "resume") {
          resumeJob();
        } else if (action === "copy") {
          await copyLastResult();
        } else if (action === "clear") {
          clearDetailJob();
          removeStorage(CONFIG.storageKeys.lastResult);
          renderPanel("Cleared job/result");
        }
      } catch (error) {
        console.error("[Crunchbase Reader] panel action failed", action, error);
        renderPanel(`Error: ${error.message || error}`);
      }
    });

    return panel;
  }

  function keepPanelMounted() {
    const host = document.getElementById(CONFIG.panelHostId);
    if (!host || !host.shadowRoot?.getElementById(CONFIG.panelId)) {
      renderPanel("Mounted");
      return;
    }
    host.style.display = "block";
    host.style.visibility = "visible";
    host.style.opacity = "1";
    host.style.zIndex = "2147483647";
  }

  function renderPanel(extra = "") {
    const panel = ensurePanel();
    const body = panel.querySelector(".cb-reader-body");
    if (body) body.innerHTML = getPanelStatusText(extra);
  }

  // ============================================================================
  // SECTION 8: DEBUG API AND BOOTSTRAP
  // ============================================================================

  function exposeDebugApi() {
    PAGE_WINDOW.CrunchbaseCompanyCollector = {
      parseList: parseCompanyListRows,
      parseProfile: parseCompanyProfile,
      parseFinancialDetails,
      parseCurrentPage,
      startDetails: startDetailCrawl,
      processCurrentJob,
      pause: pauseJob,
      resume: resumeJob,
      clear: () => {
        clearDetailJob();
        removeStorage(CONFIG.storageKeys.lastResult);
        renderPanel("Cleared");
        return true;
      },
      copy: copyLastResult,
      status: () => ({
        pageUrl: location.href,
        pageTitle: document.title,
        job: getDetailJob(),
        lastList: getStorage(CONFIG.storageKeys.lastList, null),
        lastResult: getStorage(CONFIG.storageKeys.lastResult, null),
        warnings: detectPageWarnings(),
      }),
    };

    console.log("[Crunchbase Reader] debug API exposed as CrunchbaseCompanyCollector");
  }

  async function bootstrap() {
    exposeDebugApi();

    if (!document.body) {
      await new Promise((resolve) => {
        if (document.body) return resolve();
        document.addEventListener("DOMContentLoaded", resolve, { once: true });
      });
    }

    renderPanel("Loaded");
    setInterval(keepPanelMounted, 2000);

    const job = getDetailJob();
    if (job?.status === "running" && (isOrganizationProfilePage() || isFinancialDetailsPage())) {
      await sleep(1000);
      await processCurrentJob();
    }
  }

  bootstrap().catch((error) => {
    console.error("[Crunchbase Reader] bootstrap failed", error);
    renderPanel(`Bootstrap error: ${error.message || error}`);
  });
})();
