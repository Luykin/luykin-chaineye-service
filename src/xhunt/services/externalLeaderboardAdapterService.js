const axios = require("axios");
const crypto = require("crypto");
const { Op } = require("sequelize");
const { structuredChat } = require("../../lib/llm");
const { DATA_SERVICE_BASE_URL } = require("../constants/dataService");
const { getCustomLeaderboardAdapterKey } = require("../utils/custom-leaderboard-key");
const {
  XhuntExternalLeaderboardAdapter,
  XHuntBinanceSquareBinding,
} = require("../../models/postgres-start");

const REQUEST_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SAMPLE_ROWS = 50;
const MAX_LEADERBOARD_ROWS = 10000;
const runtimeCache = new Map();

function error(message, status = 400, code = "EXTERNAL_LEADERBOARD_ADAPTER_INVALID") {
  const value = new Error(message);
  value.status = status;
  value.code = code;
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value || {})).digest("hex");
}

function cleanCampaignKey(value) {
  const key = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(key)) throw error("campaignKey 格式不正确");
  return key;
}

function cleanLeaderboardKey(value) {
  const key = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(key)) throw error("leaderboardKey 格式不正确");
  return key;
}

function getAllowedHosts() {
  const configured = String(process.env.EXTERNAL_LEADERBOARD_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  try {
    const dataUrl = new URL(DATA_SERVICE_BASE_URL);
    if (dataUrl.host) configured.push(dataUrl.host.toLowerCase());
    if (dataUrl.hostname) configured.push(dataUrl.hostname.toLowerCase());
  } catch (_) {}
  return new Set(configured);
}

function resolveRequestUrl(rawUrl, campaignKey, query = {}) {
  const raw = String(rawUrl || "").trim();
  if (!raw) throw error("榜单接口 URL 不能为空");
  let url;
  try {
    url = new URL(raw.replace(/\{campaign\}/g, encodeURIComponent(campaignKey)));
  } catch (_) {
    throw error("榜单接口 URL 必须是完整 URL");
  }
  if (!/^https?:$/.test(url.protocol)) throw error("榜单接口仅允许 HTTP 或 HTTPS");
  if (url.username || url.password) throw error("榜单接口 URL 不允许内嵌认证信息");
  const allowed = getAllowedHosts();
  const host = url.host.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  if (!allowed.has(host) && !allowed.has(hostname)) {
    throw error(`接口域名不在内部 allowlist：${url.host}`, 400, "EXTERNAL_LEADERBOARD_HOST_NOT_ALLOWED");
  }
  Object.entries(query && typeof query === "object" ? query : {}).forEach(([key, value]) => {
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) throw error(`query 参数名不合法：${key}`);
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value).replace(/\{campaign\}/g, campaignKey));
  });
  return url.toString();
}

function getPath(value, path) {
  const expression = String(path || "").trim();
  if (!expression || expression === "$") return value;
  if (!expression.startsWith("$")) return undefined;
  const tokens = expression.slice(1).match(/(?:\.([A-Za-z_$][\w$]*))|(?:\[(\d+)\])/g) || [];
  if (tokens.join("") !== expression.slice(1)) return undefined;
  let current = value;
  for (const token of tokens) {
    const key = token.startsWith(".") ? token.slice(1) : token.slice(1, -1);
    if (["__proto__", "prototype", "constructor"].includes(key) || current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}

function getMappedValue(row, value) {
  const paths = Array.isArray(value) ? value : value ? [value] : [];
  for (const path of paths) {
    const found = getPath(row, path);
    if (found !== undefined && found !== null && found !== "") return found;
  }
  return null;
}

function sanitizeSample(value, depth = 0) {
  if (depth > 6) return "[truncated depth]";
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 5).map((item) => sanitizeSample(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, sanitizeSample(item, depth + 1)]));
  }
  return String(value);
}

