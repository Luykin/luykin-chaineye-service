const { getNacosConfigContent } = require("../../services/nacosConfigClient");

const SOCIAL_LISTENING_CONFIG_DATA_ID = "echohunt_social_listening_config";
const SOCIAL_LISTENING_CONFIG_GROUP = "DEFAULT_GROUP";
const CONFIG_CACHE_TTL_MS = 60 * 1000;

const DEFAULT_SOCIAL_LISTENING_RUNTIME_CONFIG = Object.freeze({
  version: "2026-09-01",
  scan: {
    statementTimeoutMs: 30000,
    windowMinutes: 30,
    historyDays: 30,
    recentDays: 7,
    incrementalOverlapHours: 2,
    pageSize: 200,
    maxPages: 3,
    matchLimit: 500,
    officialPostScanLimit: 1000,
    followLatestMin: 150,
  },
  ai: {
    apiKey: "",
    baseURL: "https://aaii.xclaw.info/v1/",
    model: "gemini-3.1-flash-lite-preview",
    temperature: 0,
    maxTokens: 1200,
    tweetAnalysisModel: "",
    systemPrompt: "",
    timeoutMs: 120000,
    maxRetries: 2,
    summaryWords: 5,
    promptMaxLength: 6000,
    contentEnabled: false,
    projectAttitudeEnabled: false,
    contentBatchSize: 10,
    projectAttitudeBatchSize: 20,
    contentConcurrency: 4,
    projectAttitudeConcurrency: 8,
    maxTextLength: 1200,
    negativeScoreThreshold: 4,
    positiveScoreThreshold: 6,
    estimateInputPricePerMillion: 0.25,
    estimateOutputPricePerMillion: 1.5,
    // 标签、摘要和项目态度共用一次综合分析请求，按 LiteLLM
    // gemini-3.1-flash-lite 的实测请求（1,594 input / 246 output）估算。
    estimateCombinedInputTokens: 1594,
    estimateCombinedOutputTokens: 246,
    tweetAnalysisMaxTokens: 1200,
    prompts: {},
  },
  scheduler: {
    mode: "default",
    tickIntervalMs: 60000,
    maxJobsPerTick: 3,
    staleRunningMinutes: 15,
    incrementalIntervalMinutes: 15,
  },
  metricRefresh: {
    mode: "enabled",
    tickIntervalMinutes: 20,
    batchSize: 1000,
    maxBatchesPerTick: 1,
    recentHours: 12,
    recentIntervalMinutes: 20,
    dayIntervalMinutes: 60,
    weekIntervalMinutes: 300,
    monthIntervalMinutes: 1080,
  },
  aiWorker: {
    mode: "enabled",
    tickIntervalMs: 60000,
    maxBoardsPerTick: 3,
    contentBatchSize: 80,
    projectAttitudeBatchSize: 160,
    contentConcurrency: 4,
    projectAttitudeConcurrency: 8,
    maxTextLength: 1200,
  },
  alert: {
    baselineDays: 7,
    volumeSpikeMinPosts: 5,
    volumeSpikeMultiplier: 2,
    negativeSpikeMinAnalyzed: 20,
    negativeShareSpikeDelta: 0.2,
    negativeContentMinPosts: 1,
    negativeContentMinAuthors: 1,
    concentratedNegativeMinPosts: 3,
    concentratedNegativeMinAuthors: 2,
    concentratedNegativeMinViews: 0,
  },
  refresh: {
    adminCooldownSeconds: 60,
    userCooldownSeconds: 300,
    adminBoardCooldownSeconds: 60,
    userBoardCooldownSeconds: 120,
  },
  export: {
    maxRows: 10000,
    adminCooldownSeconds: 300,
    userCooldownSeconds: 600,
  },
});

