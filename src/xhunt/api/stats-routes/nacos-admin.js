const express = require("express");
const crypto = require("crypto");
const {
  adminAuth,
  requireRole,
} = require("../../../admin/middleware/adminAuth");
const { logAdminAction } = require("./shared");
const { nacosRequest } = require("../../services/nacosConfigClient");
const { XhuntNacosConfigSnapshot } = require("../../../models/postgres-start");

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

function serializeSnapshot(row, includeContent = false) {
  const json = row.toJSON ? row.toJSON() : row;
  const data = {
    id: json.id,
    dataId: json.dataId,
    group: json.group,
    tenant: json.tenant || null,
    type: json.type,
    contentSha256: json.contentSha256,
    contentLength: json.contentLength,
    action: json.action,
    reason: json.reason || "",
    operatorId: json.operatorId || null,
    operatorEmail: json.operatorEmail || "",
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
  };
  if (includeContent) data.content = json.content;
  return data;
}

async function saveSnapshot(req, { dataId, group, tenant, type, content, action, reason }) {
  if (typeof content !== "string") return null;
  return XhuntNacosConfigSnapshot.create({
    dataId,
    group,
    tenant: tenant || null,
    type: type || DEFAULT_TYPE,
    content,
    contentSha256: sha256(content),
    contentLength: Buffer.byteLength(content, "utf8"),
    action,
    reason: reason || null,
    operatorId: req.adminUser?.id || null,
    operatorEmail: req.adminUser?.email || req.user?.username || null,
  });
}

async function saveSnapshotIfChanged(req, { dataId, group, tenant, type, content, action, reason }) {
  if (typeof content !== "string") return null;
  const contentSha256 = sha256(content);
  const latest = await XhuntNacosConfigSnapshot.findOne({
    where: { dataId, group, tenant: tenant || null },
    order: [["createdAt", "DESC"], ["id", "DESC"]],
  });
  if (latest?.contentSha256 === contentSha256) return latest;
  return saveSnapshot(req, { dataId, group, tenant, type, content, action, reason });
}

function unwrapNacosV2Response(resp, label) {
  if (resp.status !== 200) {
    const error = new Error(`${label}失败: status=${resp.status}`);
    error.status = resp.status;
    error.data = resp.data;
    throw error;
  }
  if (resp.data && typeof resp.data === "object" && Object.prototype.hasOwnProperty.call(resp.data, "code")) {
    if (Number(resp.data.code) !== 0) {
      const error = new Error(`${label}失败: ${resp.data.message || resp.data.code}`);
      error.status = 502;
      error.data = resp.data;
      throw error;
    }
    return resp.data.data;
  }
  return resp.data;
}

function normalizeNativeHistoryItem(item, source = "v1") {
  const content = typeof item.content === "string" ? item.content : undefined;
  return {
    id: String(item.id || item.nid || ""),
    lastId: item.lastId ?? null,
    dataId: item.dataId || "",
    group: item.groupName || item.group || DEFAULT_GROUP,
    tenant: item.namespaceId || item.tenant || null,
    appName: item.appName || "",
    md5: item.md5 || null,
    content: content || undefined,
    contentSha256: content ? sha256(content) : null,
    contentLength: content ? Buffer.byteLength(content, "utf8") : null,
    srcIp: item.srcIp || "",
    srcUser: item.srcUser || "",
    opType: String(item.opType || "").trim(),
    createdTime: item.createTime || item.createdTime || null,
    lastModifiedTime: item.modifyTime || item.lastModifiedTime || item.lastModified || null,
    type: item.type || null,
    source,
  };
}

