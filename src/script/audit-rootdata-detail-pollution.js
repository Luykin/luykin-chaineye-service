/**
 * 审计 RootData Tampermonkey 详情导入污染
 *
 * 只读脚本：默认不修改数据库。
 * 用途：统计疑似被错误详情导入污染的 Projects，并输出 Tampermonkey 重新爬取队列。
 *
 * 用法：
 *   NODE_ENV=production node src/script/audit-rootdata-detail-pollution.js
 *   NODE_ENV=production node src/script/audit-rootdata-detail-pollution.js --recent-hours=24
 *   NODE_ENV=production node src/script/audit-rootdata-detail-pollution.js --since=2026-05-25T00:00:00+08:00
 *   NODE_ENV=production node src/script/audit-rootdata-detail-pollution.js --limit=500
 *   NODE_ENV=production node src/script/audit-rootdata-detail-pollution.js --output=data/rootdata-detail-audit/custom.json
 */

const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envFile =
    process.env.AUDIT_ENV_FILE ||
    (process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro");
  try {
    require("dotenv").config({ path: path.resolve(process.cwd(), envFile) });
    console.log(`[audit-rootdata] loaded env: ${envFile}`);
  } catch (error) {
    console.warn(`[audit-rootdata] dotenv load skipped: ${error.message}`);
  }
}

loadEnv();

const { QueryTypes } = require("sequelize");
const { pgInstance } = require("../models/postgres-fundraising");