let configCache = {
  loadedAt: 0,
  expireAt: 0,
  config: null,
  source: "defaults",
  error: null,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function getPath(obj, path) {
  return String(path || "").split(".").reduce((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return current[key];
  }, obj);
}

function getValue(document, path, fallback) {
  const nested = getPath(document, path);
  if (nested !== undefined && nested !== null && nested !== "") return nested;
  return fallback;
}

function toNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const clampedMin = min === undefined ? num : Math.max(num, min);
  const clamped = max === undefined ? clampedMin : Math.min(clampedMin, max);
  return clamped;
}

function toInteger(value, fallback, min, max) {
  return Math.floor(toNumber(value, fallback, min, max));
}

function toBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(text)) return true;
  if (["false", "0", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function toText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizePromptMap(value, fallback = {}) {
  const source = isPlainObject(value) ? value : {};
  const base = isPlainObject(fallback) ? fallback : {};
  const tweetAnalysis = toText(source.tweetAnalysis || source.tweetAnalysisPrompt, base.tweetAnalysis || "");
  return tweetAnalysis ? { tweetAnalysis: tweetAnalysis.slice(0, 30000) } : {};
}

function normalizeConfig(document = {}) {
  const merged = deepMerge(DEFAULT_SOCIAL_LISTENING_RUNTIME_CONFIG, document);
  return {
    version: toText(merged.version, DEFAULT_SOCIAL_LISTENING_RUNTIME_CONFIG.version),
    scan: {
      statementTimeoutMs: toInteger(getValue(merged, "scan.statementTimeoutMs", merged.scan.statementTimeoutMs), 30000, 1000, 120000),
      windowMinutes: toInteger(getValue(merged, "scan.windowMinutes", merged.scan.windowMinutes), 30, 5, 240),
      historyDays: toInteger(getValue(merged, "scan.historyDays", merged.scan.historyDays), 30, 1, 90),
      recentDays: toInteger(getValue(merged, "scan.recentDays", merged.scan.recentDays), 7, 1, 30),
      incrementalOverlapHours: toInteger(getValue(merged, "scan.incrementalOverlapHours", merged.scan.incrementalOverlapHours), 2, 1, 24),
      pageSize: toInteger(getValue(merged, "scan.pageSize", merged.scan.pageSize), 200, 50, 1000),
      maxPages: toInteger(getValue(merged, "scan.maxPages", merged.scan.maxPages), 3, 1, 20),
      matchLimit: toInteger(getValue(merged, "scan.matchLimit", merged.scan.matchLimit), 500, 1, 2000),
      officialPostScanLimit: toInteger(getValue(merged, "scan.officialPostScanLimit", merged.scan.officialPostScanLimit), 1000, 50, 5000),
      followLatestMin: toInteger(getValue(merged, "scan.followLatestMin", merged.scan.followLatestMin), 150, 1, 200),
    },
    ai: {
      apiKey: toText(getValue(merged, "ai.apiKey", merged.ai.apiKey)),
      baseURL: toText(getValue(merged, "ai.baseURL", merged.ai.baseURL), DEFAULT_SOCIAL_LISTENING_RUNTIME_CONFIG.ai.baseURL),
      model: toText(getValue(merged, "ai.model", merged.ai.model), DEFAULT_SOCIAL_LISTENING_RUNTIME_CONFIG.ai.model),
      temperature: toNumber(getValue(merged, "ai.temperature", merged.ai.temperature), 0, 0, 2),
      maxTokens: toInteger(getValue(merged, "ai.maxTokens", merged.ai.maxTokens), 1200, 128, 8000),
      tweetAnalysisModel: toText(getValue(merged, "ai.tweetAnalysisModel", merged.ai.tweetAnalysisModel)),
      systemPrompt: toText(getValue(merged, "ai.systemPrompt", merged.ai.systemPrompt)),
      timeoutMs: toInteger(getValue(merged, "ai.timeoutMs", merged.ai.timeoutMs), 120000, 1000, 300000),
      maxRetries: toInteger(getValue(merged, "ai.maxRetries", merged.ai.maxRetries), 2, 0, 5),
      summaryWords: toInteger(getValue(merged, "ai.summaryWords", merged.ai.summaryWords), 5, 3, 80),
      promptMaxLength: toInteger(getValue(merged, "ai.promptMaxLength", merged.ai.promptMaxLength), 6000, 200, 30000),
      contentEnabled: toBoolean(getValue(merged, "ai.contentEnabled", merged.ai.contentEnabled), false),
      projectAttitudeEnabled: toBoolean(getValue(merged, "ai.projectAttitudeEnabled", merged.ai.projectAttitudeEnabled), false),
      contentBatchSize: toInteger(getValue(merged, "ai.contentBatchSize", merged.ai.contentBatchSize), 10, 1, 500),
      projectAttitudeBatchSize: toInteger(getValue(merged, "ai.projectAttitudeBatchSize", merged.ai.projectAttitudeBatchSize), 20, 1, 1000),
      contentConcurrency: toInteger(getValue(merged, "ai.contentConcurrency", merged.ai.contentConcurrency), 4, 1, 20),
      projectAttitudeConcurrency: toInteger(getValue(merged, "ai.projectAttitudeConcurrency", merged.ai.projectAttitudeConcurrency), 8, 1, 20),
      maxTextLength: toInteger(getValue(merged, "ai.maxTextLength", merged.ai.maxTextLength), 1200, 200, 5000),
      negativeScoreThreshold: toNumber(getValue(merged, "ai.negativeScoreThreshold", merged.ai.negativeScoreThreshold), 4, 0, 10),
      positiveScoreThreshold: toNumber(getValue(merged, "ai.positiveScoreThreshold", merged.ai.positiveScoreThreshold), 6, 0, 10),
      estimateInputPricePerMillion: toNumber(getValue(merged, "ai.estimateInputPricePerMillion", merged.ai.estimateInputPricePerMillion), 0.25, 0, 1000),
      estimateOutputPricePerMillion: toNumber(getValue(merged, "ai.estimateOutputPricePerMillion", merged.ai.estimateOutputPricePerMillion), 1.5, 0, 1000),
      estimateCombinedInputTokens: toInteger(getValue(merged, "ai.estimateCombinedInputTokens", merged.ai.estimateCombinedInputTokens), 1594, 1, 100000),
      estimateCombinedOutputTokens: toInteger(getValue(merged, "ai.estimateCombinedOutputTokens", merged.ai.estimateCombinedOutputTokens), 246, 1, 100000),
      tweetAnalysisMaxTokens: toInteger(getValue(merged, "ai.tweetAnalysisMaxTokens", merged.ai.tweetAnalysisMaxTokens), 1200, 128, 8000),
      prompts: normalizePromptMap(merged.ai?.prompts),
    },
    scheduler: {
      mode: ["default", "enabled", "disabled"].includes(String(merged.scheduler?.mode || "").toLowerCase()) ? String(merged.scheduler.mode).toLowerCase() : "default",
      tickIntervalMs: toInteger(getValue(merged, "scheduler.tickIntervalMs", merged.scheduler.tickIntervalMs), 60000, 10000, 300000),
      maxJobsPerTick: toInteger(getValue(merged, "scheduler.maxJobsPerTick", merged.scheduler.maxJobsPerTick), 3, 1, 10),
      staleRunningMinutes: toInteger(getValue(merged, "scheduler.staleRunningMinutes", merged.scheduler.staleRunningMinutes), 15, 10, 15),
      incrementalIntervalMinutes: toInteger(getValue(merged, "scheduler.incrementalIntervalMinutes", merged.scheduler.incrementalIntervalMinutes), 15, 1, 240),
    },
    metricRefresh: {
      mode: ["enabled", "disabled"].includes(String(merged.metricRefresh?.mode || "").toLowerCase()) ? String(merged.metricRefresh.mode).toLowerCase() : "enabled",
      tickIntervalMinutes: toInteger(getValue(merged, "metricRefresh.tickIntervalMinutes", merged.metricRefresh?.tickIntervalMinutes), 20, 5, 240),
      batchSize: toInteger(getValue(merged, "metricRefresh.batchSize", merged.metricRefresh?.batchSize), 1000, 100, 2000),
      maxBatchesPerTick: toInteger(getValue(merged, "metricRefresh.maxBatchesPerTick", merged.metricRefresh?.maxBatchesPerTick), 1, 1, 5),
      recentHours: toInteger(getValue(merged, "metricRefresh.recentHours", merged.metricRefresh?.recentHours), 12, 1, 48),
      recentIntervalMinutes: toInteger(getValue(merged, "metricRefresh.recentIntervalMinutes", merged.metricRefresh?.recentIntervalMinutes), 20, 5, 240),
      dayIntervalMinutes: toInteger(getValue(merged, "metricRefresh.dayIntervalMinutes", merged.metricRefresh?.dayIntervalMinutes), 60, 10, 1440),
      weekIntervalMinutes: toInteger(getValue(merged, "metricRefresh.weekIntervalMinutes", merged.metricRefresh?.weekIntervalMinutes), 300, 30, 4320),
      monthIntervalMinutes: toInteger(getValue(merged, "metricRefresh.monthIntervalMinutes", merged.metricRefresh?.monthIntervalMinutes), 1080, 60, 10080),
    },
    aiWorker: {
      mode: ["enabled", "disabled"].includes(String(merged.aiWorker?.mode || "").toLowerCase()) ? String(merged.aiWorker.mode).toLowerCase() : "enabled",
      tickIntervalMs: toInteger(getValue(merged, "aiWorker.tickIntervalMs", merged.aiWorker?.tickIntervalMs), 60000, 10000, 300000),
      maxBoardsPerTick: toInteger(getValue(merged, "aiWorker.maxBoardsPerTick", merged.aiWorker?.maxBoardsPerTick), 3, 1, 20),
      contentBatchSize: toInteger(getValue(merged, "aiWorker.contentBatchSize", merged.aiWorker?.contentBatchSize), toInteger(getValue(merged, "ai.contentBatchSize", merged.ai?.contentBatchSize), 80, 1, 500), 1, 500),
      projectAttitudeBatchSize: toInteger(getValue(merged, "aiWorker.projectAttitudeBatchSize", merged.aiWorker?.projectAttitudeBatchSize), toInteger(getValue(merged, "ai.projectAttitudeBatchSize", merged.ai?.projectAttitudeBatchSize), 160, 1, 1000), 1, 1000),
      contentConcurrency: toInteger(getValue(merged, "aiWorker.contentConcurrency", merged.aiWorker?.contentConcurrency), toInteger(getValue(merged, "ai.contentConcurrency", merged.ai?.contentConcurrency), 4, 1, 20), 1, 20),
      projectAttitudeConcurrency: toInteger(getValue(merged, "aiWorker.projectAttitudeConcurrency", merged.aiWorker?.projectAttitudeConcurrency), toInteger(getValue(merged, "ai.projectAttitudeConcurrency", merged.ai?.projectAttitudeConcurrency), 8, 1, 20), 1, 20),
      maxTextLength: toInteger(getValue(merged, "aiWorker.maxTextLength", merged.aiWorker?.maxTextLength), toInteger(getValue(merged, "ai.maxTextLength", merged.ai?.maxTextLength), 1200, 200, 5000), 200, 5000),
    },
    alert: {
      baselineDays: toInteger(getValue(merged, "alert.baselineDays", merged.alert.baselineDays), 7, 1, 30),
      volumeSpikeMinPosts: toInteger(getValue(merged, "alert.volumeSpikeMinPosts", merged.alert.volumeSpikeMinPosts), 5, 1, 1000),
      volumeSpikeMultiplier: toNumber(getValue(merged, "alert.volumeSpikeMultiplier", merged.alert.volumeSpikeMultiplier), 2, 1, 100),
      negativeSpikeMinAnalyzed: toInteger(getValue(merged, "alert.negativeSpikeMinAnalyzed", merged.alert.negativeSpikeMinAnalyzed), 20, 1, 1000),
      negativeShareSpikeDelta: toNumber(getValue(merged, "alert.negativeShareSpikeDelta", merged.alert.negativeShareSpikeDelta), 0.2, 0, 1),
      negativeContentMinPosts: toInteger(getValue(merged, "alert.negativeContentMinPosts", merged.alert.negativeContentMinPosts), 1, 1, 1000),
      negativeContentMinAuthors: toInteger(getValue(merged, "alert.negativeContentMinAuthors", merged.alert.negativeContentMinAuthors), 1, 1, 1000),
      concentratedNegativeMinPosts: toInteger(getValue(merged, "alert.concentratedNegativeMinPosts", merged.alert.concentratedNegativeMinPosts), 3, 1, 1000),
      concentratedNegativeMinAuthors: toInteger(getValue(merged, "alert.concentratedNegativeMinAuthors", merged.alert.concentratedNegativeMinAuthors), 2, 1, 1000),
      concentratedNegativeMinViews: toInteger(getValue(merged, "alert.concentratedNegativeMinViews", merged.alert.concentratedNegativeMinViews), 0, 0, 1000000000),
    },
    refresh: {
      adminCooldownSeconds: toInteger(merged.refresh?.adminCooldownSeconds, 60, 0, 3600),
      userCooldownSeconds: toInteger(merged.refresh?.userCooldownSeconds, 300, 0, 3600),
      adminBoardCooldownSeconds: toInteger(merged.refresh?.adminBoardCooldownSeconds, 60, 0, 3600),
      userBoardCooldownSeconds: toInteger(merged.refresh?.userBoardCooldownSeconds, 120, 0, 3600),
    },
    export: {
      maxRows: toInteger(merged.export?.maxRows, 10000, 1, 50000),
      adminCooldownSeconds: toInteger(merged.export?.adminCooldownSeconds, 300, 0, 3600),
      userCooldownSeconds: toInteger(merged.export?.userCooldownSeconds, 600, 0, 7200),
    },
  };
}

function parseConfigContent(content) {
  if (!content) return {};
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  if (!isPlainObject(parsed)) throw new Error("Social Listening Nacos 配置必须是 JSON 对象");
  return parsed;
}

async function loadConfigFromNacos() {
  const content = await getNacosConfigContent({
    dataId: SOCIAL_LISTENING_CONFIG_DATA_ID,
    group: SOCIAL_LISTENING_CONFIG_GROUP,
    timeout: 5000,
  });
  return normalizeConfig(parseConfigContent(content));
}

async function getSocialListeningRuntimeConfig(options = {}) {
  const now = Date.now();
  if (!options.force && configCache.config && now < configCache.expireAt) {
    return configCache.config;
  }

  try {
    const config = await loadConfigFromNacos();
    configCache = { loadedAt: now, expireAt: now + CONFIG_CACHE_TTL_MS, config, source: "nacos", error: null };
    return config;
  } catch (error) {
    const config = normalizeConfig(DEFAULT_SOCIAL_LISTENING_RUNTIME_CONFIG);
    configCache = {
      loadedAt: now,
      expireAt: now + CONFIG_CACHE_TTL_MS,
      config,
      source: "defaults",
      error: String(error.message || error),
    };
    console.warn("[SocialListeningConfig] 使用默认配置，Nacos 读取失败:", error.message || error);
    return config;
  }
}

function clearSocialListeningRuntimeConfigCache() {
  configCache = { loadedAt: 0, expireAt: 0, config: null, source: "defaults", error: null };
}

function getSocialListeningRuntimeConfigCacheInfo() {
  return { ...configCache, config: configCache.config ? clone(configCache.config) : null };
}

module.exports = {
  SOCIAL_LISTENING_CONFIG_DATA_ID,
  SOCIAL_LISTENING_CONFIG_GROUP,
  DEFAULT_SOCIAL_LISTENING_RUNTIME_CONFIG,
  normalizeConfig,
  getSocialListeningRuntimeConfig,
  clearSocialListeningRuntimeConfigCache,
  getSocialListeningRuntimeConfigCacheInfo,
};
