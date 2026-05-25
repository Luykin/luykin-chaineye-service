/**
 * 清理 RootData /member/ 误入 Projects 表后的详情污染字段。
 *
 * 背景：
 * - 审计脚本会扫描 Projects 表，因此历史误入库的 /member/ 记录也会被算进污染项。
 * - Tampermonkey recrawlDetails 只重爬 /Projects/detail 与 /Investors/detail，不应该用项目/机构解析器爬 /member/ 人物页。
 * - 本脚本只清理 member 记录上的污染详情字段，不迁移/删除关系，避免破坏 PositionRelationships。
 *
 * 默认 dry-run，不写库：
 *   NODE_ENV=production node src/script/cleanup-rootdata-member-pollution.js
 *
 * 真正执行字段清理：
 *   NODE_ENV=production node src/script/cleanup-rootdata-member-pollution.js --apply
 *
 * 可选：只看前 N 条样例：
 *   NODE_ENV=production node src/script/cleanup-rootdata-member-pollution.js --limit=50
 *
 * 可选：输出报告路径：
 *   NODE_ENV=production node src/script/cleanup-rootdata-member-pollution.js --output=data/rootdata-detail-audit/member-cleanup.json
 */

const fs = require("fs");
const path = require("path");
const { QueryTypes, Sequelize } = require("sequelize");

