const crypto = require("crypto");
const { getNacosConfigContent } = require("../../services/nacosConfigClient");

const KOL_MATCH_CONFIG_DATA_ID = process.env.ECHOHUNT_KOL_MATCH_CONFIG_DATA_ID || "echohunt-kol-match-runtime-config.json";
const KOL_MATCH_CONFIG_GROUP = process.env.ECHOHUNT_KOL_MATCH_CONFIG_GROUP || "XHUNT";
const KOL_MATCH_CONFIG_TTL_MS = Number.isFinite(Number(process.env.ECHOHUNT_KOL_MATCH_CONFIG_TTL_MS))
  ? Math.max(5_000, Number(process.env.ECHOHUNT_KOL_MATCH_CONFIG_TTL_MS))
  : 45_000;
const KOL_MATCH_REDIS_VERSION_KEY = process.env.ECHOHUNT_KOL_MATCH_CONFIG_REDIS_VERSION_KEY || "echohunt:kol-match:config:version";
const HARD_LIMITS = {
  aiResultLimitMax: 200,
  aiRecallTopKMax: 2000,
  filterResultLimitMax: 200,
  filterCandidateScanLimitMax: 5000,
  quotaMax: 100,
  strategyTimeoutMin: 1000,
  strategyTimeoutMax: 60000,
  evaluatorTimeoutMin: 5000,
  evaluatorTimeoutMax: 120000,
  evaluatorBatchSizeMax: 20,
  maxTokensCapMax: 12000,
  promptFieldMaxLength: 20000,
  promptArrayMaxItems: 50,
};

const DEFAULT_KOL_MATCH_RUNTIME_CONFIG = Object.freeze({
  version: "defaults-2026-08-20-v1",
  defaults: {
    limits: {
      aiDailyLimit: 3,
      filterDailyLimit: 10,
      aiResultLimit: 50,
      aiRecallTopK: 100,
      filterResultLimit: 200,
      filterCandidateScanLimit: 2000,
    },
    strategyLlm: {
      enabled: true,
      model: "",
      timeoutMs: 10000,
      maxTokens: 1200,
      temperature: 0,
    },
    evaluatorLlm: {
      enabled: true,
      model: "",
      timeoutMs: 45000,
      batchSize: 10,
      maxTokensBase: 900,
      maxTokensPerCandidate: 300,
      maxTokensCap: 5000,
      temperature: 0,
    },
    prompts: {
      strategy: {
        taskPrompt: "",
        systemPrompt: "",
        extraRules: [],
      },
      candidateEvaluation: {
        taskPrompt: "",
        systemPrompt: "",
        authoritativeRules: [],
        scoreCalibration: [],
      },
    },
  },
  envs: {
    production: {},
    test: {},
  },
});

let configCache = {
  loadedAt: 0,
  expireAt: 0,
  redisVersion: "",
  document: null,
  source: "defaults",
  fallbackReason: "",
  contentSha256: "",
};

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(target, source) {
  const output = clone(target || {});
  if (!isPlainObject(source)) return output;
  Object.entries(source).forEach(([key, value]) => {
    if (value === undefined) return;
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else if (Array.isArray(value)) {
      output[key] = value.slice();
    } else {
      output[key] = value;
    }
  });
  return output;
}