function normalizeConfig(config = {}) {
  const requests = Array.isArray(config.requests) ? config.requests : [];
  if (!requests.length) throw error("至少需要配置一个 board 请求");
  const normalizedRequests = requests.map((item, index) => ({
    key: String(item?.key || (index === 0 ? "board" : `request_${index + 1}`)).trim(),
    url: String(item?.url || "").trim(),
    query: item?.query && typeof item.query === "object" ? item.query : {},
    required: item?.required !== false,
  }));
  if (!normalizedRequests.some((item) => item.key === "board")) throw error("必须配置 key 为 board 的请求");
  if (new Set(normalizedRequests.map((item) => item.key)).size !== normalizedRequests.length) throw error("请求 key 不能重复");
  normalizedRequests.forEach((item) => {
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(item.key)) throw error("请求 key 格式不正确");
    if (!item.url) throw error(`${item.key} 请求缺少 URL`);
  });
  const fields = config.fields && typeof config.fields === "object" ? config.fields : {};
  return {
    requests: normalizedRequests,
    rowsPath: String(config.rowsPath || "").trim(),
    updatedAt: config.updatedAt && typeof config.updatedAt === "object"
      ? { requestKey: String(config.updatedAt.requestKey || "board"), path: String(config.updatedAt.path || "") }
      : null,
    fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Array.isArray(value) ? value.map(String) : [String(value || "")].filter(Boolean)])),
    sort: config.sort?.field ? { field: String(config.sort.field), direction: config.sort.direction === "asc" ? "asc" : "desc" } : { field: "share", direction: "desc" },
  };
}

async function executeRequests(campaignKey, config) {
  const responses = {};
  const failures = [];
  await Promise.all(config.requests.map(async (request) => {
    try {
      const url = resolveRequestUrl(request.url, campaignKey, request.query);
      const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT_MS,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_RESPONSE_BYTES,
        maxRedirects: 0,
        responseType: "json",
      });
      responses[request.key] = { data: response.data, url, status: response.status, latencyMs: Number(response.headers?.["x-response-time"]) || null };
    } catch (cause) {
      failures.push({ key: request.key, message: cause.message || String(cause), required: request.required });
    }
  }));
  const requiredFailure = failures.find((item) => item.required);
  if (requiredFailure) throw error(`${requiredFailure.key} 请求失败：${requiredFailure.message}`, 502, "EXTERNAL_LEADERBOARD_UPSTREAM_FAILED");
  return { responses, failures };
}

function toText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBoolean(value) {
  return value === true || value === 1 || ["true", "1", "yes"].includes(String(value || "").trim().toLowerCase());
}

async function enrichBinanceAccelerated(rows) {
  const twitterIds = [...new Set(rows.map((row) => row.twitterId).filter(Boolean))];
  if (!twitterIds.length) return rows;
  const bindings = await XHuntBinanceSquareBinding.findAll({
    where: { twitterId: { [Op.in]: twitterIds }, status: "active", revokedAt: null },
    attributes: ["twitterId"],
  });
  const active = new Set(bindings.map((item) => String(item.twitterId)));
  return rows.map((row) => ({
    ...row,
    binanceSquareAccelerated: active.has(row.twitterId),
    // 现有网站展示器读取该兼容字段。
    booster_bisquare: active.has(row.twitterId),
  }));
}