function getArgValue(name) {
  const prefix = `${name}=`;
  const item = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseTimeArg(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeXUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const url = new URL(String(rawUrl));
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

function isRootDataOwnedUrl(label, rawUrl) {
  const text = cleanText(label).toLowerCase();
  if (!rawUrl) return false;

  try {
    const url = new URL(String(rawUrl));
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const full = `${hostname}${url.pathname}${url.search}`.toLowerCase();

    if (/rootdata\.com$/.test(hostname)) return true;
    if (/x\.com|twitter\.com/.test(hostname) && /rootdatacrypto/i.test(url.pathname)) return true;
    if (hostname === "t.me" && /rootdatalabs/i.test(url.pathname)) return true;
    if (hostname === "rootdatalabs.medium.com") return true;
    if (hostname === "calendly.com" && /rootdata|elvin-rootdata/i.test(url.pathname)) return true;
    if (hostname === "notion.so" && /business|development|hiring|rootdata|source=copy_link/i.test(url.pathname + url.search)) return true;
    if (hostname === "play.google.com" && /rootdata|com\.flutter\.benliu\.rootdata/i.test(full)) return true;
    if (hostname === "drive.google.com" && /media|kit/i.test(text)) return true;
    if (hostname === "linkedin.com" && /lucasschuermann/i.test(url.pathname)) return true;
  } catch (_) {
    return true;
  }

  return /rootdata|business cooperation|hiring|media kit/.test(text);
}

function parseSocialLinks(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function isSuspiciousLogo(rawLogo) {
  const logo = cleanText(rawLogo).toLowerCase();
  if (!logo) return false;

  // RootData 详情页社交图标/站点图标不应该成为项目 logo。
  if (/detail_icon_|official_website|detail_icon_twitter|detail_icon_linkedin/.test(logo)) return true;
  if (/rootdata\.com\/images\/(logo|rootdata|favicon|icon)/.test(logo)) return true;
  if (/\/favicon\.|\/apple-touch-icon|placeholder|default-avatar|default_logo/.test(logo)) return true;

  return false;
}

function getEntityType(projectLink) {
  const link = cleanText(projectLink);
  if (/\/(?:investors|Investors)\/detail\//.test(link)) return "investor";
  if (/\/(?:projects|Projects)\/detail\//.test(link)) return "project";
  if (/\/member\//.test(link)) return "member";
  return "unknown";
}

function auditProject(row, options) {
  const reasons = [];
  const reviewReasons = [];
  const socialLinks = parseSocialLinks(row.socialLinks);
  const twitterUrl = cleanText(row.twitterUrl);
  const detailFetchedAt = Number(row.detailFetchedAt || 0);
  const updatedAt = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;

  if (twitterUrl) {
    if (isRootDataOwnedUrl("twitterUrl", twitterUrl)) reasons.push("twitterUrl_rootdata_owned");
    if (!normalizeXUrl(twitterUrl)) reasons.push("twitterUrl_invalid_or_not_x_domain");
  }

  if (socialLinks) {
    const xRaw = socialLinks.x || socialLinks.X || socialLinks.twitter || socialLinks.Twitter || "";
    const xUrl = normalizeXUrl(xRaw);

    if (xRaw && isRootDataOwnedUrl("x", xRaw)) reasons.push("social_x_rootdata_owned");
    if (xRaw && !xUrl) reasons.push("social_x_invalid_or_not_x_domain");

    for (const [key, url] of Object.entries(socialLinks)) {
      if (url && isRootDataOwnedUrl(key, url)) {
        reasons.push(`social_${String(key).toLowerCase()}_rootdata_owned`);
      }
    }

    // 新规则：没有合法 x.com 时，整组 socialLinks 不应该入库。
    if (Object.keys(socialLinks).length > 0 && !xUrl) {
      if (options.sinceMs) reviewReasons.push("social_links_without_valid_x");
      else reviewReasons.push("social_links_without_valid_x_historical_review");
    }
  }

  if (isSuspiciousLogo(row.logo)) reasons.push("logo_rootdata_static_or_placeholder");

  if (options.sinceMs) {
    const touchedInWindow = detailFetchedAt >= options.sinceMs || updatedAt >= options.sinceMs;
    if (touchedInWindow && cleanText(row.updateProgram) === "auto_crawler") {
      reviewReasons.push("recent_auto_crawler_detail_update_recheck");
    }
  }

  const uniqueReasons = Array.from(new Set(reasons));
  const uniqueReviewReasons = Array.from(new Set(reviewReasons));
  const hasCritical = uniqueReasons.some((reason) => /twitterUrl_|social_x_/.test(reason));

  return {
    suspicious: uniqueReasons.length > 0 || uniqueReviewReasons.length > 0,
    severity: hasCritical ? "critical" : uniqueReasons.length > 0 ? "warning" : uniqueReviewReasons.length > 0 ? "review" : "ok",
    reasons: uniqueReasons,
    reviewReasons: uniqueReviewReasons,
  };
}

function buildWhere(options) {
  const where = [];
  const replacements = {};

  if (options.sinceMs) {
    where.push(`(
      COALESCE("detailFetchedAt", 0) >= :sinceMs
      OR "updatedAt" >= to_timestamp(:sinceMs / 1000.0)
      OR "socialLinks"::text ILIKE '%RootDataCrypto%'
      OR COALESCE("twitterUrl", '') ILIKE '%RootDataCrypto%'
    )`);
    replacements.sinceMs = options.sinceMs;
  }

  return {
    clause: where.length ? `WHERE ${where.join(" AND ")}` : "",
    replacements,
  };
}

async function main() {
  const recentHours = Number(getArgValue("--recent-hours") || 0);
  const sinceArg = getArgValue("--since");
  const limit = Number(getArgValue("--limit") || 0);
  const outputArg = getArgValue("--output");

  const sinceMs = sinceArg
    ? parseTimeArg(sinceArg)
    : recentHours > 0
      ? Date.now() - recentHours * 60 * 60 * 1000
      : null;

  if (sinceArg && !sinceMs) {
    throw new Error(`--since 时间格式无法解析: ${sinceArg}`);
  }

  const outputDir = path.resolve(process.cwd(), "data/rootdata-detail-audit");
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = outputArg
    ? path.resolve(process.cwd(), outputArg)
    : path.join(
        outputDir,
        `rootdata-detail-pollution-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
      );

  const options = { sinceMs };
  const { clause, replacements } = buildWhere(options);
  const sql = `
    SELECT
      id,
      "projectName",
      "projectLink",
      logo,
      "socialLinks",
      "twitterUrl",
      "detailFetchedAt",
      "updateProgram",
      "createdAt",
      "updatedAt"
    FROM "Projects"
    ${clause}
    ORDER BY "updatedAt" DESC, id DESC
    ${limit > 0 ? `LIMIT ${Number.parseInt(limit, 10)}` : ""}
  `;

  const rows = await pgInstance.query(sql, {
    type: QueryTypes.SELECT,
    replacements,
  });

  const audited = rows.map((row) => {
    const audit = auditProject(row, options);
    return {
      id: row.id,
      projectName: row.projectName,
      projectLink: row.projectLink,
      entityType: getEntityType(row.projectLink),
      logo: row.logo,
      twitterUrl: row.twitterUrl,
      socialLinks: parseSocialLinks(row.socialLinks),
      detailFetchedAt: row.detailFetchedAt,
      detailFetchedAtIso: row.detailFetchedAt ? new Date(Number(row.detailFetchedAt)).toISOString() : null,
      updateProgram: row.updateProgram,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      severity: audit.severity,
      reasons: audit.reasons,
      reviewReasons: audit.reviewReasons,
    };
  });

  const suspicious = audited.filter(
    (item) => item.reasons.length > 0 || item.reviewReasons.length > 0
  );
  const byReason = {};
  for (const item of suspicious) {
    for (const reason of item.reasons) byReason[reason] = (byReason[reason] || 0) + 1;
    for (const reason of item.reviewReasons) {
      const key = `review:${reason}`;
      byReason[key] = (byReason[key] || 0) + 1;
    }
  }

  const definiteQueue = suspicious
    .filter((item) => item.reasons.length > 0)
    .map((item) => ({
      id: item.id,
      entityType: item.entityType,
      projectName: item.projectName,
      projectLink: item.projectLink,
      reasons: item.reasons,
    }));
  const reviewQueue = suspicious
    .filter((item) => item.reasons.length === 0 && item.reviewReasons.length > 0)
    .map((item) => ({
      id: item.id,
      entityType: item.entityType,
      projectName: item.projectName,
      projectLink: item.projectLink,
      reasons: item.reviewReasons,
    }));
  const tampermonkeyQueue = definiteQueue
    .filter((item) => item.entityType === "project" || item.entityType === "investor" || item.entityType === "member")
    .map((item) => ({
      id: item.id,
      entityType: item.entityType,
      projectName: item.projectName,
      projectLink: item.projectLink,
      reasons: item.reasons,
    }));

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: true,
    filter: {
      sinceMs,
      sinceIso: sinceMs ? new Date(sinceMs).toISOString() : null,
      recentHours: recentHours || null,
      limit: limit || null,
    },
    summary: {
      scanned: rows.length,
      suspicious: suspicious.length,
      critical: suspicious.filter((item) => item.severity === "critical").length,
      warning: suspicious.filter((item) => item.severity === "warning").length,
      review: suspicious.filter((item) => item.severity === "review").length,
      definite: definiteQueue.length,
      recrawlable: tampermonkeyQueue.length,
      unsupported: definiteQueue.length - tampermonkeyQueue.length,
      byReason,
    },
    definiteQueue,
    reviewQueue,
    tampermonkeyQueue,
    projects: suspicious,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log("\n=== RootData 详情污染审计（只读）===");
  console.log(`扫描项目数: ${rows.length}`);
  console.log(`疑似异常数: ${suspicious.length}`);
  console.log(
    `Critical: ${report.summary.critical}, Warning: ${report.summary.warning}, Review: ${report.summary.review}`
  );
  console.log("按原因统计:");
  Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => console.log(`  - ${reason}: ${count}`));
  console.log(`\n报告文件: ${outputPath}`);

  if (tampermonkeyQueue.length > 0) {
    const fullQueue = tampermonkeyQueue
      .map(({ projectName, projectLink }) => ({ projectName, projectLink }));
    const command = `await RootDataFundraisingCollector.recrawlDetails(${JSON.stringify(fullQueue)}, { maxInitial: ${fullQueue.length}, maxSub: 0 })`;
    const commandPath = /\.json$/i.test(outputPath)
      ? outputPath.replace(/\.json$/i, ".tampermonkey.js")
      : `${outputPath}.tampermonkey.js`;
    fs.writeFileSync(commandPath, command);
    console.log(`\nTampermonkey 确定污染项共 ${fullQueue.length} 个，已生成全量重爬命令：`);
    console.log(commandPath);
  }
}

main()
  .catch((error) => {
    console.error("[audit-rootdata] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pgInstance.close();
    } catch (_) {}
  });
