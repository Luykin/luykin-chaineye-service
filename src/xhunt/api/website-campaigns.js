const express = require("express");
const { XhuntAdminAuditLog } = require("../../models/postgres-start");
const { adminAuth, requirePermission } = require("../../admin/middleware/adminAuth");
const {
  syncCampaignsFromNacos,
  listPublicCampaigns,
  getPublicCampaignDetailBySlug,
  getWebsiteCampaignAdminByNacosId,
  saveWebsiteCampaignConfig,
  listAllWebsiteCampaignsAdmin,
  importLegacyWebsiteCampaigns,
  serializeWebsiteCampaignAdmin,
} = require("../services/websiteCampaignService");

const router = express.Router();

router.use(express.json({ limit: "1mb" }));

async function logAdminAction(req, { action, success, message }) {
  try {
    const admin = req.adminUser;
    if (!admin) return;
    await XhuntAdminAuditLog.create({
      adminId: admin.id,
      email: admin.email,
      action,
      route: req.originalUrl || req.path || "",
      method: req.method || "",
      ip: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      payload: req.method === "GET" ? null : JSON.stringify(req.body || {}),
      success: !!success,
      message: message || null,
    });
  } catch (_) {}
}


router.get("/internal/list-all", adminAuth, requirePermission("nacos_config"), async (req, res) => {
  try {
    const data = await listAllWebsiteCampaignsAdmin();
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "读取网站活动列表失败" });
  }
});

router.post("/internal/import-legacy", adminAuth, requirePermission("nacos_config"), async (req, res) => {
  try {
    const summary = await importLegacyWebsiteCampaigns();
    await logAdminAction(req, {
      action: "website-campaign-import-legacy",
      success: true,
      message: JSON.stringify(summary),
    });
    return res.json({ success: true, summary });
  } catch (error) {
    await logAdminAction(req, {
      action: "website-campaign-import-legacy",
      success: false,
      message: error.message || "导入旧活动失败",
    });
    return res.status(500).json({ success: false, error: error.message || "导入旧活动失败" });
  }
});

router.get("/internal/by-nacos-id/:nacosCampaignId", adminAuth, requirePermission("nacos_config"), async (req, res) => {
  try {
    const record = await getWebsiteCampaignAdminByNacosId(req.params.nacosCampaignId);
    return res.json({ success: true, data: record ? serializeWebsiteCampaignAdmin(record) : null });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "读取网站配置失败" });
  }
});

router.post("/internal/sync-from-nacos", adminAuth, requirePermission("nacos_config"), async (req, res) => {
  try {
    const dryRun = !!(req.body && req.body.dryRun);
    const result = await syncCampaignsFromNacos({ dryRun });
    await logAdminAction(req, {
      action: dryRun ? "website-campaign-sync-dry-run" : "website-campaign-sync",
      success: true,
      message: JSON.stringify(result.summary),
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    await logAdminAction(req, {
      action: "website-campaign-sync",
      success: false,
      message: error.message || "同步失败",
    });
    return res.status(500).json({ success: false, error: error.message || "同步失败" });
  }
});

router.put("/internal/:nacosCampaignId/web-config", adminAuth, requirePermission("nacos_config"), async (req, res) => {
  try {
    const record = await saveWebsiteCampaignConfig(req.params.nacosCampaignId, req.body || {});
    await logAdminAction(req, {
      action: "website-campaign-save-config",
      success: true,
      message: `nacosCampaignId=${req.params.nacosCampaignId}`,
    });
    return res.json({
      success: true,
      data: {
        nacosCampaignId: record.nacosCampaignId,
        webStatus: record.webStatus,
        updatedAt: record.updatedAt,
      },
    });
  } catch (error) {
    await logAdminAction(req, {
      action: "website-campaign-save-config",
      success: false,
      message: error.message || "保存失败",
    });
    const status = /先同步/.test(error.message || "") || /必须填写/.test(error.message || "") || /格式不正确/.test(error.message || "") || /slug 已被/.test(error.message || "") ? 400 : 500;
    return res.status(status).json({ success: false, error: error.message || "保存失败" });
  }
});

router.get("/", async (req, res) => {
  try {
    const lang = String(req.query.lang || "zh-CN");
    const data = await listPublicCampaigns({ lang });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "获取活动列表失败" });
  }
});

router.get("/:slug", async (req, res) => {
  try {
    const lang = String(req.query.lang || "zh-CN");
    const data = await getPublicCampaignDetailBySlug(req.params.slug, { lang });
    if (!data) {
      return res.status(404).json({ success: false, error: "活动不存在" });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "获取活动详情失败" });
  }
});

module.exports = router;