async function transformResponses(campaignKey, config, execution, { strict = true } = {}) {
  const board = execution.responses.board?.data;
  const rows = getPath(board, config.rowsPath);
  if (!Array.isArray(rows)) throw error("rowsPath 未命中数组，无法转换榜单");
  if (rows.length > MAX_LEADERBOARD_ROWS) throw error(`榜单行数超过上限 ${MAX_LEADERBOARD_ROWS}，拒绝截断不完整数据`);
  const issues = [];
  const converted = rows.map((item, index) => {
    const username = toText(getMappedValue(item, config.fields.username)).replace(/^@+/, "");
    const handle = username ? `@${username}` : toText(getMappedValue(item, config.fields.handle));
    const share = toNumber(getMappedValue(item, config.fields.share));
    const row = {
      rank: toNumber(getMappedValue(item, config.fields.rank)) || index + 1,
      twitterId: toText(getMappedValue(item, config.fields.twitterId)) || null,
      username: username || null,
      handle: handle || null,
      name: toText(getMappedValue(item, config.fields.name)) || username || null,
      avatar: toText(getMappedValue(item, config.fields.avatar)) || null,
      share,
      shareText: share === null ? null : `${(share * 100).toFixed(2).replace(/\.?0+$/, "")}%`,
      score: toNumber(getMappedValue(item, config.fields.score)),
      raw: sanitizeSample(item),
    };
    if (!row.twitterId) issues.push({ row: index + 1, field: "twitterId", message: "缺少 Twitter ID", level: "error" });
    if (!row.name && !row.handle && !row.username) issues.push({ row: index + 1, field: "name", message: "缺少 Hunter 名称或 handle", level: "error" });
    if (!row.avatar) issues.push({ row: index + 1, field: "avatar", message: "缺少头像（前端将回退默认首字母头像）", level: "warn" });
    if (row.avatar && !/^https?:\/\//i.test(row.avatar)) issues.push({ row: index + 1, field: "avatar", message: "头像不是 HTTP(S) URL", level: "error" });
    if (share === null || share < 0 || share > 1) issues.push({ row: index + 1, field: "share", message: "share 必须是 0~1", level: "error" });
    return row;
  });
  if (!converted.length) throw error("榜单行为空");
  const sorted = converted.sort((left, right) => {
    const direction = config.sort.direction === "asc" ? 1 : -1;
    return ((Number(left[config.sort.field]) || 0) - (Number(right[config.sort.field]) || 0)) * direction;
  }).map((row, index) => ({ ...row, rank: index + 1 }));
  const enriched = await enrichBinanceAccelerated(sorted);
  const updatedRaw = config.updatedAt?.path ? getPath(execution.responses[config.updatedAt.requestKey]?.data, config.updatedAt.path) : null;
  const parsedUpdatedAt = updatedRaw ? new Date(updatedRaw) : null;
  const updatedAt = parsedUpdatedAt && !Number.isNaN(parsedUpdatedAt.getTime()) ? parsedUpdatedAt.toISOString() : null;
  const blockingIssues = issues.filter((item) => item.level === "error");
  if (strict && blockingIssues.length) throw error(`转换校验失败：${blockingIssues.slice(0, 3).map((item) => item.message).join("、")}`, 422, "EXTERNAL_LEADERBOARD_PREVIEW_INVALID");
  return {
    campaign: campaignKey,
    updatedAt: updatedAt || new Date().toISOString(),
    leaderboardDataUpdatedAt: updatedAt,
    rows: enriched,
    issues,
    metrics: {
      total: rows.length,
      valid: rows.length - new Set(issues.map((item) => item.row)).size,
      twitterIdCoverage: rows.length ? Number(((rows.length - issues.filter((item) => item.field === "twitterId").length) / rows.length).toFixed(4)) : 0,
      avatarCoverage: rows.length ? Number(((rows.length - issues.filter((item) => item.field === "avatar").length) / rows.length).toFixed(4)) : 0,
      shareCoverage: rows.length ? Number(((rows.length - issues.filter((item) => item.field === "share").length) / rows.length).toFixed(4)) : 0,
    },
  };
}

function inferPath(root, candidates, base = "$") {
  if (!root || typeof root !== "object") return "";
  for (const key of candidates) if (Object.prototype.hasOwnProperty.call(root, key)) return `${base}.${key}`;
  for (const [key, value] of Object.entries(root)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const found = inferPath(value, candidates, `${base}.${key}`);
      if (found) return found;
    }
  }
  return "";
}

function inferRowsPath(root, base = "$") {
  if (Array.isArray(root)) return base;
  if (!root || typeof root !== "object") return "";
  for (const [key, value] of Object.entries(root)) {
    const found = inferRowsPath(value, `${base}.${key}`);
    if (found) return found;
  }
  return "";
}

