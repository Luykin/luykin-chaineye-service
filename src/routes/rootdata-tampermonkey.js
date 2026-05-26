const express = require("express");
const crypto = require("crypto");
const { Op, literal } = require("sequelize");
const { Fundraising } = require("../models/postgres-fundraising");
const { XhuntAdminManager, CollectorClientToken } = require("../models/postgres-start");
const { sendEmail } = require("../services/emailService");
const { recordGenericStat } = require("../xhunt/services/generic-stats-service");

const router = express.Router();

const MAX_IMPORT_ROWS = parseInt(
  process.env.COLLECTOR_MAX_IMPORT_ROWS || "100",
  10
);
const MAX_DETAIL_QUEUE_LIMIT = parseInt(
  process.env.COLLECTOR_MAX_DETAIL_QUEUE_LIMIT || "5000",
  10
);

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function requireClientToken(req, res, next) {
  const configuredToken = process.env.COLLECTOR_CLIENT_TOKEN;
  const requestToken = req.get("x-collector-client-token");

  if (!requestToken) {
    return res.status(401).json({
      success: false,
      error: "UNAUTHORIZED",
      message: "缺少采集客户端 token",
    });
  }

  if (configuredToken && safeEqual(requestToken, configuredToken)) {
    req.collectorClient = {
      id: "env",
      name: "env.COLLECTOR_CLIENT_TOKEN",
      tokenPrefix: "env",
    };
    return next();
  }

  try {
    const row = await CollectorClientToken.findOne({
      where: {
        tokenHash: hashToken(requestToken),
        isActive: true,
      },
    });

    if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
        message: "采集客户端 token 不正确或已过期",
      });
    }

    row.lastUsedAt = new Date();
    row.save().catch((error) => {
      console.warn("[rootdata-tampermonkey] 更新 token lastUsedAt 失败:", error.message);
    });

    req.collectorClient = {
      id: String(row.id),
      name: row.name,
      tokenPrefix: row.tokenPrefix,
    };
    return next();
  } catch (error) {
    console.error("[rootdata-tampermonkey] token 校验失败:", error);
    return res.status(500).json({
      success: false,
      error: "TOKEN_VALIDATE_FAILED",
      message: "采集客户端 token 校验失败",
    });
  }
}

