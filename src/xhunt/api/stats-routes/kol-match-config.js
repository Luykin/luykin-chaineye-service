const express = require("express");
const { adminAuth, requirePermission } = require("../../../admin/middleware/adminAuth");
const { logAdminAction } = require("./shared");
const { nacosRequest } = require("../../services/nacosConfigClient");
const { XhuntNacosConfigSnapshot } = require("../../../models/postgres-start");
const {
  KOL_MATCH_CONFIG_DATA_ID,
  KOL_MATCH_CONFIG_GROUP,
  clearKolMatchRuntimeConfigCache,
  DEFAULT_KOL_MATCH_RUNTIME_CONFIG,
  getEffectiveConfigFromDocument,
  loadConfigDocument,
  publishRedisConfigVersion,
  resolveKolMatchRuntimeConfigValue,
  sha256,
  validateKolMatchRuntimeConfigDocument,
} = require("../echohunt-kol-match/config");
const { getKolMatchPromptFallbacks } = require("../echohunt-kol-match/prompts");

const router = express.Router();
const CONFIG_TYPE = "json";
const KOL_MATCH_CONFIG_READ_PERMISSIONS = ["kol-match-config:read", "kol-match-config:write", "nacos-admin"];
const KOL_MATCH_CONFIG_WRITE_PERMISSIONS = ["kol-match-config:write", "nacos-admin"];

async function readNacosConfig() {
  const resp = await nacosRequest("GET", "/nacos/v1/cs/configs", {
    params: { dataId: KOL_MATCH_CONFIG_DATA_ID, group: KOL_MATCH_CONFIG_GROUP },
  });
  if (resp.status !== 200) {
    const error = new Error(`读取 KOL Match Nacos 配置失败: status=${resp.status}`);
    error.status = resp.status;
    error.data = resp.data;
    throw error;
  }
  return typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
}

async function saveSnapshot(req, { content, action, reason }) {
  if (typeof content !== "string") return null;
  return XhuntNacosConfigSnapshot.create({
    dataId: KOL_MATCH_CONFIG_DATA_ID,
    group: KOL_MATCH_CONFIG_GROUP,
    tenant: null,
    type: CONFIG_TYPE,
    content,
    contentSha256: sha256(content),
    contentLength: Buffer.byteLength(content, "utf8"),
    action,
    reason: reason || null,
    operatorId: req.adminUser?.id || null,
    operatorEmail: req.adminUser?.email || req.user?.username || null,
  });
}

function serializeSnapshot(row, includeContent = false) {
  const json = row.toJSON ? row.toJSON() : row;
  const data = {
    id: json.id,
    dataId: json.dataId,
    group: json.group,
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

function parseRequestDocument(req) {
  const content = req.body?.content;
  const config = req.body?.config;
  if (typeof content === "string") return JSON.parse(content || "{}");
  if (config && typeof config === "object") return config;
  throw new Error("请提交 config 对象或 content JSON 字符串");
}

function getProductionSignature(document) {
  const effective = getEffectiveConfigFromDocument(document, "production", { source: "compare" });
  const stable = JSON.parse(JSON.stringify(effective || {}));
  delete stable.source;
  delete stable.configSource;
  delete stable.fallbackReason;
  delete stable.contentSha256;
  delete stable.version;
  return JSON.stringify(stable);
}

function hasProductionConfigChange(beforeDocument, afterDocument) {
  return getProductionSignature(beforeDocument) !== getProductionSignature(afterDocument);
}

async function readCurrentConfigForPublish() {
  let rawContent = "";
  let contentSha256 = null;
  let document = DEFAULT_KOL_MATCH_RUNTIME_CONFIG;
  let readError = "";

  try {
    rawContent = await readNacosConfig();
    contentSha256 = sha256(rawContent);
    try {
      document = JSON.parse(rawContent || "{}");
    } catch (error) {
      readError = `当前 Nacos JSON 解析失败: ${error.message || error}`;
    }
  } catch (error) {
    readError = error.message || "读取当前 Nacos 配置失败";
  }

  return { rawContent, contentSha256, document, readError };
}

function buildAutoConfigVersion() {
  const now = new Date();
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return [
    "kol-match",
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    "-",
    pad(now.getMilliseconds(), 3),
  ].join("");
}

function bumpConfigVersion(document) {
  const next = JSON.parse(JSON.stringify(document || {}));
  const version = buildAutoConfigVersion();
  next.version = version;

  // 运行时会优先读取 envs.<env>.version；发布时统一只保留 root version，
  // 避免历史/高级 JSON 里的 env 级旧版本覆盖最新发布版本。
  if (next.envs && typeof next.envs === "object") {
    ["production", "test"].forEach((env) => {
      if (next.envs[env] && typeof next.envs[env] === "object" && !Array.isArray(next.envs[env])) {
        delete next.envs[env].version;
      }
    });
  }

  return next;
}


function pickConfiguredEnv(names = []) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return { value, source: name };
  }
  return { value: "", source: "" };
}