function heuristicMapping(sample, config) {
  const rowsPath = config.rowsPath || inferRowsPath(sample.responses?.board?.data);
  const row = Array.isArray(getPath(sample.responses?.board?.data, rowsPath)) ? getPath(sample.responses.board.data, rowsPath)[0] : {};
  return {
    ...config,
    rowsPath,
    fields: {
      rank: [inferPath(row, ["rank", "position"])].filter(Boolean),
      twitterId: [inferPath(row, ["twitterId", "twitter_id", "t_twitter_id", "user_id"])].filter(Boolean),
      username: [inferPath(row, ["username", "screen_name", "handle", "handler"])].filter(Boolean),
      handle: [inferPath(row, ["handle", "handler", "username", "screen_name"])].filter(Boolean),
      name: [inferPath(row, ["name", "displayName", "nickname", "username"])].filter(Boolean),
      avatar: [inferPath(row, ["avatar", "profile_image_url", "image", "profileImageUrl"])].filter(Boolean),
      share: [inferPath(row, ["share", "mindshare", "mind_share", "score"])].filter(Boolean),
      score: [inferPath(row, ["score", "score_adj", "raw_score", "points"])].filter(Boolean),
    },
  };
}

const AI_MAPPING_SCHEMA = {
  type: "object",
  required: ["rowsPath", "fields"],
  properties: {
    rowsPath: { type: "string" },
    fields: {
      type: "object",
      properties: {
        rank: { type: "array", items: { type: "string" } },
        twitterId: { type: "array", items: { type: "string" } },
        username: { type: "array", items: { type: "string" } },
        handle: { type: "array", items: { type: "string" } },
        name: { type: "array", items: { type: "string" } },
        avatar: { type: "array", items: { type: "string" } },
        share: { type: "array", items: { type: "string" } },
        score: { type: "array", items: { type: "string" } },
      },
    },
    sort: { type: "object" },
  },
};

async function getOrCreateAdapter(campaignKey, leaderboardKey) {
  const key = cleanCampaignKey(campaignKey);
  const boardKey = cleanLeaderboardKey(leaderboardKey);
  const [adapter] = await XhuntExternalLeaderboardAdapter.findOrCreate({
    where: { campaignKey: key, leaderboardKey: boardKey },
    defaults: { campaignKey: key, leaderboardKey: boardKey },
  });
  return adapter;
}

function serializeAdapter(adapter) {
  const value = adapter?.toJSON ? adapter.toJSON() : adapter;
  if (!value) return null;
  return {
    campaignKey: value.campaignKey,
    leaderboardKey: value.leaderboardKey,
    status: value.status,
    draftConfig: value.draftConfig || {},
    publishedVersion: value.publishedVersion || 0,
    publishedAt: value.publishedAt || null,
    lastSample: value.lastSample || {},
    lastPreview: value.lastPreview || {},
    hasPublishedVersion: !!value.publishedConfig,
  };
}

async function getAdapter(campaignKey, leaderboardKey) {
  const adapter = await XhuntExternalLeaderboardAdapter.findOne({
    where: { campaignKey: cleanCampaignKey(campaignKey), leaderboardKey: cleanLeaderboardKey(leaderboardKey) },
  });
  return serializeAdapter(adapter);
}

async function saveDraft(campaignKey, leaderboardKey, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const adapter = await getOrCreateAdapter(campaignKey, leaderboardKey);
  await adapter.update({ draftConfig: config, status: adapter.publishedConfig ? "published" : "draft", lastPreview: {} });
  return serializeAdapter(adapter);
}

async function fetchSample(campaignKey, leaderboardKey, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const execution = await executeRequests(cleanCampaignKey(campaignKey), config);
  const sample = {
    fetchedAt: new Date().toISOString(),
    configFingerprint: hash(config),
    responseFingerprint: hash(Object.fromEntries(Object.entries(execution.responses).map(([key, value]) => [key, value.data]))),
    failures: execution.failures,
    responses: Object.fromEntries(Object.entries(execution.responses).map(([key, value]) => [key, { status: value.status, url: value.url, data: sanitizeSample(value.data) }])),
  };
  const adapter = await getOrCreateAdapter(campaignKey, leaderboardKey);
  await adapter.update({ draftConfig: config, lastSample: sample, lastPreview: {}, status: adapter.publishedConfig ? "published" : "draft" });
  return { adapter: serializeAdapter(adapter), sample };
}