async function fetchNacosNativeHistoryList({ dataId, group, tenant, pageNo, pageSize }) {
  const v3Namespaces = tenant ? [tenant] : ["public", ""];
  let v3Error = null;

  for (const namespaceId of v3Namespaces) {
    const resp = await nacosRequest("GET", "/nacos/v3/admin/cs/history/list", {
      params: { dataId, groupName: group, namespaceId, pageNo, pageSize },
    });
    try {
      const data = unwrapNacosV2Response(resp, "查询 Nacos 原生历史");
      return {
        source: "v3",
        totalCount: Number(data?.totalCount || 0),
        pageNumber: Number(data?.pageNumber || pageNo),
        pagesAvailable: Number(data?.pagesAvailable || 0),
        pageItems: (data?.pageItems || []).map((item) => normalizeNativeHistoryItem(item, "v3")),
      };
    } catch (error) {
      v3Error = error;
    }
  }

  const v1Resp = await nacosRequest("GET", "/nacos/v1/cs/history", {
    params: { search: "accurate", dataId, group, pageNo, pageSize, ...(tenant ? { tenant } : {}) },
  });
  if (v1Resp.status === 200 && v1Resp.data && !v1Resp.data.code) {
    return {
      source: "v1",
      totalCount: Number(v1Resp.data.totalCount || 0),
      pageNumber: Number(v1Resp.data.pageNumber || pageNo),
      pagesAvailable: Number(v1Resp.data.pagesAvailable || 0),
      pageItems: (v1Resp.data.pageItems || []).map((item) => normalizeNativeHistoryItem(item, "v1")),
    };
  }

  const error = v3Error || new Error(`查询 Nacos 原生历史失败: status=${v1Resp.status}`);
  if (!error.status) error.status = v1Resp.status;
  if (!error.data) error.data = v1Resp.data;
  throw error;
}