function getKolMatchModelFallbacks() {
  const strategy = pickConfiguredEnv([
    "ECHOHUNT_KOL_MATCH_STRATEGY_LLM_MODEL",
    "KOL_MARKETING_FILTER_LLM_MODEL",
    "LLM_MODEL",
  ]);
  const evaluator = pickConfiguredEnv([
    "ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_MODEL",
    "LLM_MODEL",
  ]);
  return {
    strategyLlm: { model: strategy.value, source: strategy.source },
    evaluatorLlm: { model: evaluator.value, source: evaluator.source },
  };
}

function responseForDocument(document, source, rawContent = "") {
  const validation = validateKolMatchRuntimeConfigDocument(document);
  const normalized = validation.normalizedDocument;
  return {
    dataId: KOL_MATCH_CONFIG_DATA_ID,
    group: KOL_MATCH_CONFIG_GROUP,
    type: CONFIG_TYPE,
    source,
    version: normalized.version,
    content: JSON.stringify(normalized, null, 2),
    contentSha256: sha256(rawContent || JSON.stringify(normalized)),
    valid: validation.valid,
    errors: validation.errors,
    defaults: normalized.defaults,
    envs: normalized.envs,
    effective: {
      production: getEffectiveConfigFromDocument(normalized, "production", { source }),
      test: getEffectiveConfigFromDocument(normalized, "test", { source }),
    },
    promptFallbacks: getKolMatchPromptFallbacks("zh"),
    modelFallbacks: getKolMatchModelFallbacks(),
  };
}

router.get("/echohunt/kol-match/config", adminAuth, requirePermission(KOL_MATCH_CONFIG_READ_PERMISSIONS), async (req, res) => {
  try {
    let rawContent = "";
    let document = DEFAULT_KOL_MATCH_RUNTIME_CONFIG;
    let source = "defaults";
    try {
      rawContent = await readNacosConfig();
      document = JSON.parse(rawContent || "{}");
      source = "nacos";
    } catch (error) {
      const loaded = await loadConfigDocument({ force: true, redisClient: req.redisClient });
      document = loaded.document || DEFAULT_KOL_MATCH_RUNTIME_CONFIG;
      source = loaded.source || "defaults";
      rawContent = JSON.stringify(document);
    }

    const runtimeProduction = await resolveKolMatchRuntimeConfigValue("production", { redisClient: req.redisClient });
    const runtimeTest = await resolveKolMatchRuntimeConfigValue("test", { redisClient: req.redisClient });
    return res.json({
      success: true,
      data: {
        ...responseForDocument(document, source, rawContent),
        runtime: {
          production: runtimeProduction,
          test: runtimeTest,
        },
      },
    });
  } catch (error) {
    console.error("[kol-match-config] read failed:", error);
    return res.status(error.status || 500).json({ success: false, error: error.message || "读取 KOL Match 配置失败", data: error.data });
  }
});

router.post("/echohunt/kol-match/config/validate", adminAuth, requirePermission(KOL_MATCH_CONFIG_READ_PERMISSIONS), async (req, res) => {
  try {
    const document = parseRequestDocument(req);
    const result = validateKolMatchRuntimeConfigDocument(document, { reason: req.body?.reason });
    return res.status(result.valid ? 200 : 400).json({ success: result.valid, data: result, error: result.valid ? undefined : "KOL_MATCH_CONFIG_INVALID" });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || "配置校验失败" });
  }
});