function loadEnv() {
  const envFile =
    process.env.CLEANUP_ENV_FILE ||
    (process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro");
  try {
    require("dotenv").config({ path: path.resolve(process.cwd(), envFile) });
    console.log(`[cleanup-member] loaded env: ${envFile}`);
  } catch (error) {
    console.warn(`[cleanup-member] dotenv load skipped: ${error.message}`);
  }
}

loadEnv();

function createPgInstance() {
  const pgHost = process.env.PG_HOST;
  const pgPort = process.env.PG_PORT ? parseInt(process.env.PG_PORT, 10) : undefined;
  const pgDatabase = process.env.PG_DATABASE;
  const pgUsername = process.env.PG_USERNAME;
  const pgPassword = process.env.PG_PASSWORD;

  if (!pgHost || !pgDatabase || !pgUsername || !pgPassword) {
    throw new Error("PostgreSQL env incomplete: require PG_HOST, PG_DATABASE, PG_USERNAME, PG_PASSWORD");
  }

  const dialectOptions = {};
  if (process.env.PG_SSL === "true") {
    dialectOptions.ssl = {
      require: true,
      rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false",
    };
  }

  return new Sequelize({
    dialect: process.env.PG_DIALECT || "postgres",
    host: pgHost,
    port: pgPort,
    database: pgDatabase,
    username: pgUsername,
    password: pgPassword,
    logging: process.env.PG_LOGGING === "true",
    timezone: "+00:00",
    pool: { max: 3, min: 0, idle: 10000, acquire: 20000 },
    dialectOptions,
  });
}

const pgInstance = createPgInstance();

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function getArgValue(name) {
  const prefix = `${name}=`;
  const item = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function isSuspiciousLogo(rawLogo) {
  const logo = cleanText(rawLogo).toLowerCase();
  if (!logo) return false;
  if (/detail_icon_|official_website|detail_icon_twitter|detail_icon_linkedin/.test(logo)) return true;
  if (/rootdata\.com\/images\/(logo|rootdata|favicon|icon)/.test(logo)) return true;
  if (/\/favicon\.|\/apple-touch-icon|placeholder|default-avatar|default_logo/.test(logo)) return true;
  return false;
}

function analyzeMemberRow(row) {
  const reasons = [];
  const socialLinks = parseSocialLinks(row.socialLinks);
  const twitterUrl = cleanText(row.twitterUrl);

  let shouldClearTwitterUrl = false;
  let shouldClearSocialLinks = false;
  let shouldClearLogo = false;

  if (twitterUrl) {
    if (isRootDataOwnedUrl("twitterUrl", twitterUrl)) {
      reasons.push("twitterUrl_rootdata_owned");
      shouldClearTwitterUrl = true;
    }
    if (!normalizeXUrl(twitterUrl)) {
      reasons.push("twitterUrl_invalid_or_not_x_domain");
      shouldClearTwitterUrl = true;
    }
  }

  if (socialLinks && Object.keys(socialLinks).length > 0) {
    const xRaw = socialLinks.x || socialLinks.X || socialLinks.twitter || socialLinks.Twitter || "";
    const xUrl = normalizeXUrl(xRaw);

    if (xRaw && isRootDataOwnedUrl("x", xRaw)) {
      reasons.push("social_x_rootdata_owned");
      shouldClearSocialLinks = true;
    }
    if (xRaw && !xUrl) {
      reasons.push("social_x_invalid_or_not_x_domain");
      shouldClearSocialLinks = true;
    }

    for (const [key, url] of Object.entries(socialLinks)) {
      if (url && isRootDataOwnedUrl(key, url)) {
        reasons.push(`social_${String(key).toLowerCase()}_rootdata_owned`);
        shouldClearSocialLinks = true;
      }
    }

    // member 记录不走项目/机构详情重爬；如果整组没有合法 x，但有其它外链，审计会反复 review。
    // 为了不误删真实个人 X，只在没有合法 x 且命中 RootData/无效 x 时清空。
    if (xRaw && !xUrl) shouldClearSocialLinks = true;
  }

  if (isSuspiciousLogo(row.logo)) {
    reasons.push("logo_rootdata_static_or_placeholder");
    shouldClearLogo = true;
  }

  const actions = {
    clearTwitterUrl: shouldClearTwitterUrl,
    clearSocialLinks: shouldClearSocialLinks,
    clearLogo: shouldClearLogo,
  };

  return {
    reasons: Array.from(new Set(reasons)),
    actions,
    needsCleanup: shouldClearTwitterUrl || shouldClearSocialLinks || shouldClearLogo,
  };
}

async function main() {
  const apply = hasFlag("--apply");
  const limit = Number(getArgValue("--limit") || 0);
  const outputArg = getArgValue("--output");

  const outputDir = path.resolve(process.cwd(), "data/rootdata-detail-audit");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = outputArg
    ? path.resolve(process.cwd(), outputArg)
    : path.join(
        outputDir,
        `rootdata-member-pollution-cleanup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
      );

  const rows = await pgInstance.query(
    `
      SELECT
        p.id,
        p."projectName",
        p."projectLink",
        p.logo,
        p."twitterUrl",
        p."socialLinks",
        p."detailFetchedAt",
        p."detailFailuresNumber",
        p."isInitial",
        p."updateProgram",
        p."createdAt",
        p."updatedAt",
        COALESCE(ir_i.cnt, 0)::int AS "investmentAsInvestor",
        COALESCE(ir_f.cnt, 0)::int AS "investmentAsFunded",
        COALESCE(pos_s.cnt, 0)::int AS "positionAsSubject",
        COALESCE(pos_o.cnt, 0)::int AS "positionAsObject"
      FROM "Projects" p
      LEFT JOIN (
        SELECT "investorProjectId" AS id, COUNT(*) AS cnt
        FROM "InvestmentRelationships"
        GROUP BY "investorProjectId"
      ) ir_i ON ir_i.id = p.id
      LEFT JOIN (
        SELECT "fundedProjectId" AS id, COUNT(*) AS cnt
        FROM "InvestmentRelationships"
        GROUP BY "fundedProjectId"
      ) ir_f ON ir_f.id = p.id
      LEFT JOIN (
        SELECT "subjectProjectId" AS id, COUNT(*) AS cnt
        FROM "PositionRelationships"
        GROUP BY "subjectProjectId"
      ) pos_s ON pos_s.id = p.id
      LEFT JOIN (
        SELECT "objectProjectId" AS id, COUNT(*) AS cnt
        FROM "PositionRelationships"
        GROUP BY "objectProjectId"
      ) pos_o ON pos_o.id = p.id
      WHERE p."projectLink" ILIKE '%/member/%'
         OR p."projectLink" ILIKE '%/member?%'
      ORDER BY p."updatedAt" DESC, p.id DESC
      ${limit > 0 ? `LIMIT ${Number.parseInt(limit, 10)}` : ""}
    `,
    { type: QueryTypes.SELECT }
  );

  const audited = rows.map((row) => {
    const audit = analyzeMemberRow(row);
    return {
      id: row.id,
      projectName: row.projectName,
      projectLink: row.projectLink,
      logo: row.logo,
      twitterUrl: row.twitterUrl,
      socialLinks: parseSocialLinks(row.socialLinks),
      reasons: audit.reasons,
      actions: audit.actions,
      needsCleanup: audit.needsCleanup,
      relationships: {
        investmentAsInvestor: row.investmentAsInvestor,
        investmentAsFunded: row.investmentAsFunded,
        positionAsSubject: row.positionAsSubject,
        positionAsObject: row.positionAsObject,
      },
      detailFetchedAt: row.detailFetchedAt,
      detailFailuresNumber: row.detailFailuresNumber,
      isInitial: row.isInitial,
      updateProgram: row.updateProgram,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  const toCleanup = audited.filter((item) => item.needsCleanup);
  const byReason = {};
  for (const item of toCleanup) {
    for (const reason of item.reasons) byReason[reason] = (byReason[reason] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: !apply,
    summary: {
      scannedMemberProjects: rows.length,
      cleanupTargets: toCleanup.length,
      clearTwitterUrl: toCleanup.filter((item) => item.actions.clearTwitterUrl).length,
      clearSocialLinks: toCleanup.filter((item) => item.actions.clearSocialLinks).length,
      clearLogo: toCleanup.filter((item) => item.actions.clearLogo).length,
      withInvestmentRelationships: toCleanup.filter((item) => item.relationships.investmentAsInvestor > 0 || item.relationships.investmentAsFunded > 0).length,
      withPositionRelationships: toCleanup.filter((item) => item.relationships.positionAsSubject > 0 || item.relationships.positionAsObject > 0).length,
      byReason,
    },
    targets: toCleanup,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log("\n=== RootData /member/ 污染字段清理 ===");
  console.log(`模式: ${apply ? "APPLY 写库" : "DRY-RUN 只读"}`);
  console.log(`扫描 /member/ Projects: ${rows.length}`);
  console.log(`需要清理字段的记录: ${toCleanup.length}`);
  console.log(`  - 清 twitterUrl: ${report.summary.clearTwitterUrl}`);
  console.log(`  - 清 socialLinks: ${report.summary.clearSocialLinks}`);
  console.log(`  - 清 logo: ${report.summary.clearLogo}`);
  console.log(`  - 带 InvestmentRelationships 的清理目标: ${report.summary.withInvestmentRelationships}`);
  console.log(`  - 带 PositionRelationships 的清理目标: ${report.summary.withPositionRelationships}`);
  console.log("按原因统计:");
  Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => console.log(`  - ${reason}: ${count}`));
  console.log(`报告文件: ${outputPath}`);

  if (!apply) {
    console.log("\n未写库。确认报告无误后执行：");
    console.log("NODE_ENV=production node src/script/cleanup-rootdata-member-pollution.js --apply");
    return;
  }

  if (toCleanup.length === 0) {
    console.log("无需写库，退出。");
    return;
  }

  await pgInstance.transaction(async (transaction) => {
    for (const item of toCleanup) {
      const setClauses = [];
      const replacements = { id: item.id };

      if (item.actions.clearTwitterUrl) setClauses.push('"twitterUrl" = NULL');
      if (item.actions.clearSocialLinks) setClauses.push('"socialLinks" = NULL');
      if (item.actions.clearLogo) setClauses.push('"logo" = NULL');

      // member 记录不由项目/机构详情爬虫维护，清完污染后不要让失败计数挂着。
      setClauses.push('"detailFailuresNumber" = 0');
      setClauses.push('"isInitial" = TRUE');
      setClauses.push('"updateProgram" = \'auto_api_fix\'');
      setClauses.push('"updatedAt" = NOW()');

      await pgInstance.query(
        `UPDATE "Projects" SET ${setClauses.join(", ")} WHERE id = :id`,
        { replacements, transaction }
      );
    }
  });

  console.log(`\n[cleanup-member] 已写库清理 ${toCleanup.length} 条 /member/ 记录的污染字段。`);
}

main()
  .catch((error) => {
    console.error("[cleanup-member] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pgInstance.close();
    } catch (_) {}
  });
