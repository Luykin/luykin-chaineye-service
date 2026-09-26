const express = require("express");
const axios = require("axios");
const { Op } = require("sequelize");
const { XhuntSpecialUserMarker } = require("../../../models/postgres-start");
const { adminAuth, requirePermission } = require("../../../admin/middleware/adminAuth");
const { logAdminAction } = require("./shared");
const { refreshSpecialMarkersCache } = require("../../services/specialMarkersCache");
const { DATA_SERVICE_BASE_URL } = require("../../constants/dataService");

const router = express.Router();
const TWITTER_USER_LOOKUP_URL = `${DATA_SERVICE_BASE_URL}/fetch/twitter/user`;

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function normalizeTwidList(list) {
  if (!Array.isArray(list)) {
    if (typeof list === "string") {
      return Array.from(
        new Set(
          list
            .split(/[\r\n,;\s]+/)
            .map((item) => String(item).trim().replace(/^@+/, ""))
            .filter(Boolean)
        )
      );
    }
    return [];
  }
  return Array.from(
    new Set(
      list
        .map((item) => String(item || "").trim().replace(/^@+/, ""))
        .filter(Boolean)
    )
  );
}

function extractTwitterId(payload) {
  return String(
    payload?.data?.data?.id ||
      payload?.data?.id ||
      payload?.id ||
      ""
  ).trim();
}

async function fetchTwitterIdByUsername(username) {
  try {
    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername) return "";
    const response = await axios.get(TWITTER_USER_LOOKUP_URL, {
      params: { username: cleanUsername },
      timeout: 8000,
    });
    return extractTwitterId(response.data);
  } catch (error) {
    return "";
  }
}