async function fetchNacosNativeHistoryDetail({ dataId, group, tenant, nid, source }) {
  const v3Namespaces = tenant ? [tenant] : ["public", ""];
  let v3Error = null;
  for (const namespaceId of v3Namespaces) {
    const resp = await nacosRequest("GET", "/nacos/v3/admin/cs/history", {
      params: { nid, dataId, groupName: group, namespaceId },
    });
    try {
      const data = unwrapNacosV2Response(resp, "查询 Nacos 原生历史详情");
      if (data) return normalizeNativeHistoryItem(data, "v3");
    } catch (error) {
      v3Error = error;
    }
  }

  const v1Resp = await nacosRequest("GET", "/nacos/v1/cs/history", {
    params: { nid, dataId, group, ...(tenant ? { tenant } : {}) },
  });
  if (v1Resp.status === 200 && v1Resp.data && !v1Resp.data.code) {
    return normalizeNativeHistoryItem(v1Resp.data, "v1");
  }

  const error = v3Error || new Error(`查询 Nacos 原生历史详情失败: status=${v1Resp.status}`);
  if (!error.status) error.status = v1Resp.status;
  if (!error.data) error.data = v1Resp.data;
  throw error;
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

      await saveSnapshotIfChanged(req, {
        dataId,
        group,
        tenant,
        type,
        content: rawContent,
        action: "sync_current",
        reason: "打开配置中心时同步当前版本",
      }).catch((snapshotError) => {
        console.warn("[nacos-admin/config] sync snapshot failed:", snapshotError.message || snapshotError);
      });

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

router.get(
  "/nacos/admin/config/native-history",
  adminAuth,
  requireRole("super"),
  async (req, res) => {
    try {
      const dataId = validateIdentifier(normalizeDataId(req.query.dataId), "dataId");
      const group = validateIdentifier(normalizeGroup(req.query.group), "group");
      const tenant = req.query.tenant ? validateIdentifier(req.query.tenant, "tenant") : undefined;
      const pageNo = Math.max(Number(req.query.pageNo || 1), 1);
      const pageSize = Math.min(Math.max(Number(req.query.pageSize || 20), 1), 100);
      assertConfigPermission(req, dataId);

      const data = await fetchNacosNativeHistoryList({ dataId, group, tenant, pageNo, pageSize });
      res.json({ success: true, data });
    } catch (error) {
      console.error("[nacos-admin/config/native-history] failed:", error);
      res.status(error.status || 500).json({
        success: false,
        error: error.message || "获取 Nacos 原生历史失败",
        required: error.required,
        data: error.data,
      });
    }
  }
);

router.get(
  "/nacos/admin/config/native-history/:nid",
  adminAuth,
  requireRole("super"),
  async (req, res) => {
    try {
      const nid = validateIdentifier(req.params.nid, "nid");
      const dataId = validateIdentifier(normalizeDataId(req.query.dataId), "dataId");
      const group = validateIdentifier(normalizeGroup(req.query.group), "group");
      const tenant = req.query.tenant ? validateIdentifier(req.query.tenant, "tenant") : undefined;
      const source = req.query.source ? String(req.query.source) : undefined;
      assertConfigPermission(req, dataId);

      const data = await fetchNacosNativeHistoryDetail({ dataId, group, tenant, nid, source });
      res.json({ success: true, data });
    } catch (error) {
      console.error("[nacos-admin/config/native-history/:nid] failed:", error);
      res.status(error.status || 500).json({
        success: false,
        error: error.message || "获取 Nacos 原生历史详情失败",
        required: error.required,
        data: error.data,
      });
    }
  }
);

router.get(
  "/nacos/admin/config/history",
  adminAuth,
  requireRole("super"),
  async (req, res) => {
    try {
      const dataId = validateIdentifier(normalizeDataId(req.query.dataId), "dataId");
      const group = validateIdentifier(normalizeGroup(req.query.group), "group");
      const tenant = req.query.tenant ? validateIdentifier(req.query.tenant, "tenant") : undefined;
      const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
      assertConfigPermission(req, dataId);

      const rows = await XhuntNacosConfigSnapshot.findAll({
        where: {
          dataId,
          group,
          tenant: tenant || null,
        },
        order: [["createdAt", "DESC"], ["id", "DESC"]],
        limit,
      });

      res.json({
        success: true,
        data: rows.map((row) => serializeSnapshot(row)),
      });
    } catch (error) {
      console.error("[nacos-admin/config/history] failed:", error);
      res.status(error.status || 500).json({ success: false, error: error.message || "获取历史版本失败", required: error.required });
    }
  }
);

router.get(
  "/nacos/admin/config/history/:id",
  adminAuth,
  requireRole("super"),
  async (req, res) => {
    try {
      const id = Number(req.params.id || 0);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "无效历史版本 ID" });
      }

      const row = await XhuntNacosConfigSnapshot.findByPk(id);
      if (!row) {
        return res.status(404).json({ success: false, error: "历史版本不存在" });
      }
      assertConfigPermission(req, row.dataId);

      res.json({
        success: true,
        data: serializeSnapshot(row, true),
      });
    } catch (error) {
      console.error("[nacos-admin/config/history/:id] failed:", error);
      res.status(error.status || 500).json({ success: false, error: error.message || "获取历史版本详情失败", required: error.required });
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

      if (beforeContent) {
        await saveSnapshotIfChanged(req, {
          dataId,
          group,
          tenant,
          type: inferType(beforeContent, type),
          content: beforeContent,
          action: "backup_before_publish",
          reason: reason || "发布前自动备份",
        });
      }

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
      await saveSnapshotIfChanged(req, {
        dataId,
        group,
        tenant,
        type,
        content,
        action: "publish",
        reason,
      });

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

      let beforeContent = "";
      let beforeSha256 = null;
      try {
        beforeContent = await readConfig({ dataId, group, tenant });
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

      if (beforeContent) {
        const catalog = CATALOG_MAP.get(dataId);
        await saveSnapshotIfChanged(req, {
          dataId,
          group,
          tenant,
          type: inferType(beforeContent, catalog?.type || DEFAULT_TYPE),
          content: beforeContent,
          action: "delete_backup",
          reason: reason || "删除前自动备份",
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
