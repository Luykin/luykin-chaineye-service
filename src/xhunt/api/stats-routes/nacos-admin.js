const express = require("express");
const crypto = require("crypto");
const {
  adminAuth,
  requireRole,
} = require("../../../admin/middleware/adminAuth");
const { logAdminAction } = require("./shared");
const { nacosRequest } = require("../../services/nacosConfigClient");

const router = express.Router();
const DEFAULT_GROUP = "DEFAULT_GROUP";
const DEFAULT_TYPE = "json";

const NACOS_CONFIG_CATALOG = [
  {
    dataId: "xhunt_config",
    label: "XHunt 主配置",
    group: DEFAULT_GROUP,
    type: "json",
    publicReadable: true,
    permissions: ["nacos_config", "feature_flags_config"],
  },
  {
    dataId: "xhunt_i18n",
    label: "插件翻译配置",
    group: DEFAULT_GROUP,
    type: "json",
    publicReadable: true,
    permissions: ["nacos-i18n", "feature_flags_config"],
  },
  {
    dataId: "xhunt_campaigns",
    label: "活动配置",
    group: DEFAULT_GROUP,
    type: "json",
    publicReadable: true,
    permissions: ["nacos_config"],
  },
  {
    dataId: "xhunt_built_in_tag",
    label: "内置标签（中文）",
    group: DEFAULT_GROUP,
    type: "json",
    publicReadable: true,
    permissions: ["nacos-tags"],
  },
  {
    dataId: "xhunt_built_in_tag_en",
    label: "内置标签（英文）",
    group: DEFAULT_GROUP,
    type: "json",
    publicReadable: true,
    permissions: ["nacos-tags"],
  },
  {
    dataId: "xhunt_message",
    label: "公告消息配置",
    group: DEFAULT_GROUP,
    type: "json",
    publicReadable: true,
    permissions: ["nacos-messages"],
  },
];

const CATALOG_MAP = new Map(NACOS_CONFIG_CATALOG.map((item) => [item.dataId, item]));

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizeDataId(value) {
  return String(value || "").trim();
}

function normalizeGroup(value) {
  return String(value || DEFAULT_GROUP).trim() || DEFAULT_GROUP;
}

function normalizeType(value) {
  const type = String(value || DEFAULT_TYPE).trim().toLowerCase();
  return type || DEFAULT_TYPE;
}

function validateIdentifier(value, fieldName) {
  const text = String(value || "").trim();
  if (!text || text.length > 160 || !/^[a-zA-Z0-9_.:-]+$/.test(text)) {
    throw new Error(`${fieldName} 只能包含字母、数字、_ . : -，长度 1-160`);
  }
  return text;
}

function hasAnyPermission(req, permissions = []) {
  if (req.adminUser?.role === "super") return true;
  const owned = req.adminPermissions || [];
  if (owned.includes("*")) return true;
  return permissions.some((permission) => owned.includes(permission));
}

function canOperateConfig(req, dataId) {
  if (req.adminUser?.role === "super") return true;
  const owned = req.adminPermissions || [];
  if (owned.includes("*") || owned.includes("nacos-admin")) return true;

  const item = CATALOG_MAP.get(dataId);
  return item ? hasAnyPermission(req, item.permissions) : false;
}

function assertConfigPermission(req, dataId) {
  if (!canOperateConfig(req, dataId)) {
    const item = CATALOG_MAP.get(dataId);
    const required = item?.permissions || ["nacos-admin"];
    const error = new Error("权限不足");
    error.status = 403;
    error.required = required;
    throw error;
  }
}

function serializeCatalogItem(req, item) {
  return {
    ...item,
    writable: canOperateConfig(req, item.dataId),
  };
}

function inferType(content, fallback = DEFAULT_TYPE) {
  if (fallback && fallback !== "json") return fallback;
  try {
    JSON.parse(content || "");
    return "json";
  } catch (e) {
    return fallback || "text";
  }
}

function formatContent(content, type) {
  if (type !== "json") return content;
  const parsed = JSON.parse(content || "{}");
  return JSON.stringify(parsed, null, 2);
}

async function readConfig({ dataId, group = DEFAULT_GROUP, tenant }) {
  const resp = await nacosRequest("GET", "/nacos/v1/cs/configs", {
    params: { dataId, group, ...(tenant ? { tenant } : {}) },
  });
  if (resp.status !== 200) {
    const error = new Error(`读取 Nacos 配置失败: status=${resp.status}`);
    error.status = resp.status;
    error.data = resp.data;
    throw error;
  }
  return typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
}

router.get(
  "/nacos/admin/configs",
  adminAuth,
  requireRole("super"),
  async (req, res) => {
    try {
      const configs = NACOS_CONFIG_CATALOG
        .filter((item) => canOperateConfig(req, item.dataId))
        .map((item) => serializeCatalogItem(req, item));

      res.json({
        success: true,
        data: {
          configs,
          canCreateCustom: hasAnyPermission(req, ["nacos-admin"]),
          defaultGroup: DEFAULT_GROUP,
        },
      });
    } catch (error) {
      console.error("[nacos-admin/configs] failed:", error);
      res.status(500).json({ success: false, error: error.message || "获取配置列表失败" });
    }
  }
);