function serializeRow(row) {
  return {
    id: row.id,
    username: row.username,
    twitterId: row.twitterId || null,
    markerText: row.markerText,
    colorPreset: row.colorPreset || "danger-red",
    variant: row.variant || "subtle",
    icon: row.icon || "none",
    effect: row.effect || "none",
    customTextColor: row.customTextColor || null,
    customBgColor: row.customBgColor || null,
    description: row.description || null,
    linkUrl: row.linkUrl || null,
    visibleScope: row.visibleScope || "all",
    visibleTwids: Array.isArray(row.visibleTwids) ? row.visibleTwids : [],
    enabled: !!row.enabled,
    operatorId: row.operatorId || null,
    operatorEmail: row.operatorEmail || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 查询特殊标记列表
 */
router.get(
  "/",
  adminAuth,
  requirePermission("special-markers"),
  async (req, res) => {
    try {
      const { keyword, colorPreset, visibleScope, enabled } = req.query;
      const where = {};

      if (keyword && String(keyword).trim()) {
        const kw = String(keyword).trim().toLowerCase().replace(/^@+/, "");
        // 转义 LIKE 通配符，避免用户输入 % _ 被当作模式匹配（PG 默认转义符为反斜杠）
        const escaped = kw.replace(/[\\%_]/g, (m) => `\\${m}`);
        where[Op.or] = [
          { username: { [Op.iLike]: `%${escaped}%` } },
          { markerText: { [Op.iLike]: `%${escaped}%` } },
          { twitterId: { [Op.iLike]: `%${escaped}%` } },
          { description: { [Op.iLike]: `%${escaped}%` } },
        ];
      }

      if (colorPreset && colorPreset !== "all") {
        where.colorPreset = colorPreset;
      }

      // "all" 表示不筛选；"public" 表示仅筛选全员可见（visible_scope = 'all'）的记录
      if (visibleScope === "whitelist" || visibleScope === "public") {
        where.visibleScope = visibleScope === "public" ? "all" : "whitelist";
      }

      if (enabled !== undefined && enabled !== "" && enabled !== "all") {
        where.enabled = enabled === "true" || enabled === true;
      }

      const rows = await XhuntSpecialUserMarker.findAll({
        where,
        order: [
          ["updatedAt", "DESC"],
          ["id", "DESC"],
        ],
      });

      res.json({
        success: true,
        data: rows.map(serializeRow),
      });
    } catch (error) {
      console.error("[special-markers] 获取列表失败:", error);
      res.status(500).json({ success: false, error: error.message || "获取列表失败" });
    }
  }
);

/**
 * 根据 handle 反查 Twitter ID（便捷辅助接口）
 */
router.post(
  "/resolve-twid",
  adminAuth,
  requirePermission("special-markers"),
  async (req, res) => {
    try {
      const username = normalizeUsername(req.body.username);
      if (!username) {
        return res.status(400).json({ success: false, error: "请输入有效的 Twitter handle" });
      }
      const twid = await fetchTwitterIdByUsername(username);
      if (!twid) {
        return res.json({ success: false, error: "未查询到该账号的 Twitter ID" });
      }
      res.json({ success: true, data: { username, twid } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message || "反查失败" });
    }
  }
);

/**
 * 新增或更新单个特殊标记
 */
router.post(
  "/",
  adminAuth,
  requirePermission("special-markers"),
  async (req, res) => {
    try {
      const username = normalizeUsername(req.body.username);
      const markerText = String(req.body.markerText || "").trim();

      if (!username) {
        return res.status(400).json({ success: false, error: "目标 Twitter handle 不能为空" });
      }
      if (!markerText) {
        return res.status(400).json({ success: false, error: "标记文本不能为空" });
      }

      let twitterId = req.body.twitterId ? String(req.body.twitterId).trim() : null;
      if (!twitterId) {
        // 尝试自动补齐
        twitterId = (await fetchTwitterIdByUsername(username)) || null;
      }

      const colorPreset = req.body.colorPreset || "danger-red";
      const variant = req.body.variant || "subtle";
      const icon = req.body.icon || "none";
      const effect = req.body.effect || "none";
      const customTextColor = req.body.customTextColor ? String(req.body.customTextColor).trim() : null;
      const customBgColor = req.body.customBgColor ? String(req.body.customBgColor).trim() : null;
      const description = req.body.description ? String(req.body.description).trim() : null;
      const linkUrl = req.body.linkUrl ? String(req.body.linkUrl).trim() : null;
      const visibleScope = req.body.visibleScope === "whitelist" ? "whitelist" : "all";
      const visibleTwids = normalizeTwidList(req.body.visibleTwids);
      const enabled = req.body.enabled !== false;

      const admin = req.adminUser || {};

      const fields = {
        markerText,
        colorPreset,
        variant,
        icon,
        effect,
        customTextColor,
        customBgColor,
        description,
        linkUrl,
        visibleScope,
        visibleTwids,
        enabled,
        operatorId: admin.id || null,
        operatorEmail: admin.email || null,
      };

      let record = await XhuntSpecialUserMarker.findOne({ where: { username } });
      if (record) {
        await record.update({ twitterId: twitterId || record.twitterId, ...fields });
      } else {
        try {
          record = await XhuntSpecialUserMarker.create({ username, twitterId, ...fields });
        } catch (e) {
          // 并发下同 username 撞唯一索引时降级为更新
          if (e?.name !== "SequelizeUniqueConstraintError") throw e;
          record = await XhuntSpecialUserMarker.findOne({ where: { username } });
          if (!record) throw e;
          await record.update({ twitterId: twitterId || record.twitterId, ...fields });
        }
      }

      await refreshSpecialMarkersCache();
      await logAdminAction(req, {
        action: "upsert_special_marker",
        success: true,
        message: `保存特殊标记: @${username} -> [${markerText}] (${visibleScope})`,
      });

      res.json({
        success: true,
        data: serializeRow(record),
      });
    } catch (error) {
      console.error("[special-markers] 保存失败:", error);
      res.status(500).json({ success: false, error: error.message || "保存失败" });
    }
  }
);

/**
 * 批量导入特殊标记
 */
router.post(
  "/batch",
  adminAuth,
  requirePermission("special-markers"),
  async (req, res) => {
    try {
      const rawUsernames = req.body.usernames;
      const markerText = String(req.body.markerText || "").trim();

      if (!markerText) {
        return res.status(400).json({ success: false, error: "标记文本不能为空" });
      }

      const handles = Array.from(
        new Set(
          (Array.isArray(rawUsernames) ? rawUsernames : String(rawUsernames || "").split(/[\r\n,;\s]+/))
            .map(normalizeUsername)
            .filter(Boolean)
        )
      );

      if (handles.length === 0) {
        return res.status(400).json({ success: false, error: "请提供至少一个合法的 Twitter handle" });
      }
      if (handles.length > 200) {
        return res.status(400).json({
          success: false,
          error: `单次最多导入 200 个账号（当前 ${handles.length} 个），请分批导入`,
        });
      }

      const colorPreset = req.body.colorPreset || "danger-red";
      const variant = req.body.variant || "subtle";
      const icon = req.body.icon || "none";
      const effect = req.body.effect || "none";
      const description = req.body.description ? String(req.body.description).trim() : null;
      const linkUrl = req.body.linkUrl ? String(req.body.linkUrl).trim() : null;
      const visibleScope = req.body.visibleScope === "whitelist" ? "whitelist" : "all";
      const visibleTwids = normalizeTwidList(req.body.visibleTwids);
      const enabled = req.body.enabled !== false;
      const admin = req.adminUser || {};

      let successCount = 0;
      for (const username of handles) {
        const existing = await XhuntSpecialUserMarker.findOne({ where: { username } });
        if (existing) {
          await existing.update({
            markerText,
            colorPreset,
            variant,
            icon,
            effect,
            description,
            linkUrl,
            visibleScope,
            visibleTwids,
            enabled,
            operatorId: admin.id || null,
            operatorEmail: admin.email || null,
          });
        } else {
          await XhuntSpecialUserMarker.create({
            username,
            twitterId: null,
            markerText,
            colorPreset,
            variant,
            icon,
            effect,
            description,
            linkUrl,
            visibleScope,
            visibleTwids,
            enabled,
            operatorId: admin.id || null,
            operatorEmail: admin.email || null,
          });
        }
        successCount++;
      }

      await refreshSpecialMarkersCache();
      await logAdminAction(req, {
        action: "batch_import_special_markers",
        success: true,
        message: `批量导入 ${successCount} 个账号标记: [${markerText}]`,
      });

      res.json({
        success: true,
        data: { count: successCount },
      });
    } catch (error) {
      console.error("[special-markers] 批量导入失败:", error);
      res.status(500).json({ success: false, error: error.message || "批量导入失败" });
    }
  }
);

/**
 * 切换启停状态
 */
router.patch(
  "/:id/toggle",
  adminAuth,
  requirePermission("special-markers"),
  async (req, res) => {
    try {
      const record = await XhuntSpecialUserMarker.findByPk(req.params.id);
      if (!record) {
        return res.status(404).json({ success: false, error: "标记不存在" });
      }
      const nextEnabled = !record.enabled;
      await record.update({
        enabled: nextEnabled,
        operatorId: req.adminUser?.id || record.operatorId,
        operatorEmail: req.adminUser?.email || record.operatorEmail,
      });

      await refreshSpecialMarkersCache();
      await logAdminAction(req, {
        action: "toggle_special_marker",
        success: true,
        message: `切换标记状态: @${record.username} -> ${nextEnabled ? "启用" : "停用"}`,
      });

      res.json({
        success: true,
        data: serializeRow(record),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message || "切换失败" });
    }
  }
);

/**
 * 删除标记
 */
router.delete(
  "/:id",
  adminAuth,
  requirePermission("special-markers"),
  async (req, res) => {
    try {
      const record = await XhuntSpecialUserMarker.findByPk(req.params.id);
      if (!record) {
        return res.status(404).json({ success: false, error: "标记不存在" });
      }
      const { username, markerText } = record;
      await record.destroy();

      await refreshSpecialMarkersCache();
      await logAdminAction(req, {
        action: "delete_special_marker",
        success: true,
        message: `删除标记: @${username} [${markerText}]`,
      });

      res.json({ success: true, data: { id: Number(req.params.id) } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message || "删除失败" });
    }
  }
);

/**
 * 批量为未匹配的记录补齐 Twitter ID
 */
router.post(
  "/sync-twitter-ids",
  adminAuth,
  requirePermission("special-markers"),
  async (req, res) => {
    try {
      const targets = await XhuntSpecialUserMarker.findAll({
        where: {
          twitterId: null,
        },
        limit: 50,
      });

      let updatedCount = 0;
      for (const row of targets) {
        const twid = await fetchTwitterIdByUsername(row.username);
        if (twid) {
          await row.update({ twitterId: twid });
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        await refreshSpecialMarkersCache();
      }

      res.json({
        success: true,
        data: {
          synced: updatedCount,
          totalPending: targets.length,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message || "同步失败" });
    }
  }
);

module.exports = router;