function normalizeEchohuntAppEnv(reqOrValue) {
  const raw = typeof reqOrValue === "string"
    ? reqOrValue
    : reqOrValue?.headers?.["x-echohunt-app-env"];
  const rawText = String(raw || "").trim();
  return {
    raw: rawText,
    value: rawText === "test" ? "test" : "production",
  };
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampInteger(value, fallback, min, max) {
  const parsed = parsePositiveInteger(value);
  if (parsed === null) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(value, fallback, min, max) {
  const parsed = parseNumber(value);
  if (parsed === null) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseEnvBoolean(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

function applyPath(target, path, value) {
  if (value === undefined || value === null || value === "") return false;
  let cursor = target;
  path.slice(0, -1).forEach((key) => {
    if (!isPlainObject(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  });
  cursor[path[path.length - 1]] = value;
  return true;
}

function buildEnvOverrideDocument() {
  const doc = { defaults: {}, envs: { production: {}, test: {} } };
  let hasAny = false;
  const legacyIntegerMap = [
    ["ECHOHUNT_KOL_MATCH_AI_DAILY_LIMIT", ["defaults", "limits", "aiDailyLimit"]],
    ["ECHOHUNT_KOL_MATCH_FILTER_DAILY_LIMIT", ["defaults", "limits", "filterDailyLimit"]],
    ["ECHOHUNT_KOL_MATCH_AI_RESULT_LIMIT", ["defaults", "limits", "aiResultLimit"]],
    ["ECHOHUNT_KOL_MATCH_RECALL_TOP_K", ["defaults", "limits", "aiRecallTopK"]],
    ["ECHOHUNT_KOL_MATCH_FILTER_RESULT_LIMIT", ["defaults", "limits", "filterResultLimit"]],
    ["ECHOHUNT_KOL_MATCH_FILTER_CANDIDATE_SCAN_LIMIT", ["defaults", "limits", "filterCandidateScanLimit"]],
    ["ECHOHUNT_KOL_MATCH_STRATEGY_LLM_TIMEOUT_MS", ["defaults", "strategyLlm", "timeoutMs"]],
    ["ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_TIMEOUT_MS", ["defaults", "evaluatorLlm", "timeoutMs"]],
    ["ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_BATCH_SIZE", ["defaults", "evaluatorLlm", "batchSize"]],
  ];
  legacyIntegerMap.forEach(([name, path]) => {
    const value = parsePositiveInteger(process.env[name]);
    if (applyPath(doc, path, value)) hasAny = true;
  });

  const stringMap = [
    ["ECHOHUNT_KOL_MATCH_STRATEGY_LLM_MODEL", ["defaults", "strategyLlm", "model"]],
    ["ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_MODEL", ["defaults", "evaluatorLlm", "model"]],
  ];
  stringMap.forEach(([name, path]) => {
    if (applyPath(doc, path, process.env[name])) hasAny = true;
  });

  const strategyEnabled = parseEnvBoolean("ECHOHUNT_KOL_MATCH_STRATEGY_LLM_ENABLED");
  if (applyPath(doc, ["defaults", "strategyLlm", "enabled"], strategyEnabled)) hasAny = true;
  const evaluatorEnabled = parseEnvBoolean("ECHOHUNT_KOL_MATCH_EVALUATOR_LLM_ENABLED");
  if (applyPath(doc, ["defaults", "evaluatorLlm", "enabled"], evaluatorEnabled)) hasAny = true;

  ["production", "test"].forEach((env) => {
    const prefix = `ECHOHUNT_KOL_MATCH_${env.toUpperCase()}_`;
    [
      ["AI_DAILY_LIMIT", ["envs", env, "limits", "aiDailyLimit"]],
      ["FILTER_DAILY_LIMIT", ["envs", env, "limits", "filterDailyLimit"]],
      ["AI_RESULT_LIMIT", ["envs", env, "limits", "aiResultLimit"]],
      ["RECALL_TOP_K", ["envs", env, "limits", "aiRecallTopK"]],
      ["FILTER_RESULT_LIMIT", ["envs", env, "limits", "filterResultLimit"]],
      ["FILTER_CANDIDATE_SCAN_LIMIT", ["envs", env, "limits", "filterCandidateScanLimit"]],
    ].forEach(([suffix, path]) => {
      const value = parsePositiveInteger(process.env[`${prefix}${suffix}`]);
      if (applyPath(doc, path, value)) hasAny = true;
    });
  });

  return hasAny ? doc : null;
}

function sanitizeString(value, maxLength = HARD_LIMITS.promptFieldMaxLength) {
  return String(value || "").slice(0, maxLength);
}

function sanitizeStringArray(value, maxItems = HARD_LIMITS.promptArrayMaxItems, maxLength = HARD_LIMITS.promptFieldMaxLength) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => sanitizeString(item, maxLength).trim()).filter(Boolean).slice(0, maxItems);
}

function normalizeEffectiveConfig(config, meta = {}) {
  const source = isPlainObject(config) ? config : {};
  const fallback = DEFAULT_KOL_MATCH_RUNTIME_CONFIG.defaults;
  const limits = source.limits || {};
  const aiResultLimit = clampInteger(limits.aiResultLimit, fallback.limits.aiResultLimit, 1, HARD_LIMITS.aiResultLimitMax);
  const aiRecallTopK = clampInteger(limits.aiRecallTopK, fallback.limits.aiRecallTopK, aiResultLimit, HARD_LIMITS.aiRecallTopKMax);
  const filterResultLimit = clampInteger(limits.filterResultLimit, fallback.limits.filterResultLimit, 1, HARD_LIMITS.filterResultLimitMax);
  const filterCandidateScanLimit = clampInteger(
    limits.filterCandidateScanLimit,
    fallback.limits.filterCandidateScanLimit,
    filterResultLimit,
    HARD_LIMITS.filterCandidateScanLimitMax
  );

  return {
    version: sanitizeString(source.version || meta.version || DEFAULT_KOL_MATCH_RUNTIME_CONFIG.version, 80),
    appEnv: meta.appEnv || "production",
    source: meta.source || "defaults",
    configSource: meta.source || "defaults",
    fallbackReason: meta.fallbackReason || "",
    contentSha256: meta.contentSha256 || "",
    limits: {
      aiDailyLimit: clampInteger(limits.aiDailyLimit, fallback.limits.aiDailyLimit, 1, HARD_LIMITS.quotaMax),
      filterDailyLimit: clampInteger(limits.filterDailyLimit, fallback.limits.filterDailyLimit, 1, HARD_LIMITS.quotaMax),
      aiResultLimit,
      aiRecallTopK,
      filterResultLimit,
      filterCandidateScanLimit,
    },
    strategyLlm: {
      enabled: source.strategyLlm?.enabled !== false,
      model: sanitizeString(source.strategyLlm?.model, 160),
      timeoutMs: clampInteger(source.strategyLlm?.timeoutMs, fallback.strategyLlm.timeoutMs, HARD_LIMITS.strategyTimeoutMin, HARD_LIMITS.strategyTimeoutMax),
      maxTokens: clampInteger(source.strategyLlm?.maxTokens, fallback.strategyLlm.maxTokens, 100, 12000),
      temperature: clampNumber(source.strategyLlm?.temperature, fallback.strategyLlm.temperature, 0, 2),
    },
    evaluatorLlm: {
      enabled: source.evaluatorLlm?.enabled !== false,
      model: sanitizeString(source.evaluatorLlm?.model, 160),
      timeoutMs: clampInteger(source.evaluatorLlm?.timeoutMs, fallback.evaluatorLlm.timeoutMs, HARD_LIMITS.evaluatorTimeoutMin, HARD_LIMITS.evaluatorTimeoutMax),
      batchSize: clampInteger(source.evaluatorLlm?.batchSize, fallback.evaluatorLlm.batchSize, 1, HARD_LIMITS.evaluatorBatchSizeMax),
      maxTokensBase: clampInteger(source.evaluatorLlm?.maxTokensBase, fallback.evaluatorLlm.maxTokensBase, 100, 12000),
      maxTokensPerCandidate: clampInteger(source.evaluatorLlm?.maxTokensPerCandidate, fallback.evaluatorLlm.maxTokensPerCandidate, 50, 2000),
      maxTokensCap: clampInteger(source.evaluatorLlm?.maxTokensCap, fallback.evaluatorLlm.maxTokensCap, 500, HARD_LIMITS.maxTokensCapMax),
      temperature: clampNumber(source.evaluatorLlm?.temperature, fallback.evaluatorLlm.temperature, 0, 2),
    },
    prompts: {
      strategy: {
        taskPrompt: sanitizeString(source.prompts?.strategy?.taskPrompt),
        systemPrompt: sanitizeString(source.prompts?.strategy?.systemPrompt),
        extraRules: sanitizeStringArray(source.prompts?.strategy?.extraRules),
      },
      candidateEvaluation: {
        taskPrompt: sanitizeString(source.prompts?.candidateEvaluation?.taskPrompt),
        systemPrompt: sanitizeString(source.prompts?.candidateEvaluation?.systemPrompt),
        authoritativeRules: sanitizeStringArray(source.prompts?.candidateEvaluation?.authoritativeRules),
        scoreCalibration: sanitizeStringArray(source.prompts?.candidateEvaluation?.scoreCalibration),
      },
    },
  };
}

function getKolMatchConfigSummary(config) {
  return {
    appEnv: config?.appEnv || "production",
    configVersion: config?.version || DEFAULT_KOL_MATCH_RUNTIME_CONFIG.version,
    configSource: config?.configSource || config?.source || "defaults",
    configFallbackReason: config?.fallbackReason || undefined,
    configContentSha256: config?.contentSha256 || undefined,
  };
}

function getEffectiveConfigFromDocument(document, appEnv, sourceMeta = {}) {
  const env = appEnv === "test" ? "test" : "production";
  const baseDoc = deepMerge(DEFAULT_KOL_MATCH_RUNTIME_CONFIG, document || {});
  const envNode = baseDoc.envs?.[env] || {};
  const merged = deepMerge(baseDoc.defaults || {}, envNode);
  if (envNode.version) merged.version = envNode.version;
  return normalizeEffectiveConfig(merged, {
    version: envNode.version || baseDoc.version || DEFAULT_KOL_MATCH_RUNTIME_CONFIG.version,
    appEnv: env,
    ...sourceMeta,
  });
}

async function getRedisConfigVersion(redisClient) {
  if (!redisClient || typeof redisClient.get !== "function") return "";
  try {
    return String((await redisClient.get(KOL_MATCH_REDIS_VERSION_KEY)) || "");
  } catch (error) {
    return "";
  }
}

async function loadConfigDocument({ force = false, redisClient } = {}) {
  const now = Date.now();
  const redisVersion = await getRedisConfigVersion(redisClient);
  const redisChanged = redisVersion && redisVersion !== configCache.redisVersion;
  if (!force && !redisChanged && configCache.document && now < configCache.expireAt) {
    return configCache;
  }

  const envOverride = buildEnvOverrideDocument();
  let document = envOverride
    ? deepMerge(DEFAULT_KOL_MATCH_RUNTIME_CONFIG, envOverride)
    : clone(DEFAULT_KOL_MATCH_RUNTIME_CONFIG);
  let source = envOverride ? "env" : "defaults";
  let fallbackReason = "";
  let contentSha256 = sha256(JSON.stringify(document));

  try {
    const content = await getNacosConfigContent({
      dataId: KOL_MATCH_CONFIG_DATA_ID,
      group: KOL_MATCH_CONFIG_GROUP,
      timeout: 5000,
    });
    const parsed = JSON.parse(content || "{}");
    if (!isPlainObject(parsed)) throw new Error("KOL Match Nacos config must be an object");
    document = deepMerge(document, parsed);
    source = "nacos";
    contentSha256 = sha256(content);
  } catch (error) {
    fallbackReason = error.message || "NACOS_CONFIG_LOAD_FAILED";
    if (source === "defaults") {
      console.warn("[EchoHunt KOL Match] runtime config fallback to defaults", { reason: fallbackReason });
    } else {
      console.warn("[EchoHunt KOL Match] runtime config fallback to env", { reason: fallbackReason });
    }
  }

  configCache = {
    loadedAt: now,
    expireAt: now + KOL_MATCH_CONFIG_TTL_MS,
    redisVersion,
    document,
    source,
    fallbackReason,
    contentSha256,
  };
  return configCache;
}

async function resolveKolMatchRuntimeConfigValue(appEnv = "production", options = {}) {
  const loaded = await loadConfigDocument(options);
  return getEffectiveConfigFromDocument(loaded.document, appEnv, {
    source: loaded.source,
    fallbackReason: loaded.fallbackReason,
    contentSha256: loaded.contentSha256,
  });
}

function resolveEchohuntAppEnv(req, res, next) {
  req.echohuntAppEnv = normalizeEchohuntAppEnv(req);
  return next();
}

async function resolveKolMatchRuntimeConfig(req, res, next) {
  try {
    const env = req.echohuntAppEnv?.value || normalizeEchohuntAppEnv(req).value;
    req.kolMatchConfig = await resolveKolMatchRuntimeConfigValue(env, { redisClient: req.redisClient });
    return next();
  } catch (error) {
    return next(error);
  }
}

function clearKolMatchRuntimeConfigCache() {
  configCache = {
    loadedAt: 0,
    expireAt: 0,
    redisVersion: "",
    document: null,
    source: "defaults",
    fallbackReason: "",
    contentSha256: "",
  };
}

function assertIntegerInRange(errors, path, value, min, max) {
  if (value === undefined) return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    errors.push(`${path} 必须是 ${min}-${max} 的整数`);
  }
}

function assertPromptObject(errors, prefix, prompts) {
  if (!prompts || typeof prompts !== "object") return;
  ["taskPrompt", "systemPrompt"].forEach((key) => {
    const value = prompts[key];
    if (value !== undefined && typeof value !== "string") errors.push(`${prefix}.${key} 必须是字符串`);
    if (typeof value === "string" && value.length > HARD_LIMITS.promptFieldMaxLength) {
      errors.push(`${prefix}.${key} 长度不能超过 ${HARD_LIMITS.promptFieldMaxLength}`);
    }
  });
  ["extraRules", "authoritativeRules", "scoreCalibration"].forEach((key) => {
    if (prompts[key] === undefined) return;
    if (!Array.isArray(prompts[key])) {
      errors.push(`${prefix}.${key} 必须是数组`);
      return;
    }
    if (prompts[key].length > HARD_LIMITS.promptArrayMaxItems) {
      errors.push(`${prefix}.${key} 数量不能超过 ${HARD_LIMITS.promptArrayMaxItems}`);
    }
    prompts[key].forEach((item, index) => {
      if (typeof item !== "string") errors.push(`${prefix}.${key}[${index}] 必须是字符串`);
      if (typeof item === "string" && item.length > HARD_LIMITS.promptFieldMaxLength) {
        errors.push(`${prefix}.${key}[${index}] 长度不能超过 ${HARD_LIMITS.promptFieldMaxLength}`);
      }
    });
  });
}

function validateEffectiveConfigNode(errors, prefix, node = {}) {
  const limits = node.limits || {};
  assertIntegerInRange(errors, `${prefix}.limits.aiDailyLimit`, limits.aiDailyLimit, 1, HARD_LIMITS.quotaMax);
  assertIntegerInRange(errors, `${prefix}.limits.filterDailyLimit`, limits.filterDailyLimit, 1, HARD_LIMITS.quotaMax);
  assertIntegerInRange(errors, `${prefix}.limits.aiResultLimit`, limits.aiResultLimit, 1, HARD_LIMITS.aiResultLimitMax);
  assertIntegerInRange(errors, `${prefix}.limits.aiRecallTopK`, limits.aiRecallTopK, 1, HARD_LIMITS.aiRecallTopKMax);
  if (limits.aiResultLimit !== undefined && limits.aiRecallTopK !== undefined && Number(limits.aiRecallTopK) < Number(limits.aiResultLimit)) {
    errors.push(`${prefix}.limits.aiRecallTopK 必须大于等于 aiResultLimit`);
  }
  assertIntegerInRange(errors, `${prefix}.limits.filterResultLimit`, limits.filterResultLimit, 1, HARD_LIMITS.filterResultLimitMax);
  assertIntegerInRange(errors, `${prefix}.limits.filterCandidateScanLimit`, limits.filterCandidateScanLimit, 1, HARD_LIMITS.filterCandidateScanLimitMax);
  if (limits.filterResultLimit !== undefined && limits.filterCandidateScanLimit !== undefined && Number(limits.filterCandidateScanLimit) < Number(limits.filterResultLimit)) {
    errors.push(`${prefix}.limits.filterCandidateScanLimit 必须大于等于 filterResultLimit`);
  }

  const strategy = node.strategyLlm || {};
  if (strategy.enabled !== undefined && typeof strategy.enabled !== "boolean") errors.push(`${prefix}.strategyLlm.enabled 必须是布尔值`);
  assertIntegerInRange(errors, `${prefix}.strategyLlm.timeoutMs`, strategy.timeoutMs, HARD_LIMITS.strategyTimeoutMin, HARD_LIMITS.strategyTimeoutMax);
  assertIntegerInRange(errors, `${prefix}.strategyLlm.maxTokens`, strategy.maxTokens, 100, 12000);

  const evaluator = node.evaluatorLlm || {};
  if (evaluator.enabled !== undefined && typeof evaluator.enabled !== "boolean") errors.push(`${prefix}.evaluatorLlm.enabled 必须是布尔值`);
  assertIntegerInRange(errors, `${prefix}.evaluatorLlm.timeoutMs`, evaluator.timeoutMs, HARD_LIMITS.evaluatorTimeoutMin, HARD_LIMITS.evaluatorTimeoutMax);
  assertIntegerInRange(errors, `${prefix}.evaluatorLlm.batchSize`, evaluator.batchSize, 1, HARD_LIMITS.evaluatorBatchSizeMax);
  assertIntegerInRange(errors, `${prefix}.evaluatorLlm.maxTokensCap`, evaluator.maxTokensCap, 500, HARD_LIMITS.maxTokensCapMax);

  assertPromptObject(errors, `${prefix}.prompts.strategy`, node.prompts?.strategy);
  assertPromptObject(errors, `${prefix}.prompts.candidateEvaluation`, node.prompts?.candidateEvaluation);
}

function validateKolMatchRuntimeConfigDocument(document, options = {}) {
  const config = typeof document === "string" ? JSON.parse(document || "{}") : document;
  const errors = [];
  if (!isPlainObject(config)) errors.push("配置必须是 JSON 对象");
  if (!config.version || typeof config.version !== "string" || config.version.length > 80) {
    errors.push("version 必须存在且长度 <= 80");
  }
  validateEffectiveConfigNode(errors, "defaults", config.defaults || {});
  ["production", "test"].forEach((env) => {
    validateEffectiveConfigNode(errors, `envs.${env}`, config.envs?.[env] || {});
  });

  const effectiveProduction = getEffectiveConfigFromDocument(config, "production", { source: "validate" });
  if (effectiveProduction.limits.aiRecallTopK > HARD_LIMITS.aiRecallTopKMax) errors.push("production.aiRecallTopK 超过后端硬上限");
  if (effectiveProduction.limits.aiResultLimit > HARD_LIMITS.aiResultLimitMax) errors.push("production.aiResultLimit 超过后端硬上限");
  if (options.requireProductionReason) {
    const reason = String(options.reason || "").trim();
    if (!reason) errors.push("修改 production 配置必须填写 reason");
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedDocument: deepMerge(DEFAULT_KOL_MATCH_RUNTIME_CONFIG, config || {}),
    effective: {
      production: effectiveProduction,
      test: getEffectiveConfigFromDocument(config, "test", { source: "validate" }),
    },
  };
}

async function publishRedisConfigVersion(redisClient, version) {
  if (!redisClient || typeof redisClient.set !== "function") return false;
  await redisClient.set(KOL_MATCH_REDIS_VERSION_KEY, String(version || Date.now()));
  return true;
}

module.exports = {
  KOL_MATCH_CONFIG_DATA_ID,
  KOL_MATCH_CONFIG_GROUP,
  KOL_MATCH_REDIS_VERSION_KEY,
  DEFAULT_KOL_MATCH_RUNTIME_CONFIG,
  HARD_LIMITS,
  clearKolMatchRuntimeConfigCache,
  deepMerge,
  getEffectiveConfigFromDocument,
  getKolMatchConfigSummary,
  loadConfigDocument,
  normalizeEchohuntAppEnv,
  publishRedisConfigVersion,
  resolveEchohuntAppEnv,
  resolveKolMatchRuntimeConfig,
  resolveKolMatchRuntimeConfigValue,
  sha256,
  validateKolMatchRuntimeConfigDocument,
};