function cleanText(value, maxLength = 2000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function isDebugDetailTarget(value) {
  if (process.env.ROOTDATA_TAMPERMONKEY_DEBUG === "1") return true;
  const text =
    typeof value === "string"
      ? value
      : [
          value?.projectName,
          value?.name,
          value?.projectLink,
          value?.detailUrl,
        ].filter(Boolean).join(" ");
  return /Variational/i.test(String(text || ""));
}

function debugLog(label, payload) {
  console.log(`[rootdata-tampermonkey][DEBUG] ${label}:`, payload);
}

function summarizeInvestorsForDebug(items = []) {
  return (items || []).map((item) => ({
    projectName: item?.projectName || item?.name,
    projectLink: item?.projectLink || item?.link,
    round: item?.round,
    amount: item?.amount,
    formattedAmount: item?.formattedAmount,
    valuation: item?.valuation,
    formattedValuation: item?.formattedValuation,
    date: item?.date,
    timestamp: item?.timestamp,
    lead: item?.lead,
    source: item?.source,
  }));
}

function absoluteRootDataUrl(value) {
  if (!value) return "";
  try {
    return new URL(value, "https://www.rootdata.com").toString();
  } catch (_) {
    return String(value);
  }
}

function canonicalRootDataDetailUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value, "https://www.rootdata.com");
    url.protocol = "https:";
    url.hostname = "www.rootdata.com";

    const detailMatch = url.pathname.match(/^\/(?:projects|Projects|investors|Investors)\/detail\/([^/?#]+)/);
    const memberMatch = url.pathname.match(/^\/member\/([^/?#]+)/);
    if (!detailMatch?.[1] && !memberMatch?.[1]) return url.toString();

    if (memberMatch?.[1]) {
      url.pathname = `/member/${memberMatch[1]}`;
    } else {
      const type = /\/(?:investors|Investors)\//.test(url.pathname)
        ? "Investors"
        : "Projects";
      const slug = detailMatch[1];
      url.pathname = `/${type}/detail/${slug}`;
    }

    const k = url.searchParams.get("k");
    url.search = "";
    if (k) url.searchParams.set("k", k);
    url.hash = "";
    return url.toString();
  } catch (_) {
    return String(value);
  }
}

function rootDataDetailUrlCandidates(value) {
  const canonical = canonicalRootDataDetailUrl(value);
  const candidates = new Set([canonical, String(value || "")].filter(Boolean));

  try {
    const url = new URL(canonical, "https://www.rootdata.com");
    const detailMatch = url.pathname.match(/^\/(Projects|Investors)\/detail\/([^/?#]+)/);
    const memberMatch = url.pathname.match(/^\/member\/([^/?#]+)/);
    const k = url.searchParams.get("k");

    if (memberMatch?.[1]) {
      const item = new URL(canonical);
      item.pathname = `/member/${memberMatch[1]}`;
      item.search = "";
      if (k) item.searchParams.set("k", k);
      item.hash = "";
      candidates.add(item.toString());
      return Array.from(candidates);
    }

    if (!detailMatch?.[1] || !detailMatch?.[2]) return Array.from(candidates);

    const type = detailMatch[1];
    const lowerType = type.toLowerCase();
    const slug = detailMatch[2];

    for (const pathType of [type, lowerType]) {
      const item = new URL(canonical);
      item.pathname = `/${pathType}/detail/${slug}`;
      item.search = "";
      if (k) item.searchParams.set("k", k);
      item.hash = "";
      candidates.add(item.toString());
    }
  } catch (_) {}

  return Array.from(candidates).filter(Boolean);
}

async function findOrCreateProjectByDetailLink(projectLink, defaults, transaction) {
  const candidates = rootDataDetailUrlCandidates(projectLink);
  const existing = await Fundraising.Project.findOne({
    where: { projectLink: { [Op.in]: candidates } },
    order: [["updatedAt", "DESC"], ["id", "DESC"]],
    transaction,
  });

  if (existing) return [existing, false];

  return Fundraising.Project.findOrCreate({
    where: { projectLink },
    defaults,
    transaction,
  });
}

function parseNameFromRootDataDetailUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value, "https://www.rootdata.com");
    const detailMatch = url.pathname.match(/\/(?:projects|Projects|investors|Investors)\/detail\/([^/?#]+)/);
    const memberMatch = url.pathname.match(/\/member\/([^/?#]+)/);
    const slug = detailMatch?.[1] || memberMatch?.[1];
    if (!slug) return "";
    return decodeURIComponent(slug).replace(/\+/g, " ").trim();
  } catch (_) {
    return "";
  }
}

function isRootDataProjectOrInvestorDetailUrl(value) {
  try {
    const url = new URL(value, "https://www.rootdata.com");
    return (
      /(^|\.)rootdata\.com$/i.test(url.hostname) &&
      /\/(?:projects|Projects|investors|Investors)\/detail\//.test(url.pathname)
    );
  } catch (_) {
    return false;
  }
}

function isRootDataDetailUrl(value) {
  try {
    const url = new URL(value, "https://www.rootdata.com");
    return (
      /(^|\.)rootdata\.com$/i.test(url.hostname) &&
      (/\/(?:projects|Projects|investors|Investors)\/detail\//.test(url.pathname) || /\/member\//.test(url.pathname))
    );
  } catch (_) {
    return false;
  }
}


function isRootDataMemberUrl(value) {
  try {
    const url = new URL(value, "https://www.rootdata.com");
    return /(^|\.)rootdata\.com$/i.test(url.hostname) && /\/member\//.test(url.pathname);
  } catch (_) {
    return false;
  }
}

function placeholderEntityUrl(projectLink, projectName) {
  const rawLink = String(projectLink || "");
  if (!rawLink.includes("javascript:void(0)")) return "";
  const name = cleanText(projectName, 255) || crypto.randomUUID();
  return `javascript:void(0)/${name}`;
}

function normalizeRelatedEntityUrl(projectLink, projectName) {
  const placeholder = placeholderEntityUrl(projectLink, projectName);
  if (placeholder) return placeholder;
  return canonicalRootDataDetailUrl(projectLink || "");
}

function isImportableRelatedEntityUrl(value) {
  // 投资关系只允许项目/机构或无详情页占位投资方；member 人物页不能作为融资关系实体写入。
  return isRootDataProjectOrInvestorDetailUrl(value) || String(value || "").includes("javascript:void(0)/");
}

function parseAmount(valueStr) {
  if (!valueStr || valueStr === "--") return null;

  let cleaned = String(valueStr)
    .replace(/\$/g, "")
    .replace(/美元/g, "")
    .replace(/,/g, "")
    .replace(/ /g, "")
    .trim();

  if (!cleaned) return null;

  let multiplier = 1;
  const units = [
    { pattern: /十亿/g, val: 1e9 },
    { pattern: /亿/g, val: 1e8 },
    { pattern: /万/g, val: 1e4 },
    { pattern: /billion/i, val: 1e9 },
    { pattern: /million/i, val: 1e6 },
    { pattern: /thousand/i, val: 1e3 },
    { pattern: /B$/i, val: 1e9 },
    { pattern: /M$/i, val: 1e6 },
    { pattern: /K$/i, val: 1e3 },
  ];

  for (const unit of units) {
    if (unit.pattern.test(cleaned)) {
      multiplier = unit.val;
      cleaned = cleaned.replace(unit.pattern, "").trim();
      break;
    }
  }

  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value * multiplier : null;
}

function normalizeFormattedAmount(value, fallbackText) {
  if (value === null || value === undefined || value === "") {
    return parseAmount(fallbackText);
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : parseAmount(fallbackText);
}

function parseDate(dateStr) {
  if (!dateStr) return null;

  const currentYear = new Date().getFullYear();
  let formattedDateStr;
  const text = String(dateStr).trim();

  if (/^[A-Za-z]{3} \d{1,2}, \d{4}$/.test(text)) {
    formattedDateStr = text;
  } else if (/^[A-Za-z]{3},? \d{4}$/.test(text)) {
    formattedDateStr = `01 ${text.replace(",", "")}`;
  } else if (/^[A-Za-z]{3} \d{1,2}$/.test(text)) {
    formattedDateStr = `${text}, ${currentYear}`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    formattedDateStr = text;
  } else if (/^\d{2}-\d{2}$/.test(text)) {
    formattedDateStr = `${currentYear}-${text}`;
  }

  const timestamp = Date.parse(formattedDateStr);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function stringToHashTimestamp(str) {
  if (!str) return null;

  let hash = 5381;
  for (let index = 0; index < String(str).length; index += 1) {
    hash = (hash << 5) + hash + String(str).charCodeAt(index);
  }

  const baseTime = new Date("2000-01-01").getTime();
  const range = new Date("2020-01-01").getTime() - baseTime;
  return baseTime + (Math.abs(hash) % range);
}

function normalizeDetailEntity(item) {
  const rawName = cleanText(item?.projectName || item?.name, 255);
  const rawLink = item?.projectLink || item?.link || "";
  const projectLink = normalizeRelatedEntityUrl(rawLink, rawName);
  const projectName = rawName || parseNameFromRootDataDetailUrl(projectLink);

  if (!projectName || !projectLink || !isImportableRelatedEntityUrl(projectLink)) {
    return null;
  }

  const amount = cleanText(item?.amount, 255);
  const valuation = cleanText(item?.valuation, 255);
  const date = cleanText(item?.date, 255);

  return {
    projectName,
    projectLink,
    lead: Boolean(item?.lead),
    round: cleanText(item?.round, 255) || "--",
    amount: amount || null,
    valuation: valuation || null,
    date: date || null,
    formattedAmount: normalizeFormattedAmount(item?.formattedAmount, amount),
    formattedValuation: normalizeFormattedAmount(item?.formattedValuation, valuation),
    timestamp:
      item?.timestamp ||
      parseDate(date) ||
      (date ? stringToHashTimestamp(date) : null),
  };
}

function sanitizeSocialLinks(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const result = {};
  Object.entries(value).forEach(([rawKey, rawUrl]) => {
    const key = cleanText(rawKey, 64).toLowerCase();
    const url = cleanText(rawUrl, 2000);
    if (key && /^https?:\/\//i.test(url) && !isRootDataOwnedSocialUrl(key, url)) {
      const normalizedKey = key === "twitter" ? "x" : key;
      if (normalizedKey === "x") {
        const xUrl = normalizeXUrl(url);
        if (xUrl) result.x = xUrl;
      } else {
        result[normalizedKey] = url;
      }
    }
  });

  // 坤哥要求：回传详情必须有合法 x，且 x 必须是 x.com；否则整组 socialLinks 丢弃，不覆盖旧值。
  return result.x ? result : null;
}

function hasRootDataOwnedSocialLinks(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).some(([key, url]) => {
    return url && isRootDataOwnedSocialUrl(key, url);
  });
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

function isRootDataOwnedSocialUrl(key, rawUrl) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const full = `${hostname}${url.pathname}${url.search}`.toLowerCase();
    const normalizedKey = String(key || "").toLowerCase();

    if (/rootdata\.com$/.test(hostname)) return true;
    if (/x\.com|twitter\.com/.test(hostname) && /rootdatacrypto/i.test(url.pathname)) return true;
    if (hostname === "t.me" && /rootdatalabs/i.test(url.pathname)) return true;
    if (hostname === "rootdatalabs.medium.com") return true;
    if (hostname === "calendly.com" && /rootdata|elvin-rootdata/i.test(url.pathname)) return true;
    if (hostname === "notion.so" && /business|development|hiring|rootdata|source=copy_link/i.test(url.pathname + url.search)) return true;
    if (hostname === "play.google.com" && /rootdata|com\.flutter\.benliu\.rootdata/i.test(full)) return true;
    if (hostname === "drive.google.com" && /media|kit/i.test(normalizedKey)) return true;
    if (hostname === "linkedin.com" && /lucasschuermann/i.test(url.pathname)) return true;
  } catch (_) {
    return true;
  }

  if (/rootdata|business cooperation|hiring|media kit/.test(String(key || "").toLowerCase())) return true;
  return false;
}

function sanitizeTeamMembers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 200)
    .map((member) => ({
      name: cleanText(member?.name, 255),
      position: cleanText(member?.position, 255),
      avatar: cleanText(member?.avatar, 2000),
      profileLink: absoluteRootDataUrl(member?.profileLink || ""),
    }))
    .filter((member) => member.name || member.profileLink);
}

async function upsertInvestmentRelationships(project, investors, program = "auto_crawler") {
  const normalizedInvestors = (investors || [])
    .map(normalizeDetailEntity)
    .filter(Boolean);
  const debugTarget = isDebugDetailTarget(project);

  if (debugTarget) {
    debugLog("upsertInvestmentRelationships.normalized", {
      fundedProjectId: project?.id,
      fundedProjectName: project?.projectName,
      fundedProjectLink: project?.projectLink,
      rawCount: Array.isArray(investors) ? investors.length : 0,
      normalizedCount: normalizedInvestors.length,
      rawInvestors: summarizeInvestorsForDebug(investors),
      normalizedInvestors: summarizeInvestorsForDebug(normalizedInvestors),
      seriesA50M: normalizedInvestors.filter(
        (item) => /series\s*a/i.test(item.round || "") && Number(item.formattedAmount) === 50000000
      ),
    });
  }

  if (normalizedInvestors.length === 0) return 0;

  const sequelize = Fundraising.Project.sequelize;
  const transaction = await sequelize.transaction();

  try {
    const records = [];

    for (const investor of normalizedInvestors) {
      const [investorProject] = await findOrCreateProjectByDetailLink(
        investor.projectLink,
        {
          projectName: investor.projectName,
          isInitial: false,
          socialLinks: null,
          detailFailuresNumber: 0,
          detailFetchedAt: null,
          updateProgram: program,
        },
        transaction
      );

      records.push({
        investorProjectId: investorProject.id,
        fundedProjectId: project.id,
        round: investor.round || "--",
        amount: investor.amount || null,
        formattedAmount: Number.isFinite(investor.formattedAmount)
          ? investor.formattedAmount
          : null,
        valuation: investor.valuation || null,
        formattedValuation: Number.isFinite(investor.formattedValuation)
          ? investor.formattedValuation
          : null,
        date: investor.timestamp || null,
        lead: Boolean(investor.lead),
        updateProgram: program,
      });
    }

    if (records.length > 0) {
      if (debugTarget) {
        debugLog("upsertInvestmentRelationships.records.beforeBulkCreate", {
          fundedProjectId: project.id,
          records: records.map((record) => ({
            ...record,
            dateIso: record.date ? new Date(Number(record.date)).toISOString() : null,
          })),
          seriesA50MRecords: records.filter(
            (record) => /series\s*a/i.test(record.round || "") && Number(record.formattedAmount) === 50000000
          ),
        });
      }

      await Fundraising.InvestmentRelationships.bulkCreate(records, {
        transaction,
        updateOnDuplicate: [
          "lead",
          "round",
          "amount",
          "valuation",
          "date",
          "formattedAmount",
          "formattedValuation",
          "updateProgram",
        ],
      });

      if (debugTarget) {
        const storedRows = await Fundraising.InvestmentRelationships.findAll({
          where: { fundedProjectId: project.id },
          include: [
            {
              model: Fundraising.Project,
              as: "investorProject",
              attributes: ["id", "projectName", "projectLink"],
            },
          ],
          order: [["round", "ASC"], ["formattedAmount", "DESC"], ["updatedAt", "DESC"]],
          transaction,
        });

        debugLog("upsertInvestmentRelationships.storedRows.afterBulkCreate", {
          fundedProjectId: project.id,
          count: storedRows.length,
          rows: storedRows.map((row) => ({
            id: row.id,
            investorProjectId: row.investorProjectId,
            investorName: row.investorProject?.projectName,
            investorLink: row.investorProject?.projectLink,
            fundedProjectId: row.fundedProjectId,
            round: row.round,
            amount: row.amount,
            formattedAmount: row.formattedAmount,
            valuation: row.valuation,
            formattedValuation: row.formattedValuation,
            date: row.date,
            dateIso: row.date ? new Date(Number(row.date)).toISOString() : null,
            lead: row.lead,
            updateProgram: row.updateProgram,
          })),
        });
      }
    }

    await transaction.commit();
    return records.length;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function upsertInvestedRelationships(investorProject, investedProjects, program = "auto_crawler") {
  const normalizedProjects = (investedProjects || [])
    .map(normalizeDetailEntity)
    .filter(Boolean);

  if (normalizedProjects.length === 0) return 0;

  const sequelize = Fundraising.Project.sequelize;
  const transaction = await sequelize.transaction();

  try {
    const records = [];

    for (const project of normalizedProjects) {
      const [fundedProject] = await findOrCreateProjectByDetailLink(
        project.projectLink,
        {
          projectName: project.projectName,
          isInitial: false,
          socialLinks: null,
          detailFailuresNumber: 0,
          detailFetchedAt: null,
          updateProgram: program,
        },
        transaction
      );

      records.push({
        investorProjectId: investorProject.id,
        fundedProjectId: fundedProject.id,
        round: "--",
        amount: null,
        formattedAmount: null,
        valuation: null,
        formattedValuation: null,
        date: null,
        lead: false,
        updateProgram: program,
      });
    }

    if (records.length > 0) {
      await Fundraising.InvestmentRelationships.bulkCreate(records, {
        transaction,
        ignoreDuplicates: true,
      });
    }

    await transaction.commit();
    return records.length;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

function sanitizeImportRow(row, page) {
  const projectLink = canonicalRootDataDetailUrl(row.projectLink);
  const projectNameFromPayload = cleanText(row.projectName, 255);
  const projectNameFromUrl = parseNameFromRootDataDetailUrl(projectLink);
  const projectName =
    projectNameFromPayload.length > 1 ? projectNameFromPayload : projectNameFromUrl;

  if (!projectName || !projectLink || !/rootdata\.com\/projects\/detail\//i.test(projectLink)) {
    return null;
  }

  const amount = cleanText(row.amount, 255);
  const valuation = cleanText(row.valuation, 255);
  const date = cleanText(row.date, 255);

  return {
    projectName,
    projectLink,
    logo: cleanText(row.logo, 2000) || null,
    round: cleanText(row.round, 255) || null,
    amount: amount || null,
    formattedAmount: parseAmount(amount),
    valuation: valuation || null,
    formattedValuation: parseAmount(valuation),
    date: date || null,
    fundedAt: parseDate(date),
    originalPageNumber: Number.isFinite(Number(page)) ? Number(page) : 1,
    isInitial: true,
    updateProgram: "auto_crawler",
  };
}

function clampDetailQueueLimit(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 10;
  return Math.min(Math.max(1, Math.floor(num)), MAX_DETAIL_QUEUE_LIMIT);
}

function buildInitialDetailQueueOptions(limit) {
  const now = Date.now();
  const daysAgo1 = now - 2.5 * 24 * 60 * 60 * 1000;
  const daysAgo2 = now - 2 * 24 * 60 * 60 * 1000;

  return {
    attributes: [
      "id",
      "projectName",
      "projectLink",
      "isInitial",
      "detailFetchedAt",
      "detailFailuresNumber",
      "fundedAt",
      "originalPageNumber",
    ],
    where: {
      isInitial: true,
      [Op.or]: [
        { "$investmentsReceived.id$": null },
        { socialLinks: { [Op.eq]: null } },
        { fundedAt: { [Op.gte]: daysAgo1 } },
      ],
      detailFailuresNumber: { [Op.lte]: 8 },
      projectLink: { [Op.like]: "http%" },
      detailFetchedAt: {
        [Op.or]: [
          { [Op.is]: null },
          { [Op.lt]: daysAgo2 },
        ],
      },
    },
    include: [
      {
        model: Fundraising.InvestmentRelationships,
        as: "investmentsReceived",
        required: false,
        attributes: ["id"],
      },
    ],
    order: [
      [
        literal('CASE WHEN "Project"."originalPageNumber" IS NULL THEN 1 ELSE 0 END'),
        "ASC",
      ],
      ["originalPageNumber", "ASC"],
      ["updatedAt", "ASC"],
      ["id", "ASC"],
    ],
    subQuery: false,
    limit,
  };
}

function buildSubDetailQueueOptions(limit) {
  return {
    attributes: [
      "id",
      "projectName",
      "projectLink",
      "isInitial",
      "detailFetchedAt",
      "detailFailuresNumber",
      "originalPageNumber",
    ],
    where: {
      isInitial: false,
      detailFailuresNumber: { [Op.lte]: 8 },
      socialLinks: null,
      projectLink: { [Op.like]: "http%" },
    },
    order: [
      ["detailFailuresNumber", "ASC"],
      ["updatedAt", "ASC"],
      ["id", "ASC"],
    ],
    limit,
  };
}

function serializeDetailQueueItem(project) {
  return {
    id: project.id,
    projectName: project.projectName,
    projectLink: canonicalRootDataDetailUrl(project.projectLink),
    isInitial: project.isInitial,
    detailFetchedAt: project.detailFetchedAt,
    detailFailuresNumber: project.detailFailuresNumber,
    fundedAt: project.fundedAt || null,
    originalPageNumber: project.originalPageNumber || null,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateJson(value, maxLength = 6000) {
  let text;
  try {
    text = JSON.stringify(value || {}, null, 2);
  } catch (_) {
    text = String(value || "");
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n... [truncated]` : text;
}

async function safeRecordCollectorStat(req, action, payload = {}) {
  try {
    await recordGenericStat({
      type: "collector.tampermonkey.crawl",
      source: "tampermonkey",
      action,
      subjectType: "script",
      subjectId: "rootdata-fundraising",
      subjectName: "RootData Fundraising",
      actorType: "collector_token",
      actorId: req.collectorClient?.id || null,
      actorName: req.collectorClient?.name || null,
      countValue: 1,
      numericValue: payload.numericValue ?? null,
      dimensions: {
        site: "rootdata",
        page: "fundraising",
        script: "rootdata-fundraising-scheduled-reader",
        scheduleSlot: payload.scheduleSlot || null,
        tokenPrefix: req.collectorClient?.tokenPrefix || null,
        status: action,
      },
      metrics: payload.metrics || null,
      meta: payload.meta || null,
    });
  } catch (error) {
    console.warn("[rootdata-tampermonkey] 记录通用统计失败:", error.message);
  }
}

async function getAlertRecipients() {
  const envEmails = String(process.env.COLLECTOR_ALERT_EMAILS || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

  if (envEmails.length > 0) return [...new Set(envEmails)];

  const rows = await XhuntAdminManager.findAll({
    where: {
      role: "super",
      isActive: true,
      canLogin: true,
    },
    attributes: ["email"],
    raw: true,
  });

  return [...new Set(rows.map((row) => row.email).filter(Boolean))];
}

function buildAlertEmail(payload) {
  const occurredAt = payload.occurredAt || new Date().toISOString();
  const beijingTime = new Date(occurredAt).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
  });
  const detailsJson = escapeHtml(truncateJson(payload.details || payload, 8000));

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
      <h2>⚠️ RootData Fundraising Tampermonkey 告警</h2>
      <p>Windows 浏览器侧采集 RootData 融资列表失败，请尽快检查页面是否出现验证码、WAF、白屏或登录态失效。</p>
      <table style="border-collapse:collapse;width:100%;max-width:760px;">
        <tbody>
          <tr><td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:bold;">原因</td><td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(payload.reason || "-")}</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:bold;">页面</td><td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(payload.pageUrl || "-")}</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:bold;">计划时间</td><td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(payload.scheduleSlot || "-")}</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:bold;">重试次数</td><td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(payload.retryCount ?? "-")}/${escapeHtml(payload.maxRetries ?? "-")}</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:bold;">发生时间</td><td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(beijingTime)}（北京时间）</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:bold;">User-Agent</td><td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(payload.userAgent || "-")}</td></tr>
        </tbody>
      </table>
      <h3>诊断信息</h3>
      <pre style="background:#111827;color:#e5e7eb;padding:12px;border-radius:8px;overflow:auto;max-height:520px;">${detailsJson}</pre>
    </div>
  `;

  const text = [
    "RootData Fundraising Tampermonkey 告警",
    `原因: ${payload.reason || "-"}`,
    `页面: ${payload.pageUrl || "-"}`,
    `计划时间: ${payload.scheduleSlot || "-"}`,
    `重试次数: ${payload.retryCount ?? "-"}/${payload.maxRetries ?? "-"}`,
    `发生时间(北京时间): ${beijingTime}`,
    `User-Agent: ${payload.userAgent || "-"}`,
    `诊断信息: ${truncateJson(payload.details || payload, 4000)}`,
  ].join("\n");

  return { html, text };
}

async function sendAlertEmail(payload) {
  const recipients = await getAlertRecipients();
  if (recipients.length === 0) {
    console.warn("[rootdata-tampermonkey] 没有找到告警收件人");
    return { recipients: [], sent: 0, failed: 0 };
  }

  const subject = "[RootData Fundraising] Tampermonkey 页面异常告警";
  const { html, text } = buildAlertEmail(payload);

  const results = await Promise.allSettled(
    recipients.map((email) => sendEmail(email, subject, html, text))
  );

  const failedItems = results
    .map((result, index) => ({ result, email: recipients[index] }))
    .filter((item) => item.result.status === "rejected");

  if (failedItems.length > 0) {
    console.error(
      "[rootdata-tampermonkey] 部分告警邮件发送失败:",
      failedItems.map((item) => ({ email: item.email, error: item.result.reason?.message }))
    );
  }

  return {
    recipients,
    sent: results.length - failedItems.length,
    failed: failedItems.length,
  };
}

router.post("/alert", requireClientToken, async (req, res) => {
  const payload = req.body || {};

  console.warn("[rootdata-tampermonkey] 收到页面异常告警:", {
    reason: payload.reason,
    pageUrl: payload.pageUrl,
    scheduleSlot: payload.scheduleSlot,
    retryCount: payload.retryCount,
    maxRetries: payload.maxRetries,
    occurredAt: payload.occurredAt,
  });

  try {
    await safeRecordCollectorStat(req, "alert", {
      scheduleSlot: payload.scheduleSlot,
      meta: {
        reason: payload.reason,
        pageUrl: payload.pageUrl,
        retryCount: payload.retryCount,
        maxRetries: payload.maxRetries,
        occurredAt: payload.occurredAt,
        details: payload.details || null,
      },
    });
    const emailResult = await sendAlertEmail(payload);
    return res.json({
      success: true,
      message: "告警已接收",
      email: emailResult,
    });
  } catch (error) {
    console.error("[rootdata-tampermonkey] 告警邮件发送失败:", error);
    return res.status(500).json({
      success: false,
      error: "ALERT_EMAIL_SEND_FAILED",
      message: error.message,
    });
  }
});

router.get("/ping", requireClientToken, async (req, res) => {
  return res.json({
    success: true,
    data: {
      connected: true,
      serverTime: new Date().toISOString(),
      collectorClient: req.collectorClient || null,
    },
  });
});

router.post("/import", requireClientToken, async (req, res) => {
  const { rows, page = 1, pageUrl, scheduleSlot, scrapedAt } = req.body || {};

  if (!Array.isArray(rows)) {
    await safeRecordCollectorStat(req, "failure", {
      scheduleSlot,
      meta: { error: "INVALID_ROWS", pageUrl, scrapedAt },
    });
    return res.status(400).json({
      success: false,
      error: "INVALID_ROWS",
      message: "rows 必须是数组",
    });
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    await safeRecordCollectorStat(req, "failure", {
      scheduleSlot,
      metrics: { received: rows.length, maxImportRows: MAX_IMPORT_ROWS },
      meta: { error: "ROWS_TOO_MANY", pageUrl, scrapedAt },
    });
    return res.status(400).json({
      success: false,
      error: "ROWS_TOO_MANY",
      message: `单次最多导入 ${MAX_IMPORT_ROWS} 条`,
    });
  }

  const seenLinks = new Set();
  const skipped = [];
  const data = [];

  rows.forEach((row, index) => {
    const item = sanitizeImportRow(row, page);
    if (!item) {
      skipped.push({ index, reason: "invalid_project" });
      return;
    }

    if (seenLinks.has(item.projectLink)) {
      skipped.push({ index, reason: "duplicated_projectLink" });
      return;
    }

    seenLinks.add(item.projectLink);
    data.push(item);
  });

  if (data.length === 0) {
    await safeRecordCollectorStat(req, "failure", {
      scheduleSlot,
      metrics: { received: rows.length, imported: 0, skipped: skipped.length },
      meta: { error: "NO_VALID_ROWS", pageUrl, scrapedAt, skipped },
    });
    return res.status(400).json({
      success: false,
      error: "NO_VALID_ROWS",
      message: "没有可导入的有效项目数据",
      skipped,
    });
  }

  const fieldsToUpdate = Object.keys(Fundraising.Project.rawAttributes).filter(
    (field) => !["id", "projectLink", "createdAt", "updatedAt"].includes(field)
  );

  try {
    await Fundraising.Project.bulkCreate(data, {
      updateOnDuplicate: fieldsToUpdate,
    });
  } catch (error) {
    await safeRecordCollectorStat(req, "failure", {
      scheduleSlot,
      metrics: { received: rows.length, imported: 0, skipped: skipped.length },
      meta: { error: error.message, pageUrl, scrapedAt },
    });
    return res.status(500).json({
      success: false,
      error: "IMPORT_FAILED",
      message: error.message,
    });
  }

  console.log("[rootdata-tampermonkey] 导入融资列表数据成功:", {
    received: rows.length,
    imported: data.length,
    skipped: skipped.length,
    page,
    pageUrl,
    scheduleSlot,
    scrapedAt,
  });

  await safeRecordCollectorStat(req, "success", {
    scheduleSlot,
    numericValue: data.length,
    metrics: {
      received: rows.length,
      imported: data.length,
      skipped: skipped.length,
    },
    meta: {
      page,
      pageUrl,
      scrapedAt,
      skippedItems: skipped.slice(0, 20),
    },
  });

  return res.json({
    success: true,
    data: {
      received: rows.length,
      imported: data.length,
      skipped: skipped.length,
      skippedItems: skipped,
    },
  });
});

router.get("/details/queue", requireClientToken, async (req, res) => {
  const phase = String(req.query.phase || "initial").toLowerCase() === "sub"
    ? "sub"
    : "initial";
  const limit = clampDetailQueueLimit(req.query.limit);
  const scheduleSlot = req.query.scheduleSlot || null;

  try {
    const options = phase === "sub"
      ? buildSubDetailQueueOptions(limit)
      : buildInitialDetailQueueOptions(limit);
    const rows = await Fundraising.Project.findAll(options);
    const items = rows.map(serializeDetailQueueItem);

    console.log("[rootdata-tampermonkey] details queue fetched:", {
      phase,
      requestedLimit: req.query.limit || null,
      limit,
      count: items.length,
      scheduleSlot,
    });

    return res.json({
      success: true,
      data: {
        phase,
        limit,
        count: items.length,
        items,
        serverTime: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[rootdata-tampermonkey] 获取详情队列失败:", error);
    await safeRecordCollectorStat(req, "detail_queue_failure", {
      scheduleSlot,
      meta: {
        phase,
        limit,
        error: error.message,
      },
    });

    return res.status(500).json({
      success: false,
      error: "DETAIL_QUEUE_FAILED",
      message: error.message,
    });
  }
});

router.post("/details/import", requireClientToken, async (req, res) => {
  const payload = req.body || {};
  const projectLink = canonicalRootDataDetailUrl(payload.projectLink);
  const projectName =
    cleanText(payload.projectName, 255) ||
    parseNameFromRootDataDetailUrl(projectLink);
  const scheduleSlot = payload.scheduleSlot || null;
  const program = "auto_crawler";

  if (!projectName || !projectLink || !isRootDataDetailUrl(projectLink)) {
    await safeRecordCollectorStat(req, "detail_failure", {
      scheduleSlot,
      meta: {
        error: "INVALID_DETAIL_PROJECT",
        projectLink,
        projectName,
        pageUrl: payload.pageUrl || null,
      },
    });

    return res.status(400).json({
      success: false,
      error: "INVALID_DETAIL_PROJECT",
      message: "详情页 projectLink/projectName 无效",
    });
  }

  const hasSocialLinksPayload =
    payload.socialLinks &&
    typeof payload.socialLinks === "object" &&
    !Array.isArray(payload.socialLinks);
  const socialLinks = sanitizeSocialLinks(payload.socialLinks);
  const teamMembers = sanitizeTeamMembers(payload.teamMembers);
  const investors = Array.isArray(payload.investors) ? payload.investors : [];
  const investedProjects = Array.isArray(payload.investedProjects)
    ? payload.investedProjects
    : [];
  const isInitial = payload.isInitial !== false;
  const isMemberDetail = isRootDataMemberUrl(projectLink);
  const debugTarget = isDebugDetailTarget({ projectName, projectLink, detailUrl: payload.detailUrl });
  const hasUsefulDetails =
    Boolean(projectName) &&
    (Boolean(payload.logo) ||
      Boolean(socialLinks) ||
      teamMembers.length > 0 ||
      investors.length > 0 ||
      investedProjects.length > 0);

  if (debugTarget) {
    debugLog("details.import.receivedPayload", {
      projectName,
      projectLink,
      detailUrl: payload.detailUrl || null,
      isInitial,
      isMemberDetail,
      logo: payload.logo || null,
      socialLinks: payload.socialLinks || null,
      investorsCount: investors.length,
      investors: summarizeInvestorsForDebug(investors),
      seriesA50M: investors.filter((item) => /series\s*a/i.test(item.round || "") && /\b50\s*M\b/i.test(item.amount || "")),
      investedProjectsCount: investedProjects.length,
      scheduleSlot,
      scrapedAt: payload.scrapedAt || null,
      debug: payload.debug || null,
    });
  }

  try {
    const [project] = await findOrCreateProjectByDetailLink(projectLink, {
      projectName,
      projectLink,
      logo: cleanText(payload.logo, 2000) || null,
      isInitial,
      socialLinks,
      teamMembers,
      detailFetchedAt: hasUsefulDetails ? Date.now() : null,
      detailFailuresNumber: hasUsefulDetails ? 0 : 1,
      updateProgram: program,
    });

    const updateValues = {
      projectName,
      logo: cleanText(payload.logo, 2000) || project.logo || null,
      detailFetchedAt: hasUsefulDetails ? Date.now() : null,
      detailFailuresNumber: hasUsefulDetails
        ? 0
        : Number(project.detailFailuresNumber || 0) + 1,
      updateProgram: program,
    };

    if (socialLinks) {
      // X 链接是强匹配字段，不合并旧 socialLinks，避免历史错误的 RootData 官方账号继续残留。
      updateValues.socialLinks = socialLinks;
      updateValues.twitterUrl = socialLinks.x;
    } else if (
      hasSocialLinksPayload &&
      project.socialLinks &&
      (!sanitizeSocialLinks(project.socialLinks) || hasRootDataOwnedSocialLinks(project.socialLinks))
    ) {
      // 新详情明确没有合法 x，且旧库里的 socialLinks 不合法或含 RootData 污染链接，则清掉旧的 x。
      updateValues.socialLinks = null;
      updateValues.twitterUrl = null;
    }

    if (teamMembers.length > 0 || !Array.isArray(project.teamMembers)) {
      updateValues.teamMembers = teamMembers;
    }

    if (isInitial && project.isInitial !== true) {
      updateValues.isInitial = true;
    }

    await project.update(updateValues);

    // member 人物页只修基础资料；不能把人物页里的 Work History / 相关项目写成融资关系。
    const investmentRelationships = isInitial && !isMemberDetail
      ? await upsertInvestmentRelationships(project, investors, program)
      : 0;
    const investedRelationships = isInitial && !isMemberDetail
      ? await upsertInvestedRelationships(project, investedProjects, program)
      : 0;

    let debugStoredRelationships = null;
    if (debugTarget) {
      const storedRows = await Fundraising.InvestmentRelationships.findAll({
        where: { fundedProjectId: project.id },
        include: [
          {
            model: Fundraising.Project,
            as: "investorProject",
            attributes: ["id", "projectName", "projectLink"],
          },
        ],
        order: [["round", "ASC"], ["formattedAmount", "DESC"], ["updatedAt", "DESC"]],
      });

      debugStoredRelationships = storedRows.map((row) => ({
        id: row.id,
        investorProjectId: row.investorProjectId,
        investorName: row.investorProject?.projectName,
        investorLink: row.investorProject?.projectLink,
        fundedProjectId: row.fundedProjectId,
        round: row.round,
        amount: row.amount,
        formattedAmount: row.formattedAmount,
        valuation: row.valuation,
        formattedValuation: row.formattedValuation,
        date: row.date,
        dateIso: row.date ? new Date(Number(row.date)).toISOString() : null,
        lead: row.lead,
        updateProgram: row.updateProgram,
        updatedAt: row.updatedAt,
      }));

      debugLog("details.import.storedRelationships.final", {
        projectId: project.id,
        projectName,
        projectLink: project.projectLink,
        count: debugStoredRelationships.length,
        seriesA50M: debugStoredRelationships.filter(
          (row) => /series\s*a/i.test(row.round || "") && Number(row.formattedAmount) === 50000000
        ),
        rows: debugStoredRelationships,
      });
    }

    console.log("[rootdata-tampermonkey] 导入详情数据成功:", {
      projectName,
      projectLink,
      isInitial,
      socialLinks: socialLinks ? Object.keys(socialLinks).length : 0,
      teamMembers: teamMembers.length,
      investors: investors.length,
      investedProjects: investedProjects.length,
      investmentRelationships,
      investedRelationships,
      scheduleSlot,
    });

    await safeRecordCollectorStat(req, "detail_success", {
      scheduleSlot,
      numericValue: 1,
      metrics: {
        isInitial,
        socialLinks: socialLinks ? Object.keys(socialLinks).length : 0,
        teamMembers: teamMembers.length,
        investors: investors.length,
        investedProjects: investedProjects.length,
        investmentRelationships,
        investedRelationships,
      },
      meta: {
        projectName,
        projectLink,
        pageUrl: payload.pageUrl || null,
        scrapedAt: payload.scrapedAt || null,
      },
    });

    return res.json({
      success: true,
      data: {
        projectId: project.id,
        projectName,
        projectLink,
        isInitial,
        investmentRelationships,
        investedRelationships,
        debug: debugTarget
          ? {
              receivedInvestors: summarizeInvestorsForDebug(investors),
              storedRelationships: debugStoredRelationships,
            }
          : undefined,
      },
    });
  } catch (error) {
    console.error("[rootdata-tampermonkey] 导入详情数据失败:", error);
    await safeRecordCollectorStat(req, "detail_failure", {
      scheduleSlot,
      meta: {
        error: error.message,
        projectName,
        projectLink,
        pageUrl: payload.pageUrl || null,
        scrapedAt: payload.scrapedAt || null,
      },
    });

    return res.status(500).json({
      success: false,
      error: "DETAIL_IMPORT_FAILED",
      message: error.message,
    });
  }
});

router.post("/details/failure", requireClientToken, async (req, res) => {
  const payload = req.body || {};
  const projectLink = canonicalRootDataDetailUrl(payload.projectLink);
  const projectName =
    cleanText(payload.projectName, 255) ||
    parseNameFromRootDataDetailUrl(projectLink) ||
    "Unknown";
  const scheduleSlot = payload.scheduleSlot || null;

  if (!projectLink || !isRootDataDetailUrl(projectLink)) {
    return res.status(400).json({
      success: false,
      error: "INVALID_DETAIL_PROJECT",
      message: "详情页 projectLink 无效",
    });
  }

  try {
    const [project] = await findOrCreateProjectByDetailLink(projectLink, {
      projectName,
      projectLink,
      isInitial: payload.isInitial !== false,
      detailFailuresNumber: 0,
      detailFetchedAt: null,
      updateProgram: "auto_crawler",
    });

    await project.update({
      detailFailuresNumber: Number(project.detailFailuresNumber || 0) + 1,
      updateProgram: "auto_crawler",
    });

    await safeRecordCollectorStat(req, "detail_failure", {
      scheduleSlot,
      metrics: {
        isInitial: payload.isInitial !== false,
      },
      meta: {
        error: payload.error || "DETAIL_CRAWL_FAILED",
        projectName,
        projectLink,
        pageUrl: payload.pageUrl || null,
        details: payload.details || null,
        scrapedAt: payload.scrapedAt || null,
      },
    });

    return res.json({
      success: true,
      data: {
        projectId: project.id,
        projectName,
        projectLink,
        detailFailuresNumber: project.detailFailuresNumber,
      },
    });
  } catch (error) {
    console.error("[rootdata-tampermonkey] 记录详情失败状态失败:", error);
    return res.status(500).json({
      success: false,
      error: "DETAIL_FAILURE_SAVE_FAILED",
      message: error.message,
    });
  }
});

module.exports = router;
