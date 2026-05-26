const express = require("express");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { Op, QueryTypes } = require("sequelize");
const { Fundraising } = require("../../models/postgres-fundraising");
const { CollectorClientToken } = require("../../models/postgres-start");
const { requirePermission } = require("../middleware/adminAuth");
const { recordGenericStat } = require("../../xhunt/services/generic-stats-service");

const router = express.Router();
const TAMPERMONKEY_DIR = path.resolve(__dirname, "../../../tampermonkey");
const TOKEN_TTL_MONTHS = 12;

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function createCollectorToken() {
  return `ct_${crypto.randomBytes(32).toString("base64url")}`;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function sanitizeScriptName(fileName) {
  const base = path.basename(String(fileName || ""));
  if (!/^[a-zA-Z0-9._-]+\.user\.js$/.test(base)) return null;
  return base;
}

function formatToken(row) {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    isActive: row.isActive,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    createdByAdminId: row.createdByAdminId,
    createdByAdminEmail: row.createdByAdminEmail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expired: row.expiresAt ? new Date(row.expiresAt).getTime() <= Date.now() : false,
  };
}

function cleanText(value, maxLength = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeRootDataUrl(value) {
  if (!value) return "";
  try {
    return new URL(value, "https://www.rootdata.com").toString();
  } catch (_) {
    return String(value || "");
  }
}

function serializeProject(project) {
  if (!project) return null;
  const row = typeof project.toJSON === "function" ? project.toJSON() : project;
  return {
    id: row.id,
    projectName: row.projectName,
    projectLink: row.projectLink,
    logo: row.logo,
    round: row.round,
    amount: row.amount,
    formattedAmount: row.formattedAmount,
    valuation: row.valuation,
    formattedValuation: row.formattedValuation,
    date: row.date,
    fundedAt: row.fundedAt,
    isInitial: row.isInitial,
    socialLinks: row.socialLinks,
    twitterUrl: row.twitterUrl,
    teamMembers: row.teamMembers,
    originalPageNumber: row.originalPageNumber,
    detailFetchedAt: row.detailFetchedAt,
    detailFailuresNumber: row.detailFailuresNumber,
    updateProgram: row.updateProgram,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeRelationship(relationship) {
  const row = typeof relationship.toJSON === "function" ? relationship.toJSON() : relationship;
  return {
    id: row.id,
    investorProjectId: row.investorProjectId,
    fundedProjectId: row.fundedProjectId,
    round: row.round,
    lead: row.lead,
    amount: row.amount,
    formattedAmount: row.formattedAmount,
    valuation: row.valuation,
    formattedValuation: row.formattedValuation,
    date: row.date,
    updateProgram: row.updateProgram,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    investorProject: serializeProject(row.investorProject),
    fundedProject: serializeProject(row.fundedProject),
  };
}

function normalizeAuditXUrl(rawUrl) {
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

function isRootDataOwnedAuditUrl(label, rawUrl) {
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

function parseAuditSocialLinks(value) {
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

function isSuspiciousAuditLogo(rawLogo) {
  const logo = cleanText(rawLogo, 3000).toLowerCase();
  if (!logo) return false;
  if (/detail_icon_|official_website|detail_icon_twitter|detail_icon_linkedin/.test(logo)) return true;
  if (/rootdata\.com\/images\/(logo|rootdata|favicon|icon)/.test(logo)) return true;
  if (/\/favicon\.|\/apple-touch-icon|placeholder|default-avatar|default_logo/.test(logo)) return true;
  return false;
}

function getAuditEntityType(projectLink) {
  const link = cleanText(projectLink, 3000);
  if (/\/(?:investors|Investors)\/detail\//.test(link)) return "investor";
  if (/\/(?:projects|Projects)\/detail\//.test(link)) return "project";
  if (/\/member\//.test(link)) return "member";
  return "unknown";
}

function auditRootDataDetailProject(row, options = {}) {
  const reasons = [];
  const reviewReasons = [];
  const socialLinks = parseAuditSocialLinks(row.socialLinks);
  const twitterUrl = cleanText(row.twitterUrl, 3000);
  const detailFetchedAt = Number(row.detailFetchedAt || 0);
  const updatedAt = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;

  if (twitterUrl) {
    if (isRootDataOwnedAuditUrl("twitterUrl", twitterUrl)) reasons.push("twitterUrl_rootdata_owned");
    if (!normalizeAuditXUrl(twitterUrl)) reasons.push("twitterUrl_invalid_or_not_x_domain");
  }

  if (socialLinks) {
    const xRaw = socialLinks.x || socialLinks.X || socialLinks.twitter || socialLinks.Twitter || "";
    const xUrl = normalizeAuditXUrl(xRaw);
    if (xRaw && isRootDataOwnedAuditUrl("x", xRaw)) reasons.push("social_x_rootdata_owned");
    if (xRaw && !xUrl) reasons.push("social_x_invalid_or_not_x_domain");

    for (const [key, url] of Object.entries(socialLinks)) {
      if (url && isRootDataOwnedAuditUrl(key, url)) {
        reasons.push(`social_${String(key).toLowerCase()}_rootdata_owned`);
      }
    }

    if (Object.keys(socialLinks).length > 0 && !xUrl) {
      reviewReasons.push(options.sinceMs ? "social_links_without_valid_x" : "social_links_without_valid_x_historical_review");
    }
  }

  if (isSuspiciousAuditLogo(row.logo)) reasons.push("logo_rootdata_static_or_placeholder");

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
    severity: hasCritical ? "critical" : uniqueReasons.length > 0 ? "warning" : uniqueReviewReasons.length > 0 ? "review" : "ok",
    reasons: uniqueReasons,
    reviewReasons: uniqueReviewReasons,
  };
}


async function cleanupRootDataProjectsForRecrawl(projectIds, transaction) {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(projectIds) ? projectIds : [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );

  if (!normalizedIds.length) {
    return { projectIds: [], resetProjects: 0, deletedInvestmentRelationships: 0 };
  }

  const deletedInvestmentRelationships = await Fundraising.InvestmentRelationships.destroy({
    where: {
      [Op.or]: [
        { fundedProjectId: { [Op.in]: normalizedIds } },
        { investorProjectId: { [Op.in]: normalizedIds } },
      ],
    },
    transaction,
  });

  const [resetProjects] = await Fundraising.Project.update(
    {
      socialLinks: null,
      twitterUrl: null,
      teamMembers: [],
      detailFetchedAt: null,
      detailFailuresNumber: 0,
      updateProgram: "admin_force_recrawl",
    },
    {
      where: { id: { [Op.in]: normalizedIds } },
      transaction,
    }
  );

  return {
    projectIds: normalizedIds,
    resetProjects: resetProjects || 0,
    deletedInvestmentRelationships,
  };
}

function buildRootDataForceRecrawlCommand(items, options = {}) {
  const queue = (Array.isArray(items) ? items : []).map((item) => ({
    projectName: item.projectName,
    projectLink: item.projectLink,
  }));
  const batchSize = Math.max(1, Number(options.batchSize || 1));
  return `await RootDataFundraisingCollector.recrawlDetails(${JSON.stringify(queue)}, { batchSize: ${batchSize}, maxSub: 0, forceRefreshInvestmentRelationships: true, forceRefreshInvestedRelationships: true });`;
}

async function safeRecordAdminStat(action, payload = {}) {
  try {
    await recordGenericStat({
      type: "collector.tampermonkey.admin",
      source: "admin_web",
      action,
      subjectType: "collector_management",
      subjectId: payload.subjectId || null,
      subjectName: payload.subjectName || null,
      actorType: "admin",
      actorId: payload.adminId ? String(payload.adminId) : null,
      actorName: payload.adminEmail || null,
      dimensions: payload.dimensions || null,
      metrics: payload.metrics || null,
      meta: payload.meta || null,
    });
  } catch (error) {
    console.warn("[tampermonkey-admin] 记录通用统计失败:", error.message);
  }
}

router.use(requirePermission("tampermonkey"));

router.get("/tokens", async (req, res) => {
  try {
    const rows = await CollectorClientToken.findAll({
      order: [["createdAt", "DESC"]],
      limit: 100,
    });

    res.json({ success: true, data: rows.map(formatToken) });
  } catch (error) {
    console.error("[tampermonkey-admin] token 列表加载失败:", error);
    res.status(500).json({ success: false, error: "加载 token 列表失败" });
  }
});

router.post("/tokens", async (req, res) => {
  try {
    const name = String(req.body?.name || "Tampermonkey Collector").trim().slice(0, 128);
    const token = createCollectorToken();
    const expiresAt = addMonths(new Date(), TOKEN_TTL_MONTHS);

    const row = await CollectorClientToken.create({
      name: name || "Tampermonkey Collector",
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, 12),
      expiresAt,
      createdByAdminId: req.adminUser?.id || null,
      createdByAdminEmail: req.adminUser?.email || null,
    });

    await safeRecordAdminStat("generate_token", {
      subjectId: String(row.id),
      subjectName: row.name,
      adminId: req.adminUser?.id,
      adminEmail: req.adminUser?.email,
      meta: { tokenPrefix: row.tokenPrefix, expiresAt },
    });

    res.json({
      success: true,
      data: {
        token,
        item: formatToken(row),
      },
    });
  } catch (error) {
    console.error("[tampermonkey-admin] token 生成失败:", error);
    res.status(500).json({ success: false, error: "生成 token 失败" });
  }
});

router.patch("/tokens/:id/revoke", async (req, res) => {
  try {
    const row = await CollectorClientToken.findByPk(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "token 不存在" });

    row.isActive = false;
    await row.save();

    await safeRecordAdminStat("revoke_token", {
      subjectId: String(row.id),
      subjectName: row.name,
      adminId: req.adminUser?.id,
      adminEmail: req.adminUser?.email,
      meta: { tokenPrefix: row.tokenPrefix },
    });

    res.json({ success: true, data: formatToken(row) });
  } catch (error) {
    console.error("[tampermonkey-admin] token 撤销失败:", error);
    res.status(500).json({ success: false, error: "撤销 token 失败" });
  }
});

router.get("/rootdata/lookup", async (req, res) => {
  try {
    const query = cleanText(req.query.q, 300);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10) || 10, 1), 20);

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "请输入项目名、RootData 详情链接或数据库 ID",
      });
    }

    const normalizedUrl = normalizeRootDataUrl(query);
    const whereItems = [
      { projectName: { [Op.iLike]: `%${query}%` } },
      { projectLink: { [Op.iLike]: `%${query}%` } },
    ];

    if (/^https?:\/\//i.test(normalizedUrl)) {
      whereItems.unshift({ projectLink: normalizedUrl });
    }

    if (/^\d+$/.test(query)) {
      whereItems.unshift({ id: Number(query) });
    }

    const projects = await Fundraising.Project.findAll({
      where: { [Op.or]: whereItems },
      order: [
        ["updatedAt", "DESC"],
        ["id", "DESC"],
      ],
      limit,
    });

    const projectIds = projects.map((project) => project.id);
    const [investmentsReceived, investmentsGiven] =
      projectIds.length > 0
        ? await Promise.all([
            Fundraising.InvestmentRelationships.findAll({
              where: { fundedProjectId: { [Op.in]: projectIds } },
              include: [
                {
                  model: Fundraising.Project,
                  as: "investorProject",
                },
                {
                  model: Fundraising.Project,
                  as: "fundedProject",
                },
              ],
              order: [["updatedAt", "DESC"]],
              limit: 300,
            }),
            Fundraising.InvestmentRelationships.findAll({
              where: { investorProjectId: { [Op.in]: projectIds } },
              include: [
                {
                  model: Fundraising.Project,
                  as: "investorProject",
                },
                {
                  model: Fundraising.Project,
                  as: "fundedProject",
                },
              ],
              order: [["updatedAt", "DESC"]],
              limit: 300,
            }),
          ])
        : [[], []];

    const grouped = projects.map((project) => ({
      project: serializeProject(project),
      investmentsReceived: investmentsReceived
        .filter((item) => item.fundedProjectId === project.id)
        .map(serializeRelationship),
      investmentsGiven: investmentsGiven
        .filter((item) => item.investorProjectId === project.id)
        .map(serializeRelationship),
    }));

    await safeRecordAdminStat("lookup_rootdata_project", {
      adminId: req.adminUser?.id,
      adminEmail: req.adminUser?.email,
      metrics: {
        matches: grouped.length,
        investmentsReceived: investmentsReceived.length,
        investmentsGiven: investmentsGiven.length,
      },
      meta: { query },
    });

    res.json({
      success: true,
      data: {
        query,
        total: grouped.length,
        items: grouped,
      },
    });
  } catch (error) {
    console.error("[tampermonkey-admin] RootData 导入验证查询失败:", error);
    res.status(500).json({ success: false, error: "RootData 导入验证查询失败" });
  }
});


