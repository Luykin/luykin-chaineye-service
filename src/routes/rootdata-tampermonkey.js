const express = require("express");
const crypto = require("crypto");
const { Fundraising } = require("../models/postgres-fundraising");
const { XhuntAdminManager, CollectorClientToken } = require("../models/postgres-start");
const { sendEmail } = require("../services/emailService");
const { recordGenericStat } = require("../xhunt/services/generic-stats-service");

const router = express.Router();

const MAX_IMPORT_ROWS = parseInt(
  process.env.COLLECTOR_MAX_IMPORT_ROWS || "100",
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

function absoluteRootDataUrl(value) {
  if (!value) return "";
  try {
    return new URL(value, "https://www.rootdata.com").toString();
  } catch (_) {
    return String(value);
  }
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

function parseDate(dateStr) {
  if (!dateStr) return null;

  const currentYear = new Date().getFullYear();
  let formattedDateStr;
  const text = String(dateStr).trim();

  if (/^[A-Za-z]{3} \d{2}, \d{4}$/.test(text)) {
    formattedDateStr = text;
  } else if (/^[A-Za-z]{3}, \d{4}$/.test(text)) {
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

function sanitizeImportRow(row, page) {
  const projectName = cleanText(row.projectName, 255);
  const projectLink = absoluteRootDataUrl(row.projectLink);

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

module.exports = router;