router.get(
  "/nacos/admin/config",
  adminAuth,
  requireRole("super"),
  async (req, res) => {
    try {
      const dataId = validateIdentifier(normalizeDataId(req.query.dataId), "dataId");
      const group = validateIdentifier(normalizeGroup(req.query.group), "group");
      const tenant = req.query.tenant ? validateIdentifier(req.query.tenant, "tenant") : undefined;
      assertConfigPermission(req, dataId);

      const rawContent = await readConfig({ dataId, group, tenant });
      const catalog = CATALOG_MAP.get(dataId);
      const type = inferType(rawContent, catalog?.type || DEFAULT_TYPE);
      const content = type === "json" ? formatContent(rawContent, type) : rawContent;

      res.json({
        success: true,
        data: {
          dataId,
          group,
          tenant: tenant || null,
          type,
          content,
          contentSha256: sha256(rawContent),
          contentLength: Buffer.byteLength(rawContent, "utf8"),
          publicReadable: !!catalog?.publicReadable,
          permissions: catalog?.permissions || ["nacos-admin"],
        },
      });
    } catch (error) {
      console.error("[nacos-admin/config] read failed:", error);
      res.status(error.status || 500).json({
        success: false,
        error: error.message || "读取配置失败",
        required: error.required,
        data: error.data,
      });
    }
  }
);

router.post(
  "/nacos/admin/config",
  adminAuth,
  requireRole("super"),
  async (req, res) => {
    try {
      const dataId = validateIdentifier(normalizeDataId(req.body?.dataId), "dataId");
      const group = validateIdentifier(normalizeGroup(req.body?.group), "group");
      const tenant = req.body?.tenant ? validateIdentifier(req.body.tenant, "tenant") : undefined;
      const type = normalizeType(req.body?.type);
      const reason = String(req.body?.reason || "").trim().slice(0, 500);
      let content = req.body?.content;

      assertConfigPermission(req, dataId);
      if (typeof content !== "string") {
        return res.status(400).json({ success: false, error: "content 必须是字符串" });
      }
      if (type === "json") {
        try {
          content = JSON.stringify(JSON.parse(content || "{}"), null, 2);
        } catch (e) {
          return res.status(400).json({ success: false, error: "content 不是合法 JSON" });
        }
      }

      let beforeContent = "";
      let beforeSha256 = null;
      try {
        beforeContent = await readConfig({ dataId, group, tenant });
        beforeSha256 = sha256(beforeContent);
      } catch (e) {
        beforeSha256 = null;
      }

      const form = new URLSearchParams({ dataId, group, content, type });
      if (tenant) form.set("tenant", tenant);

      const resp = await nacosRequest("POST", "/nacos/v1/cs/configs", {
        data: form.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      const ok = resp.status === 200 && (resp.data === true || resp.data === "true");
      if (!ok) {
        return res.status(resp.status || 500).json({
          success: false,
          error: "发布 Nacos 配置失败",
          status: resp.status,
          data: resp.data,
        });
      }

      const afterSha256 = sha256(content);
      await logAdminAction(req, {
        action: "nacos-admin-config-publish",
        success: true,
        message: `dataId=${dataId} group=${group} before=${beforeSha256 || "new"} after=${afterSha256} reason=${reason || "-"}`,
      });

      res.json({
        success: true,
        data: {
          dataId,
          group,
          tenant: tenant || null,
          type,
          published: true,
          beforeSha256,
          afterSha256,
          changed: beforeSha256 !== afterSha256,
        },
      });
    } catch (error) {
      console.error("[nacos-admin/config] publish failed:", error);
      await logAdminAction(req, {
        action: "nacos-admin-config-publish",
        success: false,
        message: error.message || "failed",
      }).catch(() => {});
      res.status(error.status || 500).json({ success: false, error: error.message || "发布配置失败", required: error.required });
    }
  }
);

router.delete(
  "/nacos/admin/config",
  adminAuth,
  requireRole("super"),
  async (req, res) => {
    try {
      const dataId = validateIdentifier(normalizeDataId(req.query.dataId || req.body?.dataId), "dataId");
      const group = validateIdentifier(normalizeGroup(req.query.group || req.body?.group), "group");
      const tenant = (req.query.tenant || req.body?.tenant) ? validateIdentifier(req.query.tenant || req.body?.tenant, "tenant") : undefined;
      const reason = String(req.query.reason || req.body?.reason || "").trim().slice(0, 500);
      assertConfigPermission(req, dataId);

      let beforeSha256 = null;
      try {
        const beforeContent = await readConfig({ dataId, group, tenant });
        beforeSha256 = sha256(beforeContent);
      } catch (e) {
        beforeSha256 = null;
      }

      const resp = await nacosRequest("DELETE", "/nacos/v1/cs/configs", {
        params: { dataId, group, ...(tenant ? { tenant } : {}) },
      });

      const ok = resp.status === 200 && (resp.data === true || resp.data === "true");
      if (!ok) {
        return res.status(resp.status || 500).json({
          success: false,
          error: "删除 Nacos 配置失败",
          status: resp.status,
          data: resp.data,
        });
      }

      await logAdminAction(req, {
        action: "nacos-admin-config-delete",
        success: true,
        message: `dataId=${dataId} group=${group} before=${beforeSha256 || "unknown"} reason=${reason || "-"}`,
      });

      res.json({
        success: true,
        data: { dataId, group, tenant: tenant || null, deleted: true, beforeSha256 },
      });
    } catch (error) {
      console.error("[nacos-admin/config] delete failed:", error);
      await logAdminAction(req, {
        action: "nacos-admin-config-delete",
        success: false,
        message: error.message || "failed",
      }).catch(() => {});
      res.status(error.status || 500).json({ success: false, error: error.message || "删除配置失败", required: error.required });
    }
  }
);

module.exports = router;