router.post("/rootdata/force-recrawl/prepare", async (req, res) => {
  const sequelize = Fundraising.Project.sequelize;
  const transaction = await sequelize.transaction();

  try {
    const query = cleanText(req.body?.query, 300);
    const cleanup = req.body?.cleanup !== false;

    if (!query) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: "请输入项目名、RootData 详情链接或数据库 ID",
      });
    }

    const normalizedUrl = normalizeRootDataUrl(query);
    const whereItems = [
      { projectName: { [Op.iLike]: `%${query}%` } },
      { projectLink: { [Op.iLike]: `%${query}%` } },
    ];

    if (/^https?:\/\//i.test(normalizedUrl)) {
      whereItems.unshift({ projectLink: normalizedUrl });
    }

    if (/^\d+$/.test(query)) {
      whereItems.unshift({ id: Number(query) });
    }

    const projects = await Fundraising.Project.findAll({
      where: { [Op.or]: whereItems },
      order: [
        ["updatedAt", "DESC"],
        ["id", "DESC"],
      ],
      limit: 10,
      transaction,
    });

    if (!projects.length) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        error: "没有查到对应的 RootData 项目",
      });
    }

    const recrawlItems = projects.map((project) => ({
      id: project.id,
      projectName: project.projectName,
      projectLink: project.projectLink,
    }));

    const cleanupResult = cleanup
      ? await cleanupRootDataProjectsForRecrawl(
          recrawlItems.map((item) => item.id),
          transaction
        )
      : { projectIds: recrawlItems.map((item) => item.id), resetProjects: 0, deletedInvestmentRelationships: 0 };

    await transaction.commit();

    const command = buildRootDataForceRecrawlCommand(recrawlItems, { batchSize: recrawlItems.length > 1 ? 10 : 1 });

    await safeRecordAdminStat("prepare_rootdata_force_recrawl", {
      adminId: req.adminUser?.id,
      adminEmail: req.adminUser?.email,
      metrics: {
        matches: recrawlItems.length,
        resetProjects: cleanupResult.resetProjects,
        deletedInvestmentRelationships: cleanupResult.deletedInvestmentRelationships,
      },
      meta: {
        query,
        cleanup,
        projectIds: recrawlItems.map((item) => item.id),
        projectNames: recrawlItems.map((item) => item.projectName),
      },
    });

    res.json({
      success: true,
      data: {
        query,
        cleanup,
        items: recrawlItems,
        cleanupResult,
        command,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("[tampermonkey-admin] RootData 强制重爬准备失败:", error);
    res.status(500).json({
      success: false,
      error: "RootData 强制重爬准备失败",
      message: error.message,
    });
  }
});