router.post("/echohunt/kol-match/config/publish", adminAuth, requirePermission(KOL_MATCH_CONFIG_WRITE_PERMISSIONS), async (req, res) => {
  let afterSha256 = null;
  try {
    const document = parseRequestDocument(req);
    const reason = String(req.body?.reason || "").trim().slice(0, 500);
    const result = validateKolMatchRuntimeConfigDocument(document, { reason });
    if (!result.valid) {
      return res.status(400).json({ success: false, error: "KOL_MATCH_CONFIG_INVALID", data: result });
    }

    const publishDocument = bumpConfigVersion(result.normalizedDocument);
    const before = await readCurrentConfigForPublish();
    const productionChanged = hasProductionConfigChange(before.document, publishDocument);
    if (productionChanged && !reason) {
      return res.status(400).json({
        success: false,
        error: "PRODUCTION_REASON_REQUIRED",
        message: "修改 production 配置必须填写 reason",
        data: { productionChanged: true, requiresProductionReason: true },
      });
    }
    if (productionChanged && String(req.body?.productionConfirm || "") !== "CONFIRM") {
      return res.status(400).json({
        success: false,
        error: "PRODUCTION_CONFIRM_REQUIRED",
        message: "修改 production 配置必须二次确认",
        data: { productionChanged: true, requiresProductionConfirm: true },
      });
    }

    if (before.rawContent) {
      await saveSnapshot(req, { content: before.rawContent, action: "backup_before_kol_match_publish", reason: reason || "KOL Match 发布前自动备份" });
    }

    const content = JSON.stringify(publishDocument, null, 2);
    afterSha256 = sha256(content);
    const form = new URLSearchParams({
      dataId: KOL_MATCH_CONFIG_DATA_ID,
      group: KOL_MATCH_CONFIG_GROUP,
      content,
      type: CONFIG_TYPE,
    });
    const resp = await nacosRequest("POST", "/nacos/v1/cs/configs", {
      data: form.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const ok = resp.status === 200 && (resp.data === true || resp.data === "true");
    if (!ok) {
      return res.status(resp.status || 500).json({ success: false, error: "发布 Nacos 配置失败", data: resp.data });
    }

    await saveSnapshot(req, { content, action: "kol_match_publish", reason });
    await publishRedisConfigVersion(req.redisClient, publishDocument.version || afterSha256).catch(() => false);
    clearKolMatchRuntimeConfigCache();
    const runtimeProduction = await resolveKolMatchRuntimeConfigValue("production", { force: true, redisClient: req.redisClient });
    const runtimeTest = await resolveKolMatchRuntimeConfigValue("test", { redisClient: req.redisClient });

    await logAdminAction(req, {
      action: "kol-match-config-publish",
      success: true,
      message: `before=${before.contentSha256 || "new"} after=${afterSha256} reason=${reason || "-"}`,
    });

    return res.json({
      success: true,
      data: {
        published: true,
        beforeSha256: before.contentSha256,
        afterSha256,
        changed: before.contentSha256 !== afterSha256,
        productionChanged,
        beforeReadError: before.readError || undefined,
        version: publishDocument.version,
        runtime: { production: runtimeProduction, test: runtimeTest },
      },
    });
  } catch (error) {
    console.error("[kol-match-config] publish failed:", error);
    await logAdminAction(req, {
      action: "kol-match-config-publish",
      success: false,
      message: `${error.message || "failed"} after=${afterSha256 || "-"}`,
    }).catch(() => {});
    return res.status(error.status || 500).json({ success: false, error: error.message || "发布 KOL Match 配置失败", data: error.data });
  }
});

router.post("/echohunt/kol-match/config/refresh-cache", adminAuth, requirePermission(KOL_MATCH_CONFIG_WRITE_PERMISSIONS), async (req, res) => {
  try {
    clearKolMatchRuntimeConfigCache();
    const production = await resolveKolMatchRuntimeConfigValue("production", { force: true, redisClient: req.redisClient });
    const test = await resolveKolMatchRuntimeConfigValue("test", { redisClient: req.redisClient });
    await publishRedisConfigVersion(req.redisClient, production.version).catch(() => false);
    return res.json({
      success: true,
      data: {
        refreshed: true,
        configVersion: production.version,
        source: production.configSource,
        refreshedAt: new Date().toISOString(),
        runtime: { production, test },
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message || "刷新 KOL Match 配置缓存失败" });
  }
});

router.get("/echohunt/kol-match/config/history", adminAuth, requirePermission(KOL_MATCH_CONFIG_READ_PERMISSIONS), async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const rows = await XhuntNacosConfigSnapshot.findAll({
      where: { dataId: KOL_MATCH_CONFIG_DATA_ID, group: KOL_MATCH_CONFIG_GROUP, tenant: null },
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      limit,
    });
    return res.json({ success: true, data: rows.map((row) => serializeSnapshot(row)) });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message || "获取 KOL Match 配置历史失败" });
  }
});

router.get("/echohunt/kol-match/config/history/:id", adminAuth, requirePermission(KOL_MATCH_CONFIG_READ_PERMISSIONS), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "无效历史版本 ID" });
    const row = await XhuntNacosConfigSnapshot.findByPk(id);
    if (!row || row.dataId !== KOL_MATCH_CONFIG_DATA_ID || row.group !== KOL_MATCH_CONFIG_GROUP) {
      return res.status(404).json({ success: false, error: "历史版本不存在" });
    }
    return res.json({ success: true, data: serializeSnapshot(row, true) });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message || "获取 KOL Match 配置历史详情失败" });
  }
});

module.exports = router;
