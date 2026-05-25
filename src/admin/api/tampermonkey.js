const express = require("express");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { Op } = require("sequelize");
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