router.get("/rootdata/detail-pollution-audit", async (req, res) => {
  try {
    const recentHours = Number(req.query.recentHours || 0);
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 1000);
    const sinceMs = recentHours > 0 ? Date.now() - recentHours * 60 * 60 * 1000 : null;
    const where = [];
    const replacements = {};

    if (sinceMs) {
      where.push(`(
        COALESCE("detailFetchedAt", 0) >= :sinceMs
        OR "updatedAt" >= to_timestamp(:sinceMs / 1000.0)
        OR "socialLinks"::text ILIKE '%RootDataCrypto%'
        OR COALESCE("twitterUrl", '') ILIKE '%RootDataCrypto%'
      )`);
      replacements.sinceMs = sinceMs;
    }

    const rows = await Fundraising.Project.sequelize.query(
      `
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
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY "updatedAt" DESC, id DESC
      `,
      { type: QueryTypes.SELECT, replacements }
    );

    const audited = rows
      .map((row) => {
        const audit = auditRootDataDetailProject(row, { sinceMs });
        return {
          id: row.id,
          projectName: row.projectName,
          projectLink: row.projectLink,
          entityType: getAuditEntityType(row.projectLink),
          logo: row.logo,
          twitterUrl: row.twitterUrl,
          socialLinks: parseAuditSocialLinks(row.socialLinks),
          detailFetchedAt: row.detailFetchedAt,
          detailFetchedAtIso: row.detailFetchedAt ? new Date(Number(row.detailFetchedAt)).toISOString() : null,
          updateProgram: row.updateProgram,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          severity: audit.severity,
          reasons: audit.reasons,
          reviewReasons: audit.reviewReasons,
        };
      })
      .filter((item) => item.reasons.length > 0 || item.reviewReasons.length > 0);

    const byReason = {};
    for (const item of audited) {
      for (const reason of item.reasons) byReason[reason] = (byReason[reason] || 0) + 1;
      for (const reason of item.reviewReasons) {
        const key = `review:${reason}`;
        byReason[key] = (byReason[key] || 0) + 1;
      }
    }

    const definiteQueue = audited
      .filter((item) => item.reasons.length > 0)
      .map((item) => ({
        id: item.id,
        entityType: item.entityType,
        projectName: item.projectName,
        projectLink: item.projectLink,
        reasons: item.reasons,
      }));
    const tampermonkeyQueue = definiteQueue.filter((item) => {
      return item.entityType === "project" || item.entityType === "investor" || item.entityType === "member";
    });

    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        filter: {
          recentHours: recentHours || null,
          sinceMs,
          sinceIso: sinceMs ? new Date(sinceMs).toISOString() : null,
          listLimit: limit,
        },
        summary: {
          scanned: rows.length,
          suspicious: audited.length,
          critical: audited.filter((item) => item.severity === "critical").length,
          warning: audited.filter((item) => item.severity === "warning").length,
          review: audited.filter((item) => item.severity === "review").length,
          definite: definiteQueue.length,
          recrawlable: tampermonkeyQueue.length,
          unsupported: definiteQueue.length - tampermonkeyQueue.length,
          byReason,
        },
        tampermonkeyQueue,
        projects: audited.slice(0, limit),
      },
    });
  } catch (error) {
    console.error("[tampermonkey-admin] RootData 详情污染验证失败:", error);
    res.status(500).json({
      success: false,
      error: "RootData 详情污染验证失败",
      message: error.message,
    });
  }
});

