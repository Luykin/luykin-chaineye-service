const express = require("express");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
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