async function generateMapping(campaignKey, leaderboardKey, rawConfig, instruction = "") {
  const adapter = await getOrCreateAdapter(campaignKey, leaderboardKey);
  const config = normalizeConfig(rawConfig || adapter.draftConfig || {});
  const sample = adapter.lastSample || {};
  if (!sample.responses?.board?.data) throw error("请先成功试拉取接口样本");
  let generated = null;
  let source = "heuristic";
  if (process.env.LLM_API_KEY) {
    try {
      generated = await structuredChat(
        `为外部活动榜单生成受限 JSONPath 映射。只使用以下接口样本，不要编造字段。share 必须是 0~1。\n业务补充说明：${String(instruction || "无").slice(0, 1000)}\n样本：${JSON.stringify(sample.responses)}`,
        AI_MAPPING_SCHEMA,
        { systemPrompt: "你是榜单数据结构映射助手。仅返回 JSONPath（以 $ 开头）数组，不生成代码、URL、headers 或表达式。" }
      );
      source = "llm";
    } catch (cause) {
      console.warn("[ExternalLeaderboardAdapter] LLM mapping fallback:", cause.message || cause);
    }
  }
  const nextConfig = normalizeConfig({ ...config, ...(generated || heuristicMapping(sample, config)), requests: config.requests });
  await adapter.update({ draftConfig: nextConfig, lastPreview: {}, status: adapter.publishedConfig ? "published" : "draft" });
  return { adapter: serializeAdapter(adapter), source, config: nextConfig };
}

async function previewAdapter(campaignKey, leaderboardKey, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const execution = await executeRequests(cleanCampaignKey(campaignKey), config);
  const result = await transformResponses(cleanCampaignKey(campaignKey), config, execution, { strict: false });
  const blockingIssues = result.issues.filter((item) => item.level === "error");
  const preview = {
    passed: blockingIssues.length === 0,
    previewedAt: new Date().toISOString(),
    configFingerprint: hash(config),
    responseFingerprint: hash(Object.fromEntries(Object.entries(execution.responses).map(([key, value]) => [key, value.data]))),
    schemaFingerprint: hash(Object.fromEntries(Object.entries(execution.responses).map(([key, value]) => [key, sanitizeSample(value.data)]))),
    issues: blockingIssues.slice(0, 100),
    metrics: result.metrics,
    rows: result.rows.slice(0, MAX_SAMPLE_ROWS),
    updatedAt: result.updatedAt,
    leaderboardDataUpdatedAt: result.leaderboardDataUpdatedAt,
  };
  const adapter = await getOrCreateAdapter(campaignKey, leaderboardKey);
  await adapter.update({ draftConfig: config, lastPreview: preview, status: preview.passed ? "previewed" : "draft" });
  return { adapter: serializeAdapter(adapter), preview };
}

async function publishAdapter(campaignKey, leaderboardKey, { confirmed = false, configFingerprint, responseFingerprint, adminId } = {}) {
  if (confirmed !== true) throw error("请确认转换结果可用于公开榜单");
  const adapter = await getOrCreateAdapter(campaignKey, leaderboardKey);
  const preview = adapter.lastPreview || {};
  if (!preview.passed) throw error("请先完成无错误的转换预览", 422, "EXTERNAL_LEADERBOARD_PREVIEW_REQUIRED");
  const currentFingerprint = hash(adapter.draftConfig || {});
  if (configFingerprint !== currentFingerprint || responseFingerprint !== preview.responseFingerprint) {
    throw error("预览已失效，请重新试拉取并预览", 422, "EXTERNAL_LEADERBOARD_PREVIEW_STALE");
  }
  const config = normalizeConfig(adapter.draftConfig || {});
  const execution = await executeRequests(cleanCampaignKey(campaignKey), config);
  const currentResponseFingerprint = hash(
    Object.fromEntries(Object.entries(execution.responses).map(([key, value]) => [key, value.data]))
  );
  if (currentResponseFingerprint !== preview.responseFingerprint) {
    throw error("上游数据或结构已变化，请重新试拉取并预览", 422, "EXTERNAL_LEADERBOARD_RESPONSE_CHANGED");
  }
  const version = Number(adapter.publishedVersion || 0) + 1;
  await adapter.update({
    publishedConfig: adapter.draftConfig,
    publishedVersion: version,
    publishedAt: new Date(),
    publishedByAdminId: adminId || null,
    status: "published",
  });
  runtimeCache.delete(cleanCampaignKey(campaignKey));
  return serializeAdapter(adapter);
}