router.get("/scripts", async (req, res) => {
  try {
    const entries = await fs.readdir(TAMPERMONKEY_DIR, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && sanitizeScriptName(entry.name))
        .map(async (entry) => {
          const stat = await fs.stat(path.join(TAMPERMONKEY_DIR, entry.name));
          return {
            fileName: entry.name,
            size: stat.size,
            updatedAt: stat.mtime,
          };
        })
    );

    files.sort((a, b) => a.fileName.localeCompare(b.fileName));
    res.json({ success: true, data: files });
  } catch (error) {
    console.error("[tampermonkey-admin] 脚本列表加载失败:", error);
    res.status(500).json({ success: false, error: "加载脚本列表失败" });
  }
});

router.get("/scripts/:fileName", async (req, res) => {
  try {
    const fileName = sanitizeScriptName(req.params.fileName);
    if (!fileName) return res.status(400).json({ success: false, error: "脚本文件名无效" });

    const filePath = path.join(TAMPERMONKEY_DIR, fileName);
    const content = await fs.readFile(filePath, "utf8");
    const stat = await fs.stat(filePath);

    res.json({
      success: true,
      data: {
        fileName,
        content,
        size: stat.size,
        updatedAt: stat.mtime,
      },
    });
  } catch (error) {
    console.error("[tampermonkey-admin] 脚本读取失败:", error);
    res.status(500).json({ success: false, error: "读取脚本失败" });
  }
});

module.exports = router;