async function getPublishedLeaderboard(campaignKey, customLeaderboards = []) {
  // 读取路径只对「已发布适配器」的活动生效：campaignKey 不合法或查不到适配器时
  // 一律返回 null，由调用方回退 legacy 流程，绝不在这里抛错影响既有活动。
  let key;
  try {
    key = cleanCampaignKey(campaignKey);
  } catch (_) {
    return null;
  }
  const cached = runtimeCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.data;
  const leaderboardKeys = [...new Set(customLeaderboards.map((item, index) =>
    getCustomLeaderboardAdapterKey(item, index)
  ).filter(Boolean))];
  if (!leaderboardKeys.length) return null;
  let adapters;
  try {
    adapters = await XhuntExternalLeaderboardAdapter.findAll({
      where: {
        campaignKey: key,
        leaderboardKey: { [Op.in]: leaderboardKeys },
        publishedConfig: { [Op.ne]: null },
      },
    });
  } catch (cause) {
    console.warn("[ExternalLeaderboardAdapter] adapter lookup failed, fallback to legacy:", cause.message || cause);
    return null;
  }
  if (!adapters.length) {
    // 负缓存：未配置适配器的活动在 TTL 内不再重复查库。
    runtimeCache.set(key, { data: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }

  const settled = await Promise.allSettled(adapters.map(async (adapter) => {
    const config = normalizeConfig(adapter.publishedConfig);
    const execution = await executeRequests(key, config);
    const transformed = await transformResponses(key, config, execution, { strict: true });
    return { adapter, transformed };
  }));
  const successful = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const cachedLeaderboards = cached?.data?.leaderboards || {};
  const cachedVersions = cached?.data?.mappingVersions || {};
  const leaderboards = {};
  const mappingVersions = {};
  successful.forEach(({ adapter, transformed }) => {
    leaderboards[adapter.leaderboardKey] = transformed.rows;
    mappingVersions[adapter.leaderboardKey] = adapter.publishedVersion;
  });
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") return;
    const adapter = adapters[index];
    if (cachedLeaderboards[adapter.leaderboardKey]) {
      leaderboards[adapter.leaderboardKey] = cachedLeaderboards[adapter.leaderboardKey];
      mappingVersions[adapter.leaderboardKey] = cachedVersions[adapter.leaderboardKey] || adapter.publishedVersion;
    }
  });
  if (!Object.keys(leaderboards).length) {
    if (cached?.data) return cached.data;
    const failure = settled.find((result) => result.status === "rejected");
    throw failure?.reason || error("已发布的外部榜单适配器执行失败", 502, "EXTERNAL_LEADERBOARD_UPSTREAM_FAILED");
  }
  const updatedAt = successful.map(({ transformed }) => transformed.updatedAt).filter(Boolean).sort().slice(-1)[0] || cached?.data?.updatedAt || new Date().toISOString();
  const leaderboardDataUpdatedAt = successful.map(({ transformed }) => transformed.leaderboardDataUpdatedAt).filter(Boolean).sort().slice(-1)[0] || cached?.data?.leaderboardDataUpdatedAt || null;
  const data = {
    campaign: key,
    updatedAt,
    leaderboardDataUpdatedAt,
    leaderboards,
    source: "external-adapter",
    mappingVersion: Math.max(...Object.values(mappingVersions).map((version) => Number(version || 0))),
    mappingVersions,
  };
  runtimeCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

module.exports = {
  fetchSample,
  generateMapping,
  getAdapter,
  getPublishedLeaderboard,
  previewAdapter,
  publishAdapter,
  saveDraft,
};
