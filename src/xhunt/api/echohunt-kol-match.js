/**
 * EchoHunt KOL Match 产品 API
 *
 * 对外挂载：/api/xhunt/echohunt/kol-match/*
 * - 使用 Auth Center Bearer token 鉴权；
 * - 复用 KOL Marketing pgvector 搜索链路；
 * - EchoHunt 独立 quota，成功才扣；
 * - SSE 返回真实执行阶段进度和经过过滤的公开推理摘要。
 */

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const axios = require("axios");
const { QueryTypes } = require("sequelize");
const {
  getPostgresReadOnlyInstance,
  getPostgresReadOnlyStatus,
  isPostgresReadOnlyConfigured,
} = require("../../infra/k8s/postgres-readonly");
const { structuredChat } = require("../../lib/llm");
const { authenticateAuthCenterToken } = require("../auth-center/middleware/auth");
const { isRequestXHuntVip } = require("../constants/xhuntVip");
const {
  resolveEchohuntAppEnv,
  resolveKolMatchRuntimeConfig,
} = require("./echohunt-kol-match/config");
const {
  AI_EVALUATOR_SCHEMA,
  STRATEGY_SCHEMA,
} = require("./echohunt-kol-match/schemas");
const {
  buildCandidateEvaluationPrompt,
  buildCandidateEvaluationSystemPrompt,
  buildStrategyPrompt,
  buildStrategySystemPrompt,
} = require("./echohunt-kol-match/prompts");
const {
  AI_QUOTA_BUCKET,
  AI_SCORE_WEIGHTS,
  AI_STRATEGY_SEMANTIC_ONLY_FILTER_KEYS,
  BRIEF_VOCABULARY,
  CAPABILITY_ALIASES,
  DANGEROUS_INPUT_PATTERNS,
  FILTER_QUOTA_BUCKET,
  GOAL_EN_SIGNALS,
  IDEMPOTENCY_CACHE_PREFIX,
  INTERNAL_TWITTER_USER_LOOKUP_TIMEOUT_MS,
  INTERNAL_TWITTER_USER_LOOKUP_URL,
  QUOTA_TIMEZONE,
  SENSITIVE_OUTPUT_PATTERNS,
  STRATEGY_CACHE_PREFIX,
  STRATEGY_TTL_SECONDS,
  TOPIC_EN_SIGNALS,
} = require("./echohunt-kol-match/constants");
const {
  genericPublicProgress,
  isEnglishUi,
  localizeProgressSources,
  normalizeUiLang,
  sanitizePublicText,
  searchProgressMessage,
  searchProgressTitle,
  uiText,
} = require("./echohunt-kol-match/i18n");
const {
  isConfigError,
  normalizeKolMatchError,
  publicError,
  sendError,
} = require("./echohunt-kol-match/errors");
const {
  getAuthCenterUserId,
  getRequestId,
} = require("./echohunt-kol-match/request-context");
const {
  writeSse,
  writeSseHeartbeat,
} = require("./echohunt-kol-match/sse-writer");
const {
  getAiDailyLimit,
  getAiRecallTopK,
  getAiResultLimit,
  getEvaluatorLlmBatchSize,
  getEvaluatorLlmMaxTokens,
  getEvaluatorLlmModel,
  getEvaluatorLlmTemperature,
  getEvaluatorLlmTimeoutMs,
  getFilterCandidateScanLimit,
  getFilterDailyLimit,
  getFilterResultLimit,
  getKolMatchRuntimeMeta,
  getResolvedKolMatchConfig,
  getStrategyLlmMaxTokens,
  getStrategyLlmModel,
  getStrategyLlmTemperature,
  getStrategyLlmTimeoutMs,
  isEvaluatorLlmEnabled,
  isStrategyLlmEnabled,
} = require("./echohunt-kol-match/runtime");
const {
  clampInteger,
  isSafeHttpUrl,
  normalizeDomain,
  normalizeHandle,
  normalizeMarket,
  normalizeString,
  normalizeTwitterUserId,
  numeric,
  safeArray,
  shorten,
  toIso,
} = require("./echohunt-kol-match/utils");
const {
  createRequestEnvDispatcher,
} = require("../utils/env-handler-dispatch");
const {
  getKolMarketingEmbeddingModel,
  getKolMarketingPersonProfileFilterSql,
  normalizeFilters,
  searchKolMarketingProfiles,
} = require("./kol-marketing/search-service");

const router = express.Router();
const dispatchByEchohuntEnv = createRequestEnvDispatcher({
  handlersDir: path.join(__dirname, "echohunt-kol-match", "handlers"),
  getEnv: (req) => req.echohuntAppEnv?.value || "production",
  metaKeyPrefix: "echohunt",
  targetEnv: "test",
  productionEnv: "production",
});

function logKolMatchError(label, req, error, extra = {}) {
  const status = error?.status || (error?.code === "PG_READ_NOT_CONFIGURED" ? 503 : 500);
  const parent = error?.parent || error?.original || {};
  console.warn(label, {
    requestId: getRequestId(req),
    authCenterUserId: getAuthCenterUserId(req),
    status,
    code: error?.code || error?.message,
    message: error?.message,
    parentCode: parent.code,
    parentMessage: parent.message,
    ...extra,
  });
}

function getPgServiceConfigError() {
  if (!isPostgresReadOnlyConfigured()) return "PG read-only connection is not configured";
  const status = getPostgresReadOnlyStatus();
  if (!status.ready) {
    return status.error ? `PG read-only connection is not ready: ${status.error}` : "PG read-only connection is not ready";
  }
  return "";
}

function getAiServiceConfigError() {
  const pgError = getPgServiceConfigError();
  if (pgError) return pgError;
  if (!getKolMarketingEmbeddingModel()) return "KOL marketing embedding model is not configured";
  return "";
}

function getBeijingDateContext() {
  const now = new Date();
  const beijingTime = new Date(now.toLocaleString("en-US", { timeZone: QUOTA_TIMEZONE }));
  const today = beijingTime.toISOString().split("T")[0];
  const tomorrow = new Date(beijingTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return {
    today,
    resetTime: tomorrow.getTime(),
    ttlSeconds: Math.max(1, Math.ceil((tomorrow - beijingTime) / 1000)),
  };
}

function requireRedis(req) {
  const redis = req.redisClient;
  if (!redis || typeof redis.get !== "function" || typeof redis.incr !== "function") {
    throw publicError("KOL_MATCH_QUOTA_UNAVAILABLE", 503, "额度服务暂不可用，请稍后重试。", {
      quotaCharged: false,
    });
  }
  return redis;
}

function getQuotaBucketConfig(bucket, reqOrConfig) {
  if (bucket === AI_QUOTA_BUCKET) {
    return { key: "ai", label: AI_QUOTA_BUCKET, limit: getAiDailyLimit(reqOrConfig) };
  }
  return { key: "filter", label: FILTER_QUOTA_BUCKET, limit: getFilterDailyLimit(reqOrConfig) };
}

function getQuotaRedisKey(userId, bucket, date) {
  const config = getQuotaBucketConfig(bucket);
  return `echohunt:kol-match:quota:${userId}:${config.key}:${date}`;
}

async function getQuotaItem(redis, userId, bucket, dateContext, reqOrConfig) {
  const config = getQuotaBucketConfig(bucket, reqOrConfig);
  const key = getQuotaRedisKey(userId, bucket, dateContext.today);
  const used = Math.max(0, parseInt((await redis.get(key)) || "0", 10) || 0);
  return {
    limit: config.limit,
    used,
    remaining: Math.max(0, config.limit - used),
    resetTime: dateContext.resetTime,
  };
}

async function getQuotaSnapshot(req) {
  const redis = requireRedis(req);
  const userId = getAuthCenterUserId(req);
  const dateContext = getBeijingDateContext();
  const [aiMatch, filterSearch] = await Promise.all([
    getQuotaItem(redis, userId, AI_QUOTA_BUCKET, dateContext, req),
    getQuotaItem(redis, userId, FILTER_QUOTA_BUCKET, dateContext, req),
  ]);

  return {
    date: dateContext.today,
    timezone: QUOTA_TIMEZONE,
    aiMatch,
    filterSearch,
    resultLimits: {
      aiMatch: getAiResultLimit(req),
      aiRecallTopK: getAiRecallTopK(req),
      filterSearch: getFilterResultLimit(req),
    },
    ...getKolMatchRuntimeMeta(req),
  };
}

async function ensureQuotaAvailable(req, bucket) {
  const snapshot = await getQuotaSnapshot(req);
  const quota = snapshot[bucket];
  if (!quota || quota.remaining <= 0) {
    throw publicError("KOL_MATCH_QUOTA_EXHAUSTED", 429, "今日次数已用完，请明天再试。", {
      quota: { bucket, ...(quota || {}) },
    });
  }
  return quota;
}

async function consumeQuota(req, bucket) {
  const redis = requireRedis(req);
  const userId = getAuthCenterUserId(req);
  const dateContext = getBeijingDateContext();
  const config = getQuotaBucketConfig(bucket, req);
  const key = getQuotaRedisKey(userId, bucket, dateContext.today);
  const newCount = await redis.incr(key);
  if (newCount === 1 && typeof redis.expire === "function") {
    await redis.expire(key, dateContext.ttlSeconds);
  }

  if (newCount > config.limit) {
    if (typeof redis.decr === "function") {
      await redis.decr(key).catch(() => {});
    }
    throw publicError("KOL_MATCH_QUOTA_EXHAUSTED", 429, "今日次数已用完，请明天再试。", {
      quota: {
        bucket,
        limit: config.limit,
        used: Math.max(0, newCount - 1),
        remaining: 0,
        resetTime: dateContext.resetTime,
      },
    });
  }

  return {
    bucket,
    limit: config.limit,
    used: newCount,
    remaining: Math.max(0, config.limit - newCount),
    resetTime: dateContext.resetTime,
    charged: true,
  };
}

function buildNoChargeQuota(bucket, quota, reqOrConfig) {
  const config = getQuotaBucketConfig(bucket, reqOrConfig);
  return {
    bucket,
    limit: numeric(quota?.limit) ?? config.limit,
    used: Math.max(0, numeric(quota?.used) ?? 0),
    remaining: Math.max(0, numeric(quota?.remaining) ?? config.limit),
    resetTime: quota?.resetTime,
    charged: false,
  };
}

function normalizeIdempotencyKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 128) return "";
  return /^[a-zA-Z0-9._:-]+$/.test(normalized) ? normalized : "";
}

function getIdempotencyRedisKey(userId, bucket, key, reqOrConfig) {
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const meta = getKolMatchRuntimeMeta(reqOrConfig);
  const appEnv = String(meta.appEnv || "production").replace(/[^a-zA-Z0-9_-]/g, "");
  const routeVariant = String(meta.routeVariant || "default").replace(/[^a-zA-Z0-9:_-]/g, "");
  const configVersion = crypto.createHash("sha256").update(String(meta.configVersion || "defaults")).digest("hex").slice(0, 16);
  return `${IDEMPOTENCY_CACHE_PREFIX}:${userId}:${bucket}:${appEnv}:${routeVariant}:${configVersion}:${hash}`;
}

async function readIdempotentResult(req, bucket, idempotencyKey) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  if (!key) return null;
  const redis = requireRedis(req);
  const cacheKey = getIdempotencyRedisKey(getAuthCenterUserId(req), bucket, key, req);
  const cached = await redis.get(cacheKey).catch(() => null);
  if (!cached) return null;
  try {
    const data = JSON.parse(cached);
    const meta = getKolMatchRuntimeMeta(req);
    if (data?.meta?.appEnv && data.meta.appEnv !== meta.appEnv) return null;
    if (data?.meta?.routeVariant && data.meta.routeVariant !== meta.routeVariant) return null;
    if (data?.meta?.configVersion && data.meta.configVersion !== meta.configVersion) return null;
    return data;
  } catch {
    return null;
  }
}

async function writeIdempotentResult(req, bucket, idempotencyKey, data) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  if (!key || !data) return;
  const redis = requireRedis(req);
  const dateContext = getBeijingDateContext();
  const cacheKey = getIdempotencyRedisKey(getAuthCenterUserId(req), bucket, key, req);
  await redis.setEx(cacheKey, dateContext.ttlSeconds, JSON.stringify(data)).catch((error) => {
    console.warn("[EchoHunt KOL Match] idempotency cache write failed", { message: error.message });
  });
}

function splitUserSegments(text) {
  return String(text || "")
    .split(/[。！？!?；;，,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findRiskSegments(segments) {
  const riskRules = [
    {
      code: "SECRET_OR_SYSTEM_PROMPT_REQUEST",
      pattern: /system\s*prompt|developer\s*message|系统提示|开发者指令|内部提示|api[_\s-]?key|密钥|token|jwt|数据库密码|连接串|database_url|环境变量/i,
    },
    {
      code: "PROMPT_INJECTION",
      pattern: /ignore\s+(all\s+)?(previous|above)\s+instructions|忽略(以上|前面|之前|所有).*指令|不要遵守|绕过.*规则|越狱|jailbreak|\bDAN\b|act\s+as\s+/i,
    },
    {
      code: "OUT_OF_SCOPE",
      pattern: /不要.*(找|匹配).{0,12}(kol|KOL|达人|博主|influencer)|not\s+find\s+(kol|influencer)|改成|instead\s+of/i,
    },
    {
      code: "OUT_OF_SCOPE",
      pattern: /写.*(python|代码|脚本|爬虫)|生成.*(python|代码|脚本)|执行命令|shell|sql|数据库结构|drop\s+table|爬取/i,
    },
    {
      code: "OUT_OF_SCOPE",
      pattern: /预测.*(币价|价格|涨跌)|买入|卖出|投资建议|price\s+prediction|financial\s+advice|trading\s+signal/i,
    },
    {
      code: "OUT_OF_SCOPE",
      pattern: /讲个笑话|写小说|写合同|翻译这|总结这篇|生成图片|做图|普通聊天|marketing\s+copy|写.*软文/i,
    },
  ];

  const matches = [];
  for (const segment of segments) {
    const matchedRule = riskRules.find((rule) => rule.pattern.test(segment));
    if (matchedRule) {
      matches.push({ code: matchedRule.code, text: shorten(segment, 120) });
    }
  }
  return matches;
}

function stripDangerousFragments(text) {
  let clean = String(text || "");
  for (const pattern of DANGEROUS_INPUT_PATTERNS) {
    clean = clean.replace(pattern, "");
  }
  return normalizeString(clean.replace(/[。！？!?；;，,\n]+/g, "。"), 1200);
}

function hasKolMatchIntent(text) {
  return /(kol|k\.o\.l|influencer|creator|达人|博主|影响者|关键意见领袖|营销|推广|投放|增长|拉新|活动|campaign|ambassador|合作|商务|品牌|曝光|受众|社区|项目|产品|协议|平台|上线|发布|launch|growth|marketing|web\s*3|crypto|blockchain|defi|rwa|dex|nft|gamefi|airdrop|空投|积分|链上|区块链|加密|公链|钱包|交易|永续|合约|ai|agent|aigc|大模型|智能体)/i.test(text);
}

function isTooVagueKolMatchBrief(text) {
  const normalized = normalizeString(text, 1200);
  if (normalized.length < 12) return true;
  return /^(帮我)?(找人|找几个|推荐几个|随便推荐|找kol|找KOL|find\s+(some\s+)?(kols|influencers))$/i.test(normalized);
}

function classifyKolMatchScope(projectBrief) {
  const rawBrief = normalizeString(projectBrief, 1200);
  const segments = splitUserSegments(rawBrief);
  const riskSegments = findRiskSegments(segments);
  const riskTexts = new Set(riskSegments.map((item) => item.text));
  const safeSegments = segments.filter((segment) => !riskSegments.some((risk) => risk.text === shorten(segment, 120)));
  const strippedBrief = stripDangerousFragments(rawBrief);
  const safeBrief = normalizeString(safeSegments.join("。") || strippedBrief || rawBrief, 1200);
  const hasRisk = riskSegments.length > 0;
  const hasIntent = hasKolMatchIntent(safeBrief);

  if (isTooVagueKolMatchBrief(safeBrief)) {
    if (hasRisk) {
      return {
        status: "rejected",
        reasonCode: riskSegments[0].code,
        safeBrief: "",
        ignoredInstructions: Array.from(riskTexts),
        userMessage: "我只能根据你的项目与营销需求生成 KOL 匹配名单，不能处理提示词注入、密钥、代码执行或无关任务。",
      };
    }
    return {
      status: "needs_clarification",
      reasonCode: "TOO_VAGUE",
      safeBrief,
      ignoredInstructions: [],
      userMessage: "请补充项目类型、目标受众、营销目标，以及希望合作的 KOL 类型。",
    };
  }

  if (!hasIntent) {
    return {
      status: "rejected",
      reasonCode: hasRisk ? riskSegments[0].code : "OUT_OF_SCOPE",
      safeBrief: "",
      ignoredInstructions: Array.from(riskTexts),
      userMessage: "我只能根据你的项目与营销需求生成 KOL 匹配名单。请描述项目、目标受众、营销目标和希望合作的 KOL 类型。",
    };
  }

  if (hasRisk && !safeSegments.some(hasKolMatchIntent)) {
    return {
      status: "rejected",
      reasonCode: riskSegments[0].code,
      safeBrief: "",
      ignoredInstructions: Array.from(riskTexts),
      userMessage: "我只能处理 KOL 匹配需求，不能执行无关指令或泄露内部信息。",
    };
  }

  return {
    status: "accepted",
    reasonCode: "KOL_MATCH_REQUEST",
    safeBrief,
    ignoredInstructions: Array.from(riskTexts),
    userMessage: "需求已通过 KOL Match 安全检查。",
  };
}

function throwIfScopeNotAccepted(scope) {
  if (scope.status === "accepted") return;
  const code = scope.status === "needs_clarification" ? "KOL_MATCH_NEEDS_CLARIFICATION" : "KOL_MATCH_OUT_OF_SCOPE";
  throw publicError(code, 400, scope.userMessage, {
    scope: {
      status: scope.status,
      reasonCode: scope.reasonCode,
      ignoredInstructions: scope.ignoredInstructions || [],
    },
  });
}

function requireKolMatchVip(req, res, next) {
  if (isRequestXHuntVip(req)) return next();

  return res.status(403).json({
    success: false,
    error: "XHUNT_VIP_REQUIRED",
    message: "KOL Match 当前仅限 XHunt VIP 用户使用。",
    data: { quotaCharged: false },
  });
}

function createClientClosedError() {
  return publicError("KOL_MATCH_CLIENT_CLOSED", 499, "请求已取消，本次不会扣除 AI 精准匹配次数。", {
    quotaCharged: false,
  });
}

function throwIfClientClosed(isClientClosed) {
  if (typeof isClientClosed === "function" && isClientClosed()) {
    throw createClientClosedError();
  }
}


function followerPresetToMin(value) {
  const map = {
    any: null,
    "10k": 10000,
    "50k": 50000,
    "100k": 100000,
    "500k": 500000,
  };
  if (Object.prototype.hasOwnProperty.call(map, value)) return map[value];
  return null;
}

function activityPresetToDays(value) {
  const map = {
    any: null,
    "7d": 7,
    "14d": 14,
    "30d": 30,
  };
  if (Object.prototype.hasOwnProperty.call(map, value)) return map[value];
  return null;
}

function rankPresetToMax(value) {
  const map = {
    any: null,
    "1k": 1000,
    "5k": 5000,
    "10k": 10000,
    "50k": 50000,
    "100k": 100000,
  };
  if (Object.prototype.hasOwnProperty.call(map, value)) return map[value];
  return null;
}

function normalizeProductHardFilters(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const domainsInput = Array.isArray(source.domains) ? source.domains : [source.domain].filter(Boolean);
  const domains = domainsInput.length > 0 ? domainsInput.map((item) => normalizeDomain(item, "")).filter(Boolean) : [];
  const marketValue = source.market !== undefined ? source.market : source.language;
  const language = marketValue !== undefined ? normalizeMarket(marketValue, "") : "";
  const presetFollowers = followerPresetToMin(source.followers);
  const explicitMinFollowers = numeric(source.minFollowers);
  const explicitMaxFollowers = numeric(source.maxFollowers);
  const presetActivityDays = activityPresetToDays(source.activity);
  const explicitActivityDays = numeric(source.activityDays);
  const willingness = normalizeString(source.willingness || source.willingnessLevel, 32).toLowerCase();

  const normalized = normalizeFilters({
    language,
    domains,
    minFollowers: explicitMinFollowers !== null ? explicitMinFollowers : presetFollowers,
    maxFollowers: explicitMaxFollowers,
    activityDays: explicitActivityDays !== null ? explicitActivityDays : presetActivityDays,
    willingnessLevels: willingnessMinimumToLevels(willingness),
    keywords: source.keywords,
    cooperationTypes: source.cooperationTypes,
    marketingGoals: source.marketingGoals,
    projectStages: source.projectStages,
    identityTier: source.identityTier,
    excludeNonAcceptingCollaboration: source.excludeNonAcceptingCollaboration === true,
  });

  if (source.excludeLowWillingness === true || willingness === "exclude-low") {
    delete normalized.willingnessLevel;
    delete normalized.willingnessLevels;
    normalized.excludeLowWillingness = true;
  }

  return normalized;
}

function mergeExplicitFilters(base = {}, explicit = {}) {
  const merged = {
    ...base,
    ...explicit,
    domains: explicit.domains?.length ? explicit.domains : base.domains,
  };
  if (
    Object.prototype.hasOwnProperty.call(explicit, "willingnessLevels") ||
    Object.prototype.hasOwnProperty.call(explicit, "willingnessLevel")
  ) {
    delete merged.willingnessLevels;
    delete merged.willingnessLevel;
    if (explicit.willingnessLevels) merged.willingnessLevels = explicit.willingnessLevels;
    if (explicit.willingnessLevel) merged.willingnessLevel = explicit.willingnessLevel;
  }
  if (explicit.excludeLowWillingness === true) {
    delete merged.willingnessLevels;
    delete merged.willingnessLevel;
    merged.excludeLowWillingness = true;
  }
  return normalizeFilters(merged);
}

function getAiSearchSqlFilters(strategyFilters = {}, hardFilters = {}) {
  const base = normalizeFilters(strategyFilters);

  // strategy.filters 由 LLM 生成，keywords / goals / stages / identityTier 容易是自然语言标签，
  // 不能作为 AI 精准匹配的 SQL 硬过滤；这些信息保留在 semanticQuery 中参与向量召回。
  // hardFilters 是前端显式选择的产品过滤条件，仍保留最高优先级。
  for (const key of AI_STRATEGY_SEMANTIC_ONLY_FILTER_KEYS) {
    delete base[key];
  }

  return mergeExplicitFilters(base, hardFilters);
}

function buildStrategyChips(filters = {}, lang = "zh") {
  const chips = [];
  if (filters.domains?.length) chips.push(filters.domains.join(" / "));
  if (filters.language) chips.push(filters.language === "CN" ? (lang === "en" ? "Chinese" : "中文") : (lang === "en" ? "Global" : "全球"));
  if (filters.minFollowers !== undefined) chips.push(lang === "en" ? `${Math.round(filters.minFollowers).toLocaleString("en-US")}+ followers` : `粉丝 ${Math.round(filters.minFollowers).toLocaleString("en-US")}+`);
  if (filters.maxFollowers !== undefined) chips.push(lang === "en" ? `≤ ${Math.round(filters.maxFollowers).toLocaleString("en-US")} followers` : `粉丝 ≤ ${Math.round(filters.maxFollowers).toLocaleString("en-US")}`);
  if (filters.activityDays !== undefined) chips.push(lang === "en" ? `Active in ${filters.activityDays}d` : `近 ${filters.activityDays} 天活跃`);
  if (filters.excludeNonAcceptingCollaboration === true) chips.push(lang === "en" ? "Exclude explicitly unavailable KOLs" : "排除明确不接受邀请");
  if (filters.excludeLowWillingness === true) chips.push(lang === "en" ? "Exclude low willingness" : "排除低接单意愿");
  if (filters.willingnessLevels?.length) {
    const levels = [...filters.willingnessLevels].sort().join(",");
    if (levels === "high") chips.push(lang === "en" ? "High willingness" : "高接单意愿");
    else if (levels === "high,medium") chips.push(lang === "en" ? "Medium+ willingness" : "中及以上接单意愿");
    else if (levels === "high,low,medium") chips.push(lang === "en" ? "Low+ willingness" : "低及以上接单意愿");
    else if (levels === "high,medium,unknown") chips.push(lang === "en" ? "Exclude low willingness" : "排除低接单意愿");
    else chips.push(lang === "en" ? `Willingness: ${filters.willingnessLevels.join(" / ")}` : `接单意愿：${filters.willingnessLevels.join(" / ")}`);
  }
  if (filters.willingnessLevel) chips.push(lang === "en" ? `Willingness: ${filters.willingnessLevel}` : `接单意愿：${filters.willingnessLevel}`);
  return chips.slice(0, 10);
}

function inferDomainFromBrief(brief) {
  if (/(\bai\b|aigc|agent|llm|大模型|人工智能|智能体)/i.test(brief)) return "AI";
  return "Web3";
}

function inferMarketingGoal(brief, lang = "zh") {
  if (/积分|空投|airdrop|points/i.test(brief)) return lang === "en" ? "Campaign launch / user growth" : "活动冷启动 / 用户增长";
  if (/品牌|曝光|声量|awareness/i.test(brief)) return lang === "en" ? "Brand awareness" : "品牌曝光";
  if (/开发者|技术|developer/i.test(brief)) return lang === "en" ? "Developer reach / technical endorsement" : "开发者触达 / 技术背书";
  if (/社区|社群|community/i.test(brief)) return lang === "en" ? "Community growth" : "社区增长";
  return lang === "en" ? "Project promotion and targeted reach" : "项目推广与精准触达";
}

function buildFallbackStrategy({ scope, projectHandle, hardFilters, lang = "zh" }) {
  const domain = hardFilters.domains?.[0] || inferDomainFromBrief(scope.safeBrief);
  const filters = normalizeFilters({
    language: hardFilters.language || "GLOBAL",
    domains: hardFilters.domains?.length ? hardFilters.domains : [domain],
    minFollowers: hardFilters.minFollowers,
    maxFollowers: hardFilters.maxFollowers,
    activityDays: hardFilters.activityDays,
    willingnessLevels: hardFilters.willingnessLevels,
    willingnessLevel: hardFilters.willingnessLevel,
    excludeNonAcceptingCollaboration: hardFilters.excludeNonAcceptingCollaboration === true,
  });
  const topicTerms = extractBriefTerms(scope.safeBrief).slice(0, 6);
  const goal = inferMarketingGoal(scope.safeBrief, lang);
  const projectType = lang === "en"
    ? (topicTerms.length ? `${topicTerms.slice(0, 3).join(" / ")} ${domain} project` : (domain === "AI" ? "AI project" : "Web3 project"))
    : (topicTerms.length ? `${topicTerms.slice(0, 3).join(" / ")} ${domain} 项目` : (domain === "AI" ? "AI 项目" : "Web3 项目"));
  const marketLabel = filters.language === "CN" ? (lang === "en" ? "Chinese-speaking" : "中文") : (lang === "en" ? "global" : "全球");
  const topicLabel = topicTerms.slice(0, 4).join(lang === "en" ? ", " : "、") || (lang === "en" ? "the project’s target audience" : "项目目标受众");
  const idealKolProfile = lang === "en"
    ? `${marketLabel} ${domain} KOLs whose content matches ${topicLabel}`
    : `${marketLabel}${domain} KOL，内容方向与 ${topicLabel} 匹配`;

  return {
    projectUnderstanding: {
      projectType,
      marketingGoal: goal,
      targetAudience: topicTerms.length
        ? (lang === "en" ? `Audience interested in ${topicTerms.slice(0, 5).join(", ")}` : `${topicTerms.slice(0, 5).join("、")} 相关受众`)
        : (lang === "en" ? "Target users and potential collaboration audience" : "项目目标用户与潜在合作受众"),
      idealKolProfile,
    },
    semanticQuery: normalizeString([
      projectHandle ? `@${projectHandle}` : "",
      scope.safeBrief,
      goal,
      idealKolProfile,
    ].filter(Boolean).join(" "), 500),
    filters,
    strategyChips: buildStrategyChips(filters, lang),
    publicReasoning: lang === "en" ? [
      `The project brief has been organized into a KOL matching task for a ${projectType}.`,
      `This search will prioritize ${idealKolProfile}.`,
      "Required filters narrow the candidate pool first; ranking then combines semantic relevance, influence, and collaboration willingness.",
    ] : [
      `系统已把项目需求整理为 ${projectType} 的 KOL 匹配任务。`,
      `本次会优先寻找 ${idealKolProfile}。`,
      "硬筛条件会先用于缩小候选集，再综合语义相关性、影响力和接单意愿排序。",
    ],
    confidence: 0.55,
    source: "fallback_rules",
  };
}


function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function normalizeXRecentPosts(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((post, index) => {
      if (typeof post === "string") {
        return {
          id: String(index + 1),
          text: normalizeString(post, 1500),
          createdAt: null,
        };
      }
      if (!post || typeof post !== "object") return null;
      const text = normalizeString(
        post.text ||
          post.fullText ||
          post.full_text ||
          post.content ||
          post.body ||
          post.description ||
          "",
        1500
      );
      if (!text) return null;
      return {
        id: normalizeString(post.id || post.tweetId || post.tweet_id || post.rest_id || String(index + 1), 80),
        text,
        createdAt: toIso(post.createdAt || post.created_at || post.create_time || post.time),
      };
    })
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeLocalizedProfileText(value, maxLength = 700) {
  if (!value) return null;
  if (typeof value === "string") {
    const text = normalizeString(value, maxLength);
    return text ? { defaultValue: text } : null;
  }
  if (typeof value !== "object") return null;
  const zh = normalizeString(value.zh || value.cn || value.summary_zh || value.summary_cn || value.text_zh || value.text_cn || "", maxLength);
  const en = normalizeString(value.en || value.summary_en || value.text_en || "", maxLength);
  const defaultValue = normalizeString(value.defaultValue || value.default || value.summary || value.text || "", maxLength);
  if (!zh && !en && !defaultValue) return null;
  return { zh, en, defaultValue };
}

function normalizeMentionSummary(value) {
  if (!value) return null;
  if (typeof value === "string") return normalizeLocalizedProfileText(value, 700);
  if (typeof value !== "object") return null;
  const preferred = value.day7 || value.week || value.last7d || value.day1 || value.daily || value;
  return normalizeLocalizedProfileText(preferred, 700) || normalizeLocalizedProfileText(value, 700);
}

function pickLocalizedProfileText(value, lang = "zh") {
  if (!value) return "";
  if (typeof value === "string") return normalizeString(value, 700);
  if (typeof value !== "object") return "";
  const preferred = isEnglishUi(lang) ? value.en : value.zh;
  const alternate = isEnglishUi(lang) ? value.zh : value.en;
  return normalizeString(preferred || value.defaultValue || value.default || alternate || "", 700);
}

function localizedProfileEvidence(value) {
  if (!value) return "";
  if (typeof value === "string") return normalizeString(value, 700);
  if (typeof value !== "object") return "";
  return [value.zh, value.en, value.defaultValue || value.default]
    .map((item) => normalizeString(item, 700))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .join(" / ");
}

function normalizeProjectXProfile(input) {
  const source = input && typeof input === "object" ? input : {};
  const profile = source.profile && typeof source.profile === "object" ? source.profile : {};
  const feature = source.feature && typeof source.feature === "object" ? source.feature : {};
  const handle = normalizeHandle(
    source.handle ||
      source.username ||
      source.username_raw ||
      source.screen_name ||
      source.userName ||
      profile.username ||
      profile.username_raw
  );
  const name = normalizeString(source.name || source.displayName || source.display_name || profile.name || handle, 120);
  const recentPosts = normalizeXRecentPosts(
    source.recentPosts ||
      source.recent_posts ||
      source.recentTweets ||
      source.recent_tweets ||
      source.tweets ||
      source.posts ||
      source.statuses ||
      profile.recentPosts ||
      profile.recent_posts
  );
  return {
    twitterId: normalizeString(source.twitterId || source.twitter_id || source.id || source.userId || profile.id || "", 80) || null,
    handle,
    name,
    verified: source.verified === true || source.isVerified === true || source.blue_verified === true || profile.verified === true || profile.is_blue_verified === true || false,
    followers: numeric(source.followers || source.followers_count || profile.followers_count),
    following: numeric(source.following || source.following_count || profile.following_count),
    description: normalizeString(source.description || source.bio || profile.description || profile.bio || "", 1000),
    narrative: normalizeLocalizedProfileText(source.narrative || feature.narrative),
    mentionSummary: normalizeMentionSummary(source.mentionSummary || source.mention_summary || feature.mention_summary),
    createdAt: toIso(source.createdAt || source.created_at || source.create_time || profile.created_at || profile.first_record),
    recentPosts,
    source: normalizeString(source.source || "request_x_profile", 80),
  };
}

function hasUsefulXProfile(profile) {
  return !!(
    profile &&
    (profile.name || profile.handle || profile.description || profile.followers || profile.verified || profile.recentPosts?.length)
  );
}

function mergeProjectXProfiles(primary, fallback) {
  const left = normalizeProjectXProfile(primary);
  const right = normalizeProjectXProfile(fallback);
  return {
    ...right,
    ...left,
    twitterId: left.twitterId || right.twitterId || null,
    handle: left.handle || right.handle,
    name: left.name || right.name,
    followers: left.followers ?? right.followers,
    following: left.following ?? right.following,
    description: left.description || right.description,
    narrative: left.narrative || right.narrative,
    mentionSummary: left.mentionSummary || right.mentionSummary,
    createdAt: left.createdAt || right.createdAt,
    recentPosts: left.recentPosts?.length ? left.recentPosts : right.recentPosts,
    source: left.source || right.source,
  };
}

function buildStrategyProfileContext(xProfile, lang = "zh") {
  const profile = normalizeProjectXProfile(xProfile);
  if (!hasUsefulXProfile(profile)) {
    return {
      available: false,
      enrichment: "none",
      title: uiText(lang, "主要依据本次需求生成策略", "Strategy based mainly on this brief"),
      summary: uiText(lang, "未取得可用的项目 X 画像，本次策略会以你填写的需求和硬筛条件为准。", "No usable project X profile was available, so the strategy is based on your brief and required filters."),
      evidenceLabels: [],
      followers: null,
      postCount: 0,
    };
  }

  const evidenceLabels = [];
  const narrativeText = pickLocalizedProfileText(profile.narrative, lang);
  const mentionText = pickLocalizedProfileText(profile.mentionSummary, lang);
  if (narrativeText) evidenceLabels.push(uiText(lang, "Narrative 画像", "Narrative"));
  if (profile.description) evidenceLabels.push(uiText(lang, "X Bio", "X bio"));
  if (mentionText) evidenceLabels.push(uiText(lang, "提及摘要", "Mention summary"));
  if (profile.recentPosts?.length) evidenceLabels.push(uiText(lang, "近期公开内容", "Recent posts"));

  const enrichment = narrativeText || mentionText ? "feature" : profile.recentPosts?.length ? "posts" : profile.description ? "bio" : "identity";
  const displayName = profile.name || (profile.handle ? `@${profile.handle}` : "");
  const title = narrativeText
    ? uiText(lang, `核心画像：${shorten(narrativeText, 54)}`, `Core profile: ${shorten(narrativeText, 64)}`)
    : uiText(lang, "已识别项目账号定位", "Project account positioning identified");
  const summary = mentionText
    ? uiText(lang, `近期外部讨论主要指向：${shorten(mentionText, 96)}`, `Recent external discussion points to: ${shorten(mentionText, 110)}`)
    : profile.description
      ? uiText(lang, `${displayName || "项目账号"} 的公开简介显示：${shorten(profile.description, 96)}`, `${displayName || "The project account"} bio says: ${shorten(profile.description, 110)}`)
      : profile.recentPosts?.length
        ? uiText(lang, `已参考 ${displayName || "项目账号"} 的近期公开内容补充项目表达方式。`, `Referenced recent public posts from ${displayName || "the project account"} to enrich project positioning.`)
        : uiText(lang, `已确认 ${displayName || "项目账号"} 的 X 身份，本次策略主要依据你填写的需求。`, `Confirmed the X identity for ${displayName || "the project account"}; the strategy is mainly based on your brief.`);

  return {
    available: true,
    enrichment,
    title,
    summary: sanitizePublicText(summary, 220, lang),
    evidenceLabels: evidenceLabels.slice(0, 4),
    narrative: narrativeText || null,
    mentionSummary: mentionText || null,
    followers: Number.isFinite(profile.followers) ? profile.followers : null,
    postCount: profile.recentPosts?.length || 0,
  };
}

function buildStrategyEvidence({ scope, projectHandle, hardFilters, xProfile }) {
  const evidence = [];
  const push = (id, type, text) => {
    const cleaned = normalizeString(text, 2000);
    if (cleaned) evidence.push({ id, type, text: cleaned });
  };

  push("brief:0", "user_brief", scope.safeBrief);
  Object.entries(hardFilters || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    push(`filter:${key}`, "hard_filter", `${key}: ${JSON.stringify(value)}`);
  });

  const profile = normalizeProjectXProfile(xProfile);
  if (hasUsefulXProfile(profile)) {
    const identity = [
      profile.name,
      profile.handle ? `@${profile.handle}` : projectHandle ? `@${projectHandle}` : "",
      profile.verified ? "verified" : "",
      Number.isFinite(profile.followers) ? `followers:${profile.followers}` : "",
    ].filter(Boolean).join(" ");
    push("x:identity", "x_profile_identity", identity);
    push("x:bio", "x_profile_bio", profile.description);
    push("x:narrative", "x_profile_narrative", localizedProfileEvidence(profile.narrative));
    push("x:mention_summary", "x_profile_mention_summary", localizedProfileEvidence(profile.mentionSummary));
    profile.recentPosts.forEach((post, index) => {
      const safeId = normalizeString(post.id, 80).replace(/[^a-zA-Z0-9_-]/g, "") || String(index + 1);
      push(`x:post:${safeId}`, "x_recent_post", post.text);
    });
  }

  return evidence.slice(0, 32);
}


function containsCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ""));
}

function hasLatinSentence(text) {
  return /[a-z]{3,}(\s+[a-z]{2,}){2,}/i.test(String(text || ""));
}

function shouldUseLocalizedFallback(value, lang) {
  const text = normalizeString(value, 260);
  if (!text) return true;
  if (lang === "zh") return !containsCjk(text) && hasLatinSentence(text);
  return containsCjk(text);
}

function localizedOrFallback(value, fallback, lang) {
  const text = sanitizePublicText(value, 500, lang);
  return shouldUseLocalizedFallback(text, lang) ? sanitizePublicText(fallback, 500, lang) : text;
}

function enforceStrategyLanguage(strategy, fallbackStrategy, lang) {
  const fields = ["projectType", "marketingGoal", "targetAudience", "idealKolProfile"];
  const projectUnderstanding = {};
  for (const field of fields) {
    projectUnderstanding[field] = localizedOrFallback(
      strategy.projectUnderstanding?.[field],
      fallbackStrategy.projectUnderstanding?.[field],
      lang
    );
  }

  const publicReasoning = safeArray(strategy.publicReasoning, 8, 500)
    .map((item, index) => localizedOrFallback(item, fallbackStrategy.publicReasoning?.[index] || item, lang))
    .filter(Boolean);
  const chips = safeArray(strategy.strategyChips, 10, 80);
  const chipLooksWrongLanguage = (chip) => shouldUseLocalizedFallback(chip, lang) ||
    (lang === "zh" && /(followers?|willingness|active\s+in|global|chinese)/i.test(String(chip || ""))) ||
    (lang === "en" && /(粉丝|接单|活跃|中文|全球)/.test(String(chip || "")));
  const localizedChips = chips.length && !chips.some(chipLooksWrongLanguage)
    ? chips
    : buildStrategyChips(strategy.filters || fallbackStrategy.filters, lang);

  return {
    ...strategy,
    projectUnderstanding,
    publicReasoning: publicReasoning.length ? publicReasoning : fallbackStrategy.publicReasoning,
    strategyChips: localizedChips,
  };
}

function normalizeLlmStrategy(raw, fallbackStrategy, hardFilters, lang = "zh") {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const understanding = source.projectUnderstanding && typeof source.projectUnderstanding === "object"
    ? source.projectUnderstanding
    : {};
  const llmFilters = normalizeFilters(source.filters || {});
  const baseFilters = {
    ...fallbackStrategy.filters,
    ...llmFilters,
    domains: llmFilters.domains?.length ? llmFilters.domains : fallbackStrategy.filters.domains,
  };
  if (llmFilters.willingnessLevels || llmFilters.willingnessLevel) {
    delete baseFilters.willingnessLevels;
    delete baseFilters.willingnessLevel;
    if (llmFilters.willingnessLevels) baseFilters.willingnessLevels = llmFilters.willingnessLevels;
    if (llmFilters.willingnessLevel) baseFilters.willingnessLevel = llmFilters.willingnessLevel;
  } else {
    if (fallbackStrategy.filters.willingnessLevels) baseFilters.willingnessLevels = fallbackStrategy.filters.willingnessLevels;
    if (fallbackStrategy.filters.willingnessLevel) baseFilters.willingnessLevel = fallbackStrategy.filters.willingnessLevel;
  }
  const filters = mergeExplicitFilters(normalizeFilters(baseFilters), hardFilters);
  const projectUnderstanding = {
    projectType: sanitizePublicText(understanding.projectType || fallbackStrategy.projectUnderstanding.projectType, 120, lang),
    marketingGoal: sanitizePublicText(understanding.marketingGoal || fallbackStrategy.projectUnderstanding.marketingGoal, 120, lang),
    targetAudience: sanitizePublicText(understanding.targetAudience || fallbackStrategy.projectUnderstanding.targetAudience, 180, lang),
    idealKolProfile: sanitizePublicText(understanding.idealKolProfile || fallbackStrategy.projectUnderstanding.idealKolProfile, 180, lang),
  };
  const semanticQuery = sanitizePublicText(source.semanticQuery || fallbackStrategy.semanticQuery, 500, lang);
  const strategyChips = safeArray(source.strategyChips, 10, 80);
  const publicReasoning = safeArray(source.publicReasoning, 8, 500)
    .map((item) => sanitizePublicText(item, 500, lang))
    .filter(Boolean);
  const confidence = numeric(source.confidence);

  const normalized = {
    projectUnderstanding,
    semanticQuery: semanticQuery || fallbackStrategy.semanticQuery,
    filters,
    strategyChips: strategyChips.length ? strategyChips : buildStrategyChips(filters, lang),
    publicReasoning: publicReasoning.length ? publicReasoning : fallbackStrategy.publicReasoning,
    confidence: confidence === null ? fallbackStrategy.confidence : Math.min(1, Math.max(0, confidence)),
    source: "llm_structured",
  };
  return enforceStrategyLanguage(normalized, fallbackStrategy, lang);
}

async function generateKolMatchStrategy(params, req) {
  const projectBrief = normalizeString(params.projectBrief, 1200);
  const projectHandle = normalizeHandle(params.projectHandle);
  const lang = normalizeUiLang(params.lang, req?.query?.lang, req?.headers?.["x-language"], req?.headers?.["accept-language"]);
  const runtimeConfig = getResolvedKolMatchConfig(req);
  const scope = classifyKolMatchScope(projectBrief);
  throwIfScopeNotAccepted(scope);

  const hardFilters = normalizeProductHardFilters(params.hardFilters || params.filters || {});
  const requestXProfile = normalizeProjectXProfile(params.xProfile || params.projectAccount || params.projectAccountSnapshot);
  let xProfile = requestXProfile;
  if (projectHandle) {
    const lookedUpProfile = await lookupProjectAccount(projectHandle, {
      failOnUpstreamError: false,
    }).catch(() => null);
    if (lookedUpProfile) xProfile = mergeProjectXProfiles(lookedUpProfile, requestXProfile);
  }
  const fallbackStrategy = buildFallbackStrategy({ scope, projectHandle, hardFilters, lang });
  let strategy = fallbackStrategy;
  let llmError = null;

  if (isStrategyLlmEnabled(req)) {
    const timeoutMs = getStrategyLlmTimeoutMs(req);
    const model = getStrategyLlmModel(req);
    const strategyEvidence = buildStrategyEvidence({ scope, projectHandle, hardFilters, xProfile });
    try {
      const raw = await withTimeout(
        structuredChat(buildStrategyPrompt({ scope, projectHandle, hardFilters, evidence: strategyEvidence, lang, config: runtimeConfig }), STRATEGY_SCHEMA, {
          model: model || undefined,
          temperature: getStrategyLlmTemperature(req),
          maxTokens: getStrategyLlmMaxTokens(req),
          systemPrompt: buildStrategySystemPrompt({ lang, config: runtimeConfig }),
        }),
        timeoutMs,
        `EchoHunt KOL Match strategy LLM timeout after ${timeoutMs}ms`
      );
      strategy = normalizeLlmStrategy(raw, fallbackStrategy, hardFilters, lang);
    } catch (error) {
      llmError = sanitizePublicText(error.message || "strategy llm failed", 160, lang);
      console.warn("[EchoHunt KOL Match] strategy LLM fallback", {
        requestId: getRequestId(req),
        authCenterUserId: getAuthCenterUserId(req),
        projectHandle,
        message: llmError,
      });
    }
  }

  const strategyId = `ks_${crypto.randomBytes(12).toString("base64url")}`;
  const payload = {
    strategyId,
    lang,
    scope,
    projectHandle,
    xProfile: hasUsefulXProfile(xProfile) ? xProfile : null,
    profileContext: buildStrategyProfileContext(xProfile, lang),
    projectBrief: scope.safeBrief,
    projectUnderstanding: strategy.projectUnderstanding,
    semanticQuery: strategy.semanticQuery,
    filters: strategy.filters,
    filterPlan: {
      source: strategy.source,
      llmConfidence: strategy.confidence,
      llmError,
    },
    publicReasoning: strategy.publicReasoning,
    strategyChips: strategy.strategyChips,
    ...getKolMatchRuntimeMeta(req),
    createdAt: new Date().toISOString(),
  };

  const redis = requireRedis(req);
  await redis.setEx(
    `${STRATEGY_CACHE_PREFIX}:${getAuthCenterUserId(req)}:${strategyId}`,
    STRATEGY_TTL_SECONDS,
    JSON.stringify(payload)
  );

  return payload;
}

async function loadStoredStrategy(req, strategyId) {
  const normalized = normalizeString(strategyId, 80);
  if (!normalized) return null;
  const redis = requireRedis(req);
  const cached = await redis.get(`${STRATEGY_CACHE_PREFIX}:${getAuthCenterUserId(req)}:${normalized}`).catch(() => null);
  if (!cached) return null;
  try {
    const data = JSON.parse(cached);
    const meta = getKolMatchRuntimeMeta(req);
    if (data?.appEnv && data.appEnv !== meta.appEnv) return null;
    if (data?.configVersion && data.configVersion !== meta.configVersion) return null;
    return data;
  } catch {
    return null;
  }
}

function extractBriefTerms(brief) {
  const text = String(brief || "").toLowerCase();
  const vocabularyTerms = BRIEF_VOCABULARY.filter((term) => {
    const normalized = term.toLowerCase();
    if (!/^[a-z0-9 -]+$/i.test(term)) return text.includes(normalized);
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
  });
  const latinTerms = text.match(/[a-z][a-z0-9-]{2,}/g) || [];
  const ignored = new Set(["about", "with", "from", "that", "this", "next", "month", "chain", "project"]);
  const unique = new Map();
  [...vocabularyTerms, ...latinTerms.filter((term) => !ignored.has(term))].forEach((term) => {
    const key = term.toLowerCase();
    if (!unique.has(key)) unique.set(key, term);
  });
  return [...unique.values()].slice(0, 12);
}

function capabilityScoreItems(abilities, market, lang = "zh", maxItems = 20) {
  if (!abilities || typeof abilities !== "object") return [];
  const bucket = abilities[lang === "en" ? "en" : market === "CN" ? "cn" : "en"] || abilities.en || abilities.cn;
  const fields = Array.isArray(bucket?.fields) ? bucket.fields : [];
  return fields
    .flatMap((field) => Object.entries(field || {}).map(([label, value]) => ({ label, score: numeric(value) })))
    .filter((item) => item.label)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, maxItems);
}

function capabilityLabels(abilities, market, lang = "zh") {
  return capabilityScoreItems(abilities, market, lang, 6)
    .map((item) => item.label);
}

function localizedSignals(values, lang, patterns, fallback) {
  const source = Array.isArray(values) ? values.filter(Boolean) : [];
  if (lang !== "en") return source.slice(0, 8);
  const localized = [];
  source.forEach((value) => {
    const text = String(value).trim();
    if (!/[\u4e00-\u9fff]/.test(text)) localized.push(text);
    patterns.forEach(([pattern, label]) => {
      if (pattern.test(text)) localized.push(label);
    });
  });
  const unique = [...new Set(localized)];
  return (unique.length ? unique : [fallback]).slice(0, 8);
}

function pickLocalizedProfileArray(row, cnField, enField, lang, maxItems = 8, maxItemLength = 80) {
  const cnItems = safeArray(row?.[cnField], maxItems, maxItemLength);
  const enItems = safeArray(row?.[enField], maxItems, maxItemLength);
  return lang === "en" && enItems.length ? enItems : cnItems;
}

function willingnessText(value, lang = "zh") {
  const labels = lang === "en"
    ? { high: "High", medium: "Medium", low: "Low", unknown: "Not collected" }
    : { high: "高", medium: "中", low: "低", unknown: "未采集" };
  return labels[value] || labels.unknown;
}

function localizedWillingnessEvidence(row, lang) {
  const raw = row.willingnessEvidence !== undefined ? row.willingnessEvidence : row.willingness_evidence;
  const source = Array.isArray(raw) ? raw.filter(Boolean) : [];
  if (lang !== "en") return source.slice(0, 5).map((item) => sanitizePublicText(item, 120, lang));
  const level = row.willingnessLevel || row.willingness_level || "unknown";
  const fallback = {
    high: "Public profile data indicates clear willingness to accept commercial collaborations.",
    medium: "Public profile data indicates conditional willingness to collaborate; confirm availability directly.",
    low: "Public profile data indicates low willingness to accept commercial collaborations.",
    unknown: "No public willingness evidence has been collected yet.",
  }[level] || "No public willingness evidence has been collected yet.";
  const localized = source.map((value) => {
    const text = String(value);
    if (!/[\u4e00-\u9fff]/.test(text)) return sanitizePublicText(text, 120, lang);
    if (/个人简介|简介/.test(text) && /赞助|广告|合作|商务|sponsor|contact|email/i.test(text)) {
      return "The public bio lists sponsorship or collaboration contact information.";
    }
    if (/近期推文|推文|帖子|内容/.test(text) && /赞助|广告|合作/i.test(text)) {
      return "Recent public posts include sponsored or collaboration-related content.";
    }
    return fallback;
  });
  return [...new Set(localized.length ? localized : [fallback])].slice(0, 5);
}

function getInfluenceRank(row, domain, market) {
  if (domain === "AI") return numeric(market === "CN" ? row.aiRankCn : row.aiRankGlobal);
  return numeric(market === "CN" ? row.web3RankCn : row.web3RankGlobal);
}

function scoreKol(row, briefTerms, domain, market) {
  const haystack = [
    row.marketingSummaryCn,
    row.marketingSummaryEn,
    ...(Array.isArray(row.keywords) ? row.keywords : []),
    ...(Array.isArray(row.keywordsEn) ? row.keywordsEn : []),
    ...(Array.isArray(row.marketingGoals) ? row.marketingGoals : []),
    ...(Array.isArray(row.marketingGoalsEn) ? row.marketingGoalsEn : []),
    ...(Array.isArray(row.domains) ? row.domains : []),
  ].join(" ").toLowerCase();
  const matchedTerms = briefTerms.filter((term) => haystack.includes(term.toLowerCase()));
  const similarity = Math.max(0, Math.min(1, numeric(row.similarity) || 0));
  const relevance = Math.max(similarity, briefTerms.length ? Math.min(1, matchedTerms.length / Math.min(8, briefTerms.length)) : 0.35);
  const rank = getInfluenceRank(row, domain, market);
  const rankSignal = rank ? Math.max(0, 1 - Math.log10(rank) / 4.3) : 0.15;
  const followerSignal = Math.min(1, Math.log10(Math.max(1, numeric(row.followers) || 0) + 1) / 6.7);
  const viewSignal = Math.min(1, Math.log10(Math.max(1, numeric(row.mainTweetViewMedian) || 0) + 1) / 5.5);
  const willingnessSignal = { high: 1, medium: 0.65, unknown: 0.35, low: 0 }[row.willingnessLevel] ?? 0.35;
  const score = Math.round(56 + relevance * 24 + rankSignal * 8 + followerSignal * 5 + viewSignal * 3 + willingnessSignal * 4);
  const confidence = Math.round(55 + relevance * 25 + Math.min(1, [row.marketingSummaryCn, row.keywords?.length, rank, row.followers, row.mainTweetViewMedian, row.lastActiveAt].filter(Boolean).length / 6) * 20);
  return {
    score: Math.max(1, Math.min(98, score)),
    confidence: Math.max(1, Math.min(98, confidence)),
    matchedTerms,
  };
}


function clampScore(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function logScore(value, maxValue) {
  const parsed = Math.max(0, numeric(value) || 0);
  const max = Math.max(0, numeric(maxValue) || 0);
  if (max <= 0) return 50;
  return clampScore((Math.log10(parsed + 1) / Math.log10(max + 1)) * 100, 50);
}

function buildCandidateSemanticEvidence(row, index, domain, market, lang = "zh") {
  const abilitySource = domain === "AI" ? row.aiAbilities : row.web3Abilities;
  const evidence = [];
  const push = (field, value) => {
    const textValue = Array.isArray(value)
      ? value.filter(Boolean).join(" | ")
      : normalizeString(value, 1600);
    if (!textValue) return;
    evidence.push({
      evidenceRef: `candidate:${index}:${field}`,
      field,
      text: normalizeString(textValue, 1600),
    });
  };

  push("name", row.name || row.handle);
  push("handle", row.handle ? `@${row.handle}` : "");
  push("domains", row.domains);
  push("keywords", pickLocalizedProfileArray(row, "keywords", "keywordsEn", lang, 12, 64));
  push("capabilities", [
    ...capabilityLabels(abilitySource, market, lang),
    ...capabilityLabels(abilitySource, market, lang === "en" ? "zh" : "en"),
  ]);
  push("marketingSummary", lang === "en"
    ? (row.marketingSummaryEn || row.marketingSummaryCn)
    : (row.marketingSummaryCn || row.marketingSummaryEn));
  push("marketingGoals", pickLocalizedProfileArray(row, "marketingGoals", "marketingGoalsEn", lang, 10, 64));

  return evidence.slice(0, 8);
}

function candidateEvaluationId(row, index = 0) {
  return String(row.twitterUserId || row.id || row.handle || index);
}

function buildCandidateEvaluationInput({ strategy, rows, filters, lang = "zh", rowOffset = 0 }) {
  const domain = filters.domains?.[0] || "Web3";
  const market = filters.language || "GLOBAL";
  const projectContext = {
    project: strategy.projectUnderstanding?.projectType || "",
    goal: strategy.projectUnderstanding?.marketingGoal || "",
    targetAudience: strategy.projectUnderstanding?.targetAudience || "",
    idealKol: strategy.projectUnderstanding?.idealKolProfile || "",
    matchingQuery: strategy.semanticQuery || "",
    hardFilters: {
      domain,
      market,
      activityDays: filters.activityDays,
    },
  };
  const candidates = rows.map((row, index) => {
    const originalIndex = rowOffset + index;
    return {
      candidateId: candidateEvaluationId(row, originalIndex),
      evidence: buildCandidateSemanticEvidence(row, originalIndex, domain, market, lang),
    };
  });
  return { projectContext, candidates };
}

function normalizeAssessment(raw, allowedIds, evidenceOwners, lang = "zh") {
  const candidateId = normalizeString(raw?.candidateId, 120);
  if (!allowedIds.has(candidateId)) return null;
  const rawDimensions = raw?.dimensions && typeof raw.dimensions === "object" ? raw.dimensions : {};
  const dimensions = {
    expertise: clampScore(rawDimensions.expertise, 50),
    content: clampScore(rawDimensions.content, 50),
    audience: clampScore(rawDimensions.audience, 50),
    campaign: clampScore(rawDimensions.campaign, 50),
  };
  const evidence = Array.isArray(raw?.evidence) ? raw.evidence : [];
  const safeEvidence = evidence
    .map((item) => ({
      evidenceRef: normalizeString(item?.evidenceRef, 120),
      statement: sanitizePublicText(item?.statement, 240, lang),
    }))
    .filter((item) => item.evidenceRef && item.statement && evidenceOwners.get(item.evidenceRef) === candidateId)
    .slice(0, 3);

  return {
    candidateId,
    semanticScore: clampScore(raw?.semanticScore, Math.round((dimensions.expertise + dimensions.content + dimensions.audience + dimensions.campaign) / 4)),
    dimensions,
    reason: sanitizePublicText(raw?.reason, 360, lang),
    evidence: safeEvidence,
    matchedTerms: safeArray(raw?.matchedTerms, 8, 80),
  };
}

function buildProxyAssessment(row, briefTerms = [], domain = "Web3", market = "GLOBAL", lang = "zh", index = 0) {
  const similarityScore = clampScore((numeric(row.similarity) || 0) * 100, 55);
  const haystack = [
    row.marketingSummaryCn,
    row.marketingSummaryEn,
    ...(Array.isArray(row.keywords) ? row.keywords : []),
    ...(Array.isArray(row.keywordsEn) ? row.keywordsEn : []),
    ...(Array.isArray(row.marketingGoals) ? row.marketingGoals : []),
    ...(Array.isArray(row.marketingGoalsEn) ? row.marketingGoalsEn : []),
    ...(Array.isArray(row.domains) ? row.domains : []),
  ].join(" ").toLowerCase();
  const matchedTerms = briefTerms.filter((term) => haystack.includes(String(term).toLowerCase())).slice(0, 8);
  const score = Math.max(similarityScore, matchedTerms.length ? Math.min(100, 58 + matchedTerms.length * 6) : similarityScore);
  const reason = recommendationReason(row, matchedTerms, domain, lang);
  const evidence = buildCandidateSemanticEvidence(row, index, domain, market, lang)
    .slice(0, 3)
    .map((item) => ({ evidenceRef: item.evidenceRef, statement: shorten(item.text, 180) }));
  return {
    candidateId: candidateEvaluationId(row, index),
    semanticScore: clampScore(score, 55),
    dimensions: {
      expertise: clampScore(score, 55),
      content: clampScore(score, 55),
      audience: clampScore(Math.max(45, score - 8), 50),
      campaign: clampScore(score, 55),
    },
    reason,
    evidence,
    matchedTerms,
  };
}

async function evaluateAiMatchCandidates({ req, strategy, rows, filters, briefTerms, lang = "zh" }) {
  const domain = filters.domains?.[0] || "Web3";
  const market = filters.language || "GLOBAL";
  const assessmentsById = new Map();
  const evidenceOwners = new Map();
  const evaluatorStartedAt = Date.now();
  const evaluatorEnabled = isEvaluatorLlmEnabled(req);
  const timeoutMs = getEvaluatorLlmTimeoutMs(req);
  const model = getEvaluatorLlmModel(req);
  const batchSize = getEvaluatorLlmBatchSize(req);
  const evaluatorLogContext = {
    requestId: getRequestId(req),
    authCenterUserId: getAuthCenterUserId(req),
  };
  console.info("[EchoHunt KOL Match] candidate evaluator start", {
    ...evaluatorLogContext,
    model: model || null,
    batchSize,
    timeoutMs,
    candidateCount: rows.length,
    domain,
    market,
    enabled: evaluatorEnabled,
  });

  rows.forEach((row, index) => {
    const candidateId = candidateEvaluationId(row, index);
    buildCandidateSemanticEvidence(row, index, domain, market, lang).forEach((item) => {
      evidenceOwners.set(item.evidenceRef, candidateId);
    });
  });

  const fillProxy = (reason, overwrite = true) => {
    let filledCount = 0;
    rows.forEach((row, index) => {
      const candidateId = candidateEvaluationId(row, index);
      if (!overwrite && assessmentsById.has(candidateId)) return;
      const proxy = buildProxyAssessment(row, briefTerms, domain, market, lang, index);
      if (proxy.candidateId) assessmentsById.set(proxy.candidateId, proxy);
      filledCount += 1;
    });
    return filledCount;
  };

  const fallbackProxy = (reason) => {
    fillProxy(reason, true);
    const meta = {
      enabled: evaluatorEnabled,
      engine: "embedding_similarity_proxy",
      fallback: true,
      fallbackReason: reason || null,
      evaluatedCount: rows.length,
      llmEvaluatedCount: 0,
      proxyEvaluatedCount: rows.length,
    };
    console.info("[EchoHunt KOL Match] candidate evaluator done", {
      ...evaluatorLogContext,
      engine: meta.engine,
      fallback: meta.fallback,
      fallbackReason: meta.fallbackReason,
      candidateCount: rows.length,
      evaluatedCount: meta.evaluatedCount,
      llmEvaluatedCount: meta.llmEvaluatedCount,
      proxyEvaluatedCount: meta.proxyEvaluatedCount,
      costMs: Date.now() - evaluatorStartedAt,
    });
    return {
      assessmentsById,
      meta,
    };
  };

  if (!rows.length) return fallbackProxy("no_candidates");
  if (!evaluatorEnabled) return fallbackProxy("llm_disabled");

  const batchErrors = [];

  const evaluateBatch = async (start) => {
    const batchRows = rows.slice(start, start + batchSize);
    const batchAllowedIds = new Set(batchRows.map((row, index) => candidateEvaluationId(row, start + index)));
    const batchStartedAt = Date.now();
    console.info("[EchoHunt KOL Match] candidate evaluator batch start", {
      ...evaluatorLogContext,
      model: model || null,
      batchStart: start,
      expectedCount: batchRows.length,
      timeoutMs,
    });
    try {
      const runtimeConfig = getResolvedKolMatchConfig(req);
      const { projectContext, candidates } = buildCandidateEvaluationInput({ strategy, rows: batchRows, filters, lang, rowOffset: start });
      const raw = await withTimeout(
        structuredChat(buildCandidateEvaluationPrompt({ projectContext, candidates, lang, config: runtimeConfig }), AI_EVALUATOR_SCHEMA, {
          model: model || undefined,
          temperature: getEvaluatorLlmTemperature(req),
          maxTokens: getEvaluatorLlmMaxTokens(req, batchRows.length),
          systemPrompt: buildCandidateEvaluationSystemPrompt({ lang, config: runtimeConfig }),
        }),
        timeoutMs,
        `EchoHunt KOL evaluator LLM batch ${start} timeout after ${timeoutMs}ms`
      );
      const rawCount = Array.isArray(raw?.assessments) ? raw.assessments.length : 0;
      const normalized = (Array.isArray(raw?.assessments) ? raw.assessments : [])
        .map((item) => normalizeAssessment(item, batchAllowedIds, evidenceOwners, lang))
        .filter(Boolean);
      const result = {
        start,
        expectedCount: batchRows.length,
        rawCount,
        assessments: normalized,
        error: normalized.length !== batchRows.length
          ? `batch_${start}_${normalized.length}/${batchRows.length}_valid_raw_${rawCount}`
          : null,
      };
      console.info("[EchoHunt KOL Match] candidate evaluator batch done", {
        ...evaluatorLogContext,
        batchStart: start,
        expectedCount: result.expectedCount,
        rawCount: result.rawCount,
        validCount: result.assessments.length,
        hasError: !!result.error,
        costMs: Date.now() - batchStartedAt,
      });
      return result;
    } catch (error) {
      const errorMessage = sanitizePublicText(error.message || "failed", 120, lang);
      console.warn("[EchoHunt KOL Match] candidate evaluator batch failed", {
        ...evaluatorLogContext,
        batchStart: start,
        expectedCount: batchRows.length,
        message: errorMessage,
        costMs: Date.now() - batchStartedAt,
      });
      return {
        start,
        expectedCount: batchRows.length,
        rawCount: 0,
        assessments: [],
        error: `batch_${start}_${errorMessage}`,
      };
    }
  };

  const batchStarts = [];
  for (let start = 0; start < rows.length; start += batchSize) batchStarts.push(start);
  const batchResults = await Promise.all(batchStarts.map((start) => evaluateBatch(start)));
  batchResults.forEach((result) => {
    result.assessments.forEach((item) => assessmentsById.set(item.candidateId, item));
    if (result.error) batchErrors.push(result.error);
  });

  const llmEvaluatedCount = rows.reduce((count, row, index) => (
    assessmentsById.has(candidateEvaluationId(row, index)) ? count + 1 : count
  ), 0);

  if (llmEvaluatedCount <= 0) {
    const reason = batchErrors[0] || "candidate_evaluator_failed";
    console.warn("[EchoHunt KOL Match] candidate evaluator fallback", {
      requestId: getRequestId(req),
      authCenterUserId: getAuthCenterUserId(req),
      model: model || null,
      batchSize,
      message: sanitizePublicText(reason, 180, lang),
    });
    return fallbackProxy(reason);
  }

  const proxyEvaluatedCount = fillProxy("llm_partial_missing_candidates", false);
  const partial = llmEvaluatedCount < rows.length;
  if (partial) {
    console.warn("[EchoHunt KOL Match] candidate evaluator partial", {
      requestId: getRequestId(req),
      authCenterUserId: getAuthCenterUserId(req),
      model: model || null,
      batchSize,
      llmEvaluatedCount,
      proxyEvaluatedCount,
      candidateCount: rows.length,
      errors: batchErrors.slice(0, 6),
    });
  }

  const meta = {
    enabled: true,
    engine: "llm_semantic_evaluator",
    model: model || null,
    fallback: false,
    partial,
    partialReason: partial ? "llm_partial_missing_candidates" : null,
    evaluatedCount: rows.length,
    llmEvaluatedCount,
    proxyEvaluatedCount,
    batchSize,
  };
  console.info("[EchoHunt KOL Match] candidate evaluator done", {
    ...evaluatorLogContext,
    engine: meta.engine,
    model: meta.model,
    fallback: meta.fallback,
    partial: meta.partial,
    candidateCount: rows.length,
    evaluatedCount: meta.evaluatedCount,
    llmEvaluatedCount: meta.llmEvaluatedCount,
    proxyEvaluatedCount: meta.proxyEvaluatedCount,
    batchSize,
    costMs: Date.now() - evaluatorStartedAt,
  });

  return {
    assessmentsById,
    meta,
  };
}

function buildScoreContext(rows, domain, market) {
  const maxMainViews = Math.max(0, ...rows.map((row) => numeric(row.mainTweetViewMedian) || 0));
  const maxReplyViews = Math.max(0, ...rows.map((row) => numeric(row.replyTweetViewMedian) || 0));
  return { maxMainViews, maxReplyViews };
}

function scoreAiRecommendation(row, assessment, domain, market, scoreContext) {
  const semanticScore = clampScore(assessment?.semanticScore, (numeric(row.similarity) || 0) * 100 || 55);
  const mainViewScore = logScore(row.mainTweetViewMedian, scoreContext.maxMainViews);
  const replyViewScore = logScore(row.replyTweetViewMedian, scoreContext.maxReplyViews);
  const trafficScore = clampScore(mainViewScore * 0.6 + replyViewScore * 0.4, 50);
  const rank = getInfluenceRank(row, domain, market);
  const influenceScore = rank && rank > 0
    ? clampScore((1 - Math.log10(rank) / 5) * 100, 50)
    : 50;
  const soulScore = clampScore(row.soulScore, 50);
  const finalScore = clampScore(
    semanticScore * AI_SCORE_WEIGHTS.semantic +
      trafficScore * AI_SCORE_WEIGHTS.traffic +
      influenceScore * AI_SCORE_WEIGHTS.influence +
      soulScore * AI_SCORE_WEIGHTS.soul,
    semanticScore
  );
  return {
    score: finalScore,
    semanticScore,
    trafficScore,
    influenceScore,
    soulScore,
    weights: AI_SCORE_WEIGHTS,
  };
}

function recommendationReason(row, matchedTerms, domain, lang = "zh") {
  const domainLabel = domain === "AI" ? "AI" : "Web3";
  const summary = shorten(lang === "en" ? row.marketingSummaryEn || row.marketingSummaryCn : row.marketingSummaryCn, 108);
  const keywords = pickLocalizedProfileArray(row, "keywords", "keywordsEn", lang, 12, 64).slice(0, 4);
  const rank = getInfluenceRank(row, domain, row.language === "CN" ? "CN" : "GLOBAL");
  if (matchedTerms.length && summary) {
    return lang === "en"
      ? `Relevant signals include ${matchedTerms.slice(0, 3).join(", ")}. ${summary}`
      : `画像中与本次需求相关的方向包括 ${matchedTerms.slice(0, 3).join("、")}。${summary}`;
  }
  if (summary) return lang === "en" ? `Based on the available content profile: ${summary}` : `根据数据库内容画像：${summary}`;
  if (keywords.length) {
    return lang === "en"
      ? `Content themes include ${keywords.join(", ")}${rank ? `. Current ${domainLabel} influence rank: #${rank}.` : "."}`
      : `数据库已收录其 ${keywords.join("、")} 等内容标签${rank ? `，当前 ${domainLabel} 影响力排名 #${rank}` : ""}。`;
  }
  return rank
    ? (lang === "en" ? `Current ${domainLabel} influence rank: #${rank}. More profile context is still being added.` : `当前 ${domainLabel} 影响力排名 #${rank}；更完整的内容画像仍待数据补充。`)
    : (lang === "en" ? "The account and influence metrics are available. More profile context is still being added." : "当前已收录基础账号与影响力数据，更完整的内容画像仍待数据补充。");
}

function evidenceFor(row, matchedTerms, domain, market, lang = "zh") {
  const evidence = [];
  const domainLabel = domain === "AI" ? "AI" : "Web3";
  const rank = getInfluenceRank(row, domain, market);
  const followers = numeric(row.followers);
  const mainViews = numeric(row.mainTweetViewMedian);
  const replyViews = numeric(row.replyTweetViewMedian);
  if (matchedTerms.length) evidence.push(lang === "en" ? `Matched content signals: ${matchedTerms.slice(0, 3).join(", ")}` : `内容画像命中：${matchedTerms.slice(0, 3).join("、")}`);
  if (rank !== null) evidence.push(lang === "en" ? `${domainLabel} influence rank #${rank}` : `${domainLabel} 影响力排名 #${rank}`);
  if (followers !== null) evidence.push(lang === "en" ? `Followers ${Math.round(followers).toLocaleString("en-US")}` : `粉丝数 ${Math.round(followers).toLocaleString("en-US")}`);
  if (mainViews !== null) evidence.push(lang === "en" ? `Median post views ${Math.round(mainViews).toLocaleString("en-US")}` : `主帖浏览量中位数 ${Math.round(mainViews).toLocaleString("en-US")}`);
  if (replyViews !== null) evidence.push(lang === "en" ? `Median reply views ${Math.round(replyViews).toLocaleString("en-US")}` : `回复浏览量中位数 ${Math.round(replyViews).toLocaleString("en-US")}`);
  if (row.lastActiveAt) evidence.push(lang === "en" ? `Latest original post ${new Date(row.lastActiveAt).toLocaleDateString("en-US")}` : `最近原创内容 ${new Date(row.lastActiveAt).toLocaleDateString("zh-CN")}`);
  if (row.willingnessLevel && row.willingnessLevel !== "unknown") evidence.push(lang === "en" ? `Willingness to collaborate: ${willingnessText(row.willingnessLevel, lang)}` : `接单意愿 ${willingnessText(row.willingnessLevel, lang)}`);
  return evidence.slice(0, 5).map((item) => sanitizePublicText(item, 160, lang));
}

function buildInitial(name, handle) {
  return String(name || handle || "KOL")
    .replace(/[^A-Za-z\u4e00-\u9fff]/g, "")
    .slice(0, 2)
    .toUpperCase() || "KOL";
}

function mapKolProfile(row, context = {}) {
  const domain = context.domain || (Array.isArray(row.domains) && row.domains.includes("AI") ? "AI" : "Web3");
  const market = context.market || row.language || "GLOBAL";
  const lang = context.lang === "en" ? "en" : "zh";
  const briefTerms = context.briefTerms || [];
  const handle = normalizeHandle(row.handle);
  const name = normalizeString(row.name || handle || "未命名 KOL", 120);
  const legacyScore = scoreKol(row, briefTerms, domain, market);
  const assessment = context.assessment || null;
  const scoreBreakdown = context.scoreBreakdown || null;
  const score = scoreBreakdown?.score ?? legacyScore.score;
  const confidence = assessment ? clampScore(55 + assessment.semanticScore * 0.4, legacyScore.confidence) : legacyScore.confidence;
  const matchedTerms = assessment?.matchedTerms?.length ? assessment.matchedTerms : legacyScore.matchedTerms;
  const assessmentReason = assessment?.reason ? sanitizePublicText(assessment.reason, 360, lang) : "";
  const fallbackReasonCn = recommendationReason(row, matchedTerms, domain, "zh");
  const fallbackReasonEn = recommendationReason(row, matchedTerms, domain, "en");
  const reasonCn = lang === "zh" && assessmentReason ? assessmentReason : fallbackReasonCn;
  const reasonEn = lang === "en" && assessmentReason ? assessmentReason : fallbackReasonEn;
  const assessmentEvidence = Array.isArray(assessment?.evidence)
    ? assessment.evidence.map((item) => item.statement).filter(Boolean)
    : [];
  const evidenceCn = assessmentEvidence.length && lang === "zh" ? assessmentEvidence : evidenceFor(row, matchedTerms, domain, market, "zh");
  const evidenceEn = assessmentEvidence.length && lang === "en" ? assessmentEvidence : evidenceFor(row, matchedTerms, domain, market, "en");
  const abilities = domain === "AI" ? row.aiAbilities : row.web3Abilities;
  const capabilityScores = capabilityScoreItems(abilities, market, lang);
  const hasCollaborationRecord = row.collaborationAcceptingNewInvitations === true
    || row.collaborationAcceptingNewInvitations === false
    || Boolean(row.collaborationUpdatedAt)
    || Boolean(row.collaborationSyncedAt)
    || Boolean(row.collaborationSource);
  const keywordsCn = safeArray(row.keywords, 12, 64);
  const keywordsEn = safeArray(row.keywordsEn, 12, 64);
  const marketingGoalsCn = safeArray(row.marketingGoals, 10, 64);
  const marketingGoalsEn = safeArray(row.marketingGoalsEn, 10, 64);
  const displayKeywords = lang === "en" && keywordsEn.length ? keywordsEn : keywordsCn;
  const displayMarketingGoals = lang === "en" && marketingGoalsEn.length ? marketingGoalsEn : marketingGoalsCn;

  return {
    id: String(row.twitterUserId || row.twitter_user_id || ""),
    twitterUserId: String(row.twitterUserId || row.twitter_user_id || ""),
    name,
    handle,
    displayHandle: handle ? `@${handle}` : "",
    avatar: isSafeHttpUrl(row.avatar) ? row.avatar : null,
    initial: buildInitial(name, handle),
    domain,
    market,
    score,
    confidence,
    aiMatchScore: assessment ? assessment.semanticScore : scoreBreakdown?.semanticScore ?? null,
    semanticScore: assessment ? assessment.semanticScore : scoreBreakdown?.semanticScore ?? null,
    dimensions: assessment?.dimensions || null,
    matchedTerms,
    evaluationEvidence: assessment?.evidence || [],
    recommendationScoreBreakdown: scoreBreakdown,
    similarity: numeric(row.similarity),
    followers: numeric(row.followers),
    web3RankGlobal: numeric(row.web3RankGlobal),
    web3RankCn: numeric(row.web3RankCn),
    aiRankGlobal: numeric(row.aiRankGlobal),
    aiRankCn: numeric(row.aiRankCn),
    influenceRank: getInfluenceRank(row, domain, market),
    mainTweetViewMedian: numeric(row.mainTweetViewMedian),
    replyTweetViewMedian: numeric(row.replyTweetViewMedian),
    mainMetricsWindowDays: numeric(row.mainMetricsWindowDays),
    replyMetricsWindowDays: numeric(row.replyMetricsWindowDays),
    soulScore: numeric(row.soulScore),
    willingnessLevel: ["high", "medium", "low", "unknown"].includes(row.willingnessLevel) ? row.willingnessLevel : "unknown",
    willingnessScore: numeric(row.willingnessScore),
    willingnessConfidence: numeric(row.willingnessConfidence),
    willingnessReason: row.willingnessReason || null,
    willingnessEvidence: localizedWillingnessEvidence(row, lang),
    capabilities: capabilityScores.slice(0, 6).map((item) => item.label),
    capabilityScores,
    keywords: displayKeywords,
    keywordsCn,
    keywordsEn,
    cooperationTypes: safeArray(row.cooperationTypes, 10, 64),
    marketingGoals: displayMarketingGoals,
    marketingGoalsCn,
    marketingGoalsEn,
    projectStages: safeArray(row.projectStages, 10, 64),
    topics: localizedSignals(displayKeywords, lang, TOPIC_EN_SIGNALS, domain),
    goals: localizedSignals(displayMarketingGoals, lang, GOAL_EN_SIGNALS, "Campaign collaboration"),
    summaryCn: row.marketingSummaryCn || "",
    summaryEn: row.marketingSummaryEn || row.marketingSummaryCn || "",
    marketingSummaryCn: row.marketingSummaryCn || "",
    marketingSummaryEn: row.marketingSummaryEn || row.marketingSummaryCn || "",
    reason: lang === "en" ? reasonEn : reasonCn,
    reasonCn,
    reasonEn,
    evidence: lang === "en" ? evidenceEn : evidenceCn,
    evidenceCn,
    evidenceEn,
    lastActiveAt: toIso(row.lastActiveAt),
    updatedAt: toIso(row.updatedAt),
    dataUpdatedAt: toIso(row.updatedAt),
    metricsCalculatedAt: toIso(row.metricsCalculatedAt),
    metricsUpdatedAt: toIso(row.metricsCalculatedAt),
    embeddingGeneratedAt: toIso(row.embeddingGeneratedAt),
    collaboration: hasCollaborationRecord ? {
      acceptingNewInvitations: row.collaborationAcceptingNewInvitations === true,
      status: row.collaborationAcceptingNewInvitations === true ? "ACTIVE" : "PAUSED",
      updatedAt: toIso(row.collaborationUpdatedAt),
      syncedAt: toIso(row.collaborationSyncedAt),
      source: row.collaborationSource || null,
    } : null,
  };
}

function buildCompositeQuery({ strategy, projectHandle }) {
  return normalizeString([
    projectHandle ? `项目账号 @${projectHandle}` : "",
    `项目描述：${strategy.projectBrief || strategy.scope?.safeBrief || ""}`,
    `项目类型：${strategy.projectUnderstanding?.projectType || ""}`,
    `营销目标：${strategy.projectUnderstanding?.marketingGoal || ""}`,
    `目标受众：${strategy.projectUnderstanding?.targetAudience || ""}`,
    `理想 KOL：${strategy.projectUnderstanding?.idealKolProfile || ""}`,
    `语义检索：${strategy.semanticQuery || ""}`,
  ].filter(Boolean).join("\n"), 500);
}

function buildTrace({ strategy, filters, candidateTotal, returned, quota, lang = "zh" }) {
  const english = isEnglishUi(lang);
  const chips = buildStrategyChips(filters, lang);
  const finalDetail = quota?.charged === false
    ? (returned > 0
      ? uiText(lang, `名单已生成，本次未消耗次数，今日剩余 ${quota.remaining} 次。`, `The shortlist is ready. This run did not use quota; ${quota.remaining} AI matches remain today.`)
      : uiText(lang, `未匹配到 KOL，本次不消耗次数，今日剩余 ${quota.remaining} 次。`, `No KOLs matched. This run did not use quota; ${quota.remaining} AI matches remain today.`))
    : (quota
      ? uiText(lang, `本次成功消耗 1 次，今日剩余 ${quota.remaining} 次。`, `This run used 1 AI match; ${quota.remaining} remain today.`)
      : uiText(lang, "名单已生成。", "The shortlist is ready."));
  return [
    {
      type: "scope",
      title: uiText(lang, "安全检查完成", "Safety check complete"),
      detail: strategy.scope?.ignoredInstructions?.length
        ? uiText(lang, "已忽略与 KOL 匹配无关或不安全的片段。", "Irrelevant or unsafe fragments were ignored.")
        : uiText(lang, "需求属于 KOL Match 场景。", "The request fits the KOL Match scenario."),
      publicReasoning: uiText(lang, "用户输入已被当作项目 brief 数据处理，不会作为系统指令执行。", "User input is handled as project brief data, not as executable instructions."),
      sources: localizeProgressSources(["scope_gate"], lang),
    },
    {
      type: "project",
      title: uiText(lang, "理解项目与本次活动", "Understand the project and campaign"),
      detail: strategy.projectUnderstanding?.projectType || uiText(lang, "项目需求已解析", "The project brief has been parsed."),
      publicReasoning: strategy.publicReasoning?.[0] || uiText(lang, "已提取项目定位和营销目标。", "Project positioning and marketing goals have been extracted."),
      sources: localizeProgressSources(["projectBrief", "strategy"], lang),
    },
    {
      type: "intent",
      title: uiText(lang, "确认目标 KOL 画像", "Confirm the target KOL profile"),
      detail: strategy.projectUnderstanding?.idealKolProfile || uiText(lang, "已形成目标 KOL 画像", "The target KOL profile is ready."),
      publicReasoning: strategy.publicReasoning?.[1] || uiText(lang, "会优先寻找内容方向和目标受众匹配的 KOL。", "The search will prioritize KOLs whose content direction and audience match the campaign."),
      sources: localizeProgressSources(["strategy", "semanticQuery"], lang),
    },
    {
      type: "filters",
      title: uiText(lang, "应用基础筛选条件", "Apply base filters"),
      detail: chips.join(" · ") || uiText(lang, "无额外硬筛条件", "No additional hard filters"),
      publicReasoning: english
        ? `Explicit hard filters narrow the candidate pool first: ${chips.join(", ") || "semantic recall is the main signal"}.`
        : `先使用明确硬筛条件缩小候选范围：${chips.join("、") || "使用语义召回为主"}。`,
      sources: localizeProgressSources(["hardFilters", "normalizedFilters"], lang),
    },
    {
      type: "candidates",
      title: uiText(lang, "载入候选 KOL 数据", "Load candidate KOL data"),
      detail: uiText(lang, `${candidateTotal || 0} 名候选 KOL 进入排序。`, `${candidateTotal || 0} candidate KOLs entered ranking.`),
      publicReasoning: uiText(lang, "候选数量来自当前数据库检索结果。", "The candidate count comes from the current database retrieval result."),
      sources: localizeProgressSources(["pgvector", "kol_marketing_profile"], lang),
      candidateCount: candidateTotal || 0,
    },
    {
      type: "ranking",
      title: uiText(lang, "整理推荐顺序与理由", "Rank candidates and reasons"),
      detail: uiText(lang, `已生成 ${returned || 0} 名推荐 KOL。`, `${returned || 0} recommended KOLs have been generated.`),
      publicReasoning: uiText(lang, "推荐顺序综合 AI 匹配度、真实流量、影响力和 Soul。", "Ranking combines AI fit, real traffic, influence, and Soul."),
      sources: localizeProgressSources(["similarity", "rank", "results"], lang),
    },
    {
      type: "final",
      title: uiText(lang, "名单生成完成", "Shortlist generation complete"),
      detail: finalDetail,
      publicReasoning: uiText(lang, "最终名单可继续打开详情查看每个 KOL 的内容画像和推荐证据。", "Open each KOL detail to review the content profile and recommendation evidence."),
      sources: localizeProgressSources(["quota", "results"], lang),
    },
  ];
}

function normalizeInternalTwitterAccount(payload) {
  const source = payload?.data?.data || payload?.data?.user || payload?.data || payload?.user || payload?.result || payload;
  if (!source || typeof source !== "object") return null;
  const profile = source.profile && typeof source.profile === "object" ? source.profile : {};
  const feature = source.feature && typeof source.feature === "object" ? source.feature : {};
  const handle = normalizeHandle(
    source.handle ||
      source.username ||
      source.username_raw ||
      source.screen_name ||
      source.userName ||
      profile.username ||
      profile.username_raw
  );
  const twitterId = String(source.twitterId || source.twitter_id || source.id || source.userId || profile.id || "").trim();
  if (!handle && !twitterId) return null;
  const name = normalizeString(source.name || source.displayName || source.display_name || profile.name || handle, 120);
  const avatar = source.avatar || source.profile_image_url || source.profileImageUrl || source.profileImageURL || profile.profile_image_url || null;
  return {
    handle,
    name,
    avatar: isSafeHttpUrl(avatar) ? avatar : null,
    twitterId: twitterId || null,
    initial: buildInitial(name, handle),
    verified: source.verified === true || source.isVerified === true || source.blue_verified === true || profile.verified === true || profile.is_blue_verified === true || false,
    followers: numeric(source.followers || source.followers_count || profile.followers_count),
    following: numeric(source.following || source.following_count || profile.following_count),
    description: normalizeString(source.description || profile.description || "", 280),
    narrative: normalizeLocalizedProfileText(source.narrative || feature.narrative),
    mentionSummary: normalizeMentionSummary(source.mentionSummary || source.mention_summary || feature.mention_summary),
    createdAt: toIso(source.create_time || source.created_at || profile.created_at || profile.first_record),
    recentPosts: normalizeXRecentPosts(
      source.recentPosts ||
        source.recent_posts ||
        source.recentTweets ||
        source.recent_tweets ||
        source.tweets ||
        source.posts ||
        source.statuses ||
        profile.recentPosts ||
        profile.recent_posts
    ),
    source: "internal_twitter_user_lookup",
  };
}

async function lookupInternalTwitterAccount(handle) {
  const url = `${INTERNAL_TWITTER_USER_LOOKUP_URL}?username=${encodeURIComponent(handle)}`;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await axios.get(url, { timeout: INTERNAL_TWITTER_USER_LOOKUP_TIMEOUT_MS });
      return {
        account: normalizeInternalTwitterAccount(response.data),
        error: null,
      };
    } catch (error) {
      if (error.response?.status === 404) {
        return { account: null, error: null };
      }
      lastError = error;
    }
  }

  return {
    account: null,
    error: lastError?.code || "INTERNAL_TWITTER_USER_LOOKUP_FAILED",
  };
}

async function lookupProjectAccount(handle, options = {}) {
  const normalizedHandle = normalizeHandle(handle);
  if (!normalizedHandle) {
    throw publicError("PROJECT_HANDLE_INVALID", 400, "请输入有效的 X 用户名。", { quotaCharged: false });
  }

  const upstream = await lookupInternalTwitterAccount(normalizedHandle);
  if (upstream.account) {
    return {
      ...upstream.account,
      lookupWarning: null,
    };
  }

  if (!upstream.error) {
    return null;
  }

  if (upstream.error && options.failOnUpstreamError) {
    throw publicError("PROJECT_ACCOUNT_LOOKUP_FAILED", 503, "项目 X 账号确认暂时失败，请稍后重试。", {
      lookupWarning: upstream.error,
      quotaCharged: false,
    });
  }

  return null;
}

function getKolSelectSql(options = {}) {
  const lastActiveExpression = options.lastActiveExpression || "activity.last_active_at";
  return `
    k.twitter_user_id AS "twitterUserId",
    lower(ltrim(coalesce(k.handle, u.profile ->> 'username', ''), '@')) AS handle,
    coalesce(k.name, u.name::text, u.profile ->> 'name') AS name,
    k.language,
    k.domains,
    k.followers::double precision AS followers,
    k.ai_rank_global AS "aiRankGlobal",
    k.ai_rank_cn AS "aiRankCn",
    k.web3_rank_global AS "web3RankGlobal",
    k.web3_rank_cn AS "web3RankCn",
    k.main_tweet_view_median::double precision AS "mainTweetViewMedian",
    k.reply_tweet_view_median::double precision AS "replyTweetViewMedian",
    k.main_metrics_window_days::double precision AS "mainMetricsWindowDays",
    k.reply_metrics_window_days::double precision AS "replyMetricsWindowDays",
    k.soul_score::double precision AS "soulScore",
    k.marketing_summary_cn AS "marketingSummaryCn",
    k.marketing_summary_en AS "marketingSummaryEn",
    k.keywords,
    k.keywords_en AS "keywordsEn",
    k.cooperation_types AS "cooperationTypes",
    k.marketing_goals AS "marketingGoals",
    k.marketing_goals_en AS "marketingGoalsEn",
    k.project_stages AS "projectStages",
    k.ai_abilities AS "aiAbilities",
    k.web3_abilities AS "web3Abilities",
    k.willingness_level AS "willingnessLevel",
    k.willingness_score::double precision AS "willingnessScore",
    k.willingness_reason AS "willingnessReason",
    k.willingness_confidence::double precision AS "willingnessConfidence",
    k.willingness_evidence AS "willingnessEvidence",
    k.identity_tier AS "identityTier",
    k.collaboration_accepting_new_invitations AS "collaborationAcceptingNewInvitations",
    k.collaboration_updated_at AS "collaborationUpdatedAt",
    k.collaboration_synced_at AS "collaborationSyncedAt",
    k.collaboration_source AS "collaborationSource",
    k.updated_at AS "updatedAt",
    k.metrics_calculated_at AS "metricsCalculatedAt",
    u.profile ->> 'profile_image_url' AS avatar,
    ${lastActiveExpression} AS "lastActiveAt",
    CASE
      WHEN $domain = 'AI' AND $market = 'CN' THEN k.ai_rank_cn
      WHEN $domain = 'AI' THEN k.ai_rank_global
      WHEN $market = 'CN' THEN k.web3_rank_cn
      ELSE k.web3_rank_global
    END AS "influenceRank"
  `;
}

function getLatestActivityJoinSql(twitterUserIdExpression) {
  return `
    LEFT JOIN LATERAL (
      SELECT t.create_time AS last_active_at
      FROM dev.tweet t
      WHERE t.twitter_user_id = ${twitterUserIdExpression}
        AND t.id = t.conversation_id
        AND t.retweet_id IS NULL
      ORDER BY t.create_time DESC
      LIMIT 1
    ) activity ON true
  `;
}

function getKolLatestActivityJoinSql() {
  return getLatestActivityJoinSql("k.twitter_user_id");
}

function getKolFromJoinSql() {
  return `
    FROM dev.kol_marketing_profile k
    LEFT JOIN dev.twitter_user u ON u.id = k.twitter_user_id
    ${getKolLatestActivityJoinSql()}
  `;
}

function normalizeFilterSearchInput(body = {}, reqOrConfig) {
  const source = body.filters && typeof body.filters === "object" ? body.filters : body;
  const domain = normalizeDomain(source.domain || (Array.isArray(source.domains) ? source.domains[0] : source.domains), "Web3");
  const market = normalizeMarket(source.market || source.language, "GLOBAL");
  const followersMin = followerPresetToMin(source.followers);
  const minFollowers = numeric(source.minFollowers) ?? followersMin ?? 0;
  const maxFollowers = numeric(source.maxFollowers);
  const rankRange = source.rankRange || source.rank;
  const maxRank = numeric(source.maxRank) ?? rankPresetToMax(rankRange);
  const activityDays = numeric(source.activityDays) ?? activityPresetToDays(source.activity);
  const minSoulScore = numeric(source.minSoulScore) ?? numeric(source.soul === "any" ? null : source.soul);
  const rawWillingness = normalizeString(source.willingness || source.willingnessLevel, 32).toLowerCase();
  const willingness = ["high", "medium", "low", "unknown", "exclude-low"].includes(rawWillingness) ? rawWillingness : "any";
  const selectedCapabilities = safeArray(source.capabilities, 12, 64);
  const capabilityGroups = selectedCapabilities
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => CAPABILITY_ALIASES[value.toLowerCase()] || [value])
    .filter((group) => group.length > 0);
  const capabilityMatch = source.capabilityMatch === "all" ? "all" : "any";
  const excludeNonAcceptingCollaboration = source.excludeNonAcceptingCollaboration === true;
  const excludeLowWillingness = source.excludeLowWillingness === true || willingness === "exclude-low";
  const sort = body.sort === "followers" || source.sort === "followers" ? "followers" : "rank";
  const resultLimit = getFilterResultLimit(reqOrConfig);
  const limit = clampInteger(body.limit || source.limit, resultLimit, 1, resultLimit);

  return {
    domain,
    market,
    minFollowers,
    maxFollowers,
    maxRank,
    activityDays,
    minSoulScore,
    willingness,
    capabilityGroups,
    selectedCapabilities,
    capabilityMatch,
    excludeNonAcceptingCollaboration,
    excludeLowWillingness,
    sort,
    limit,
  };
}

function willingnessMinimumToLevels(value) {
  if (value === "high") return ["high"];
  if (value === "medium") return ["medium", "high"];
  if (value === "low") return ["low", "medium", "high"];
  if (value === "unknown") return ["unknown"];
  return [];
}

function excludeLowWillingnessWithCollaborationSql(alias = "k") {
  return `(
    ${alias}.collaboration_accepting_new_invitations IS TRUE
    OR (
      ${alias}.collaboration_accepting_new_invitations IS NULL
      AND coalesce(${alias}.willingness_level, 'unknown') <> 'low'
    )
  )`;
}

async function queryKolProfilesByFilters(filterInput = {}, reqOrConfig) {
  const startedAt = Date.now();
  const filters = normalizeFilterSearchInput(filterInput, reqOrConfig);
  const useActivityFilter = filters.activityDays !== null;
  const clauses = [
    "k.active IS TRUE",
    "$domain = ANY(k.domains)",
    "k.language = $market",
  ];
  const bind = {
    domain: filters.domain,
    market: filters.market,
    minFollowers: filters.minFollowers,
    limit: filters.limit,
  };
  const db = getPostgresReadOnlyInstance();
  const personProfileTypeFilter = getKolMarketingPersonProfileFilterSql("k");
  if (personProfileTypeFilter.clause) {
    clauses.push(personProfileTypeFilter.clause);
    Object.assign(bind, personProfileTypeFilter.bind || {});
  }

  clauses.push("coalesce(k.followers, 0) >= $minFollowers");
  if (filters.maxFollowers !== null) {
    clauses.push("coalesce(k.followers, 0) <= $maxFollowers");
    bind.maxFollowers = filters.maxFollowers;
  }
  const activityWhereClause = "activity.last_active_at >= now() - make_interval(days => $activityDays::integer)";
  if (filters.activityDays !== null) {
    bind.activityDays = Math.min(Math.max(Math.floor(filters.activityDays), 1), 365);
  }
  if (filters.excludeLowWillingness === true) {
    clauses.push(excludeLowWillingnessWithCollaborationSql("k"));
  } else {
    const willingnessLevels = willingnessMinimumToLevels(filters.willingness);
    if (willingnessLevels.length > 0) {
      clauses.push("k.willingness_level = ANY($willingnessLevels::text[])");
      bind.willingnessLevels = willingnessLevels;
    }
  }
  if (filters.excludeNonAcceptingCollaboration === true) {
    // 只排除用户主动关闭接单的 KOL；未设置 collaboration 的历史画像仍保留。
    clauses.push("k.collaboration_accepting_new_invitations IS DISTINCT FROM false");
  }
  if (filters.maxRank !== null) {
    clauses.push(`coalesce(
      CASE
        WHEN $domain = 'AI' AND $market = 'CN' THEN k.ai_rank_cn
        WHEN $domain = 'AI' THEN k.ai_rank_global
        WHEN $market = 'CN' THEN k.web3_rank_cn
        ELSE k.web3_rank_global
      END,
      2147483647
    ) <= $maxRank`);
    bind.maxRank = Math.floor(filters.maxRank);
  }
  if (filters.minSoulScore !== null) {
    clauses.push("coalesce(k.soul_score, 0) >= $minSoulScore");
    bind.minSoulScore = Math.floor(filters.minSoulScore);
  }

  if (filters.capabilityGroups.length > 0) {
    const abilityFields = `coalesce(
      CASE
        WHEN $market = 'CN' THEN coalesce(
          (CASE WHEN $domain = 'AI' THEN k.ai_abilities ELSE k.web3_abilities END) -> 'cn' -> 'fields',
          (CASE WHEN $domain = 'AI' THEN k.ai_abilities ELSE k.web3_abilities END) -> 'en' -> 'fields'
        )
        ELSE coalesce(
          (CASE WHEN $domain = 'AI' THEN k.ai_abilities ELSE k.web3_abilities END) -> 'en' -> 'fields',
          (CASE WHEN $domain = 'AI' THEN k.ai_abilities ELSE k.web3_abilities END) -> 'cn' -> 'fields'
        )
      END,
      '[]'::jsonb
    )`;

    if (filters.capabilityMatch === "any") {
      bind.capabilityAny = [...new Set(filters.capabilityGroups.flat())];
      clauses.push(`EXISTS (
        SELECT 1
        FROM jsonb_array_elements(${abilityFields}) AS ability
        WHERE ability ?| $capabilityAny::text[]
      )`);
    } else {
      filters.capabilityGroups.forEach((group, index) => {
        const key = `capabilityGroup${index}`;
        bind[key] = group;
        clauses.push(`EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${abilityFields}) AS ability
          WHERE ability ?| $${key}::text[]
        )`);
      });
    }
  }

  const orderBy = filters.sort === "followers"
    ? 'k.followers DESC NULLS LAST, "influenceRank" ASC NULLS LAST'
    : '"influenceRank" ASC NULLS LAST, k.followers DESC NULLS LAST';
  const activeOrderBy = filters.sort === "followers"
    ? 'followers DESC NULLS LAST, "influenceRank" ASC NULLS LAST'
    : '"influenceRank" ASC NULLS LAST, followers DESC NULLS LAST';
  const influenceRankSql = `CASE
        WHEN $domain = 'AI' AND $market = 'CN' THEN k.ai_rank_cn
        WHEN $domain = 'AI' THEN k.ai_rank_global
        WHEN $market = 'CN' THEN k.web3_rank_cn
        ELSE k.web3_rank_global
      END`;
  const scanLimit = Math.max(filters.limit, Math.min(5000, getFilterCandidateScanLimit(reqOrConfig)));
  if (useActivityFilter) bind.scanLimit = scanLimit;
  // Keep the first statement narrow so PostgreSQL does not spend the 1.5s
  // read-replica timeout materializing wide JSON/text profile columns before LIMIT.
  // When activity is requested, rank a bounded candidate window first, then run the
  // per-account latest-tweet lookup only inside that window.
  const candidateSql = useActivityFilter
    ? `
    WITH base AS MATERIALIZED (
      SELECT
        k.twitter_user_id::text AS "twitterUserId",
        k.followers,
        ${influenceRankSql} AS "influenceRank"
      FROM dev.kol_marketing_profile k
      WHERE ${clauses.join("\n        AND ")}
      ORDER BY ${orderBy}
      LIMIT $scanLimit
    ),
    active_base AS MATERIALIZED (
      SELECT
        base."twitterUserId",
        base.followers,
        base."influenceRank",
        activity.last_active_at AS "lastActiveAt"
      FROM base
      ${getLatestActivityJoinSql('base."twitterUserId"')}
      WHERE ${activityWhereClause}
    )
    SELECT
      active_base.*,
      count(*) over()::integer AS "candidateTotal"
    FROM active_base
    ORDER BY ${activeOrderBy}
    LIMIT $limit
  `
    : `
    SELECT
      k.twitter_user_id::text AS "twitterUserId",
      k.followers,
      ${influenceRankSql} AS "influenceRank",
      count(*) over()::integer AS "candidateTotal"
    FROM dev.kol_marketing_profile k
    WHERE ${clauses.join("\n      AND ")}
    ORDER BY ${orderBy}
    LIMIT $limit
  `;

  const candidateRows = await db.query(candidateSql, { bind, type: QueryTypes.SELECT });
  if (candidateRows.length === 0) {
    return {
      rows: [],
      filters,
      candidateTotal: 0,
      candidateScanLimit: useActivityFilter ? scanLimit : null,
      dbCostMs: Date.now() - startedAt,
    };
  }

  const detailBind = {
    domain: filters.domain,
    market: filters.market,
    twitterUserIds: candidateRows.map((row) => String(row.twitterUserId || "")),
    resultOrders: candidateRows.map((_, index) => index + 1),
    candidateTotal: candidateRows[0]?.candidateTotal || candidateRows.length,
  };
  if (useActivityFilter) {
    detailBind.lastActiveAts = candidateRows.map((row) => row.lastActiveAt || null);
  }

  const rankedCte = useActivityFilter
    ? `
    WITH ranked AS (
      SELECT *
      FROM unnest(
        $twitterUserIds::text[],
        $resultOrders::int[],
        $lastActiveAts::timestamptz[]
      ) AS r(twitter_user_id, result_order, last_active_at)
    )
  `
    : `
    WITH ranked AS (
      SELECT *
      FROM unnest(
        $twitterUserIds::text[],
        $resultOrders::int[]
      ) AS r(twitter_user_id, result_order)
    )
  `;
  const finalActivityJoinSql = useActivityFilter ? "" : getKolLatestActivityJoinSql();
  const lastActiveExpression = useActivityFilter ? "ranked.last_active_at" : "activity.last_active_at";
  const detailSql = `
    ${rankedCte}
    SELECT
      ${getKolSelectSql({ lastActiveExpression })},
      $candidateTotal::integer AS "candidateTotal"
    FROM ranked
    JOIN dev.kol_marketing_profile k ON k.twitter_user_id::text = ranked.twitter_user_id
    LEFT JOIN dev.twitter_user u ON u.id = k.twitter_user_id
    ${finalActivityJoinSql}
    ORDER BY ranked.result_order
  `;

  const rows = await db.query(detailSql, { bind: detailBind, type: QueryTypes.SELECT });
  return {
    rows,
    filters,
    candidateTotal: detailBind.candidateTotal,
    candidateScanLimit: useActivityFilter ? scanLimit : null,
    dbCostMs: Date.now() - startedAt,
  };
}

async function queryKolProfileByHandle(handle, filterInput = {}) {
  const normalizedHandle = normalizeHandle(handle);
  if (!normalizedHandle) throw publicError("KOL_HANDLE_INVALID", 400, "请输入有效的 X 用户名。", { quotaCharged: false });
  const filters = normalizeFilterSearchInput(filterInput);
  const db = getPostgresReadOnlyInstance();
  const personProfileTypeFilter = getKolMarketingPersonProfileFilterSql("k");
  const personProfileTypeClause = personProfileTypeFilter.clause ? `
      AND ${personProfileTypeFilter.clause}` : "";
  const sql = `
    SELECT ${getKolSelectSql()}
    ${getKolFromJoinSql()}
    WHERE k.active IS TRUE
      AND lower(ltrim(coalesce(k.handle, u.profile ->> 'username', ''), '@')) = $handle
      AND $domain = ANY(k.domains)
      AND k.language = $market${personProfileTypeClause}
    LIMIT 1
  `;
  const [row] = await db.query(sql, {
    bind: {
      handle: normalizedHandle,
      domain: filters.domain,
      market: filters.market,
      ...(personProfileTypeFilter.bind || {}),
    },
    type: QueryTypes.SELECT,
  });
  return row || null;
}

async function queryKolProfileByTwitterUserId(twitterUserId, filterInput = {}) {
  const normalizedId = normalizeTwitterUserId(twitterUserId);
  if (!normalizedId) throw publicError("KOL_ID_INVALID", 400, "KOL ID 不合法。", { quotaCharged: false });
  const filters = normalizeFilterSearchInput(filterInput);
  const db = getPostgresReadOnlyInstance();
  const personProfileTypeFilter = getKolMarketingPersonProfileFilterSql("k");
  const personProfileTypeClause = personProfileTypeFilter.clause ? `
      AND ${personProfileTypeFilter.clause}` : "";
  const sql = `
    SELECT ${getKolSelectSql()}
    ${getKolFromJoinSql()}
    WHERE k.active IS TRUE
      AND k.twitter_user_id::text = $twitterUserId${personProfileTypeClause}
    LIMIT 1
  `;
  const [row] = await db.query(sql, {
    bind: {
      twitterUserId: normalizedId,
      domain: filters.domain,
      market: filters.market,
      ...(personProfileTypeFilter.bind || {}),
    },
    type: QueryTypes.SELECT,
  });
  return row || null;
}

async function resolveStrategyForAiSearch(req, body, emitProgress, lang = "zh") {
  const strategyId = normalizeString(body.strategyId, 80);
  const stored = strategyId ? await loadStoredStrategy(req, strategyId) : null;
  if (stored && normalizeUiLang(stored.lang) === normalizeUiLang(lang)) return stored;

  if (strategyId || stored) {
    await emitProgress?.({
      stage: "strategy",
      status: "running",
      title: uiText(lang, "重新生成搜索策略", "Regenerate search strategy"),
      message: uiText(lang, "未找到同语言的已确认策略，正在根据当前项目需求重新生成。", "No confirmed strategy was found for this language, so a new one is being generated from the current brief."),
    });
  }
  return generateKolMatchStrategy(body, req);
}

async function runAiMatch(req, body = {}, emitProgress, options = {}) {
  const requestId = getRequestId(req);
  const startedAt = Date.now();
  // AI Match 最终展示数量由运行时配置统一控制，避免前端历史默认值（例如 20）
  // 把已深评/已排序的候选名单再次截短。
  const requestedLimit = getAiResultLimit(req);
  const idempotencyKey = normalizeIdempotencyKey(body.idempotencyKey);
  const isClientClosed = options.isClientClosed;
  const lang = normalizeUiLang(body.lang, req?.query?.lang, req?.headers?.["x-language"], req?.headers?.["accept-language"]);

  throwIfClientClosed(isClientClosed);
  const cached = await readIdempotentResult(req, AI_QUOTA_BUCKET, idempotencyKey);
  if (cached && normalizeUiLang(cached.meta?.lang) === lang) {
    await emitProgress?.({
      stage: "final",
      status: "done",
      title: uiText(lang, "已命中重复请求缓存", "Reused cached result"),
      message: uiText(lang, "本次返回已生成过的名单，不重复扣减额度。", "This returns a previously generated shortlist without charging quota again."),
    });
    return cached;
  }

  throwIfClientClosed(isClientClosed);
  await emitProgress?.({
    stage: "scope_check",
    status: "running",
    title: uiText(lang, "检查需求范围", "Check request scope"),
    message: uiText(lang, "正在确认输入是否属于 KOL Match 场景。", "Checking whether the input belongs to the KOL Match scenario."),
  });
  const strategy = await resolveStrategyForAiSearch(req, body, emitProgress, lang);
  throwIfClientClosed(isClientClosed);
  await emitProgress?.({
    stage: "scope_check",
    status: "done",
    title: uiText(lang, "需求范围已确认", "Request scope confirmed"),
    message: strategy.scope?.ignoredInstructions?.length
      ? uiText(lang, "已忽略与 KOL 匹配无关或不安全的片段。", "Irrelevant or unsafe fragments were ignored.")
      : uiText(lang, "需求已通过安全检查。", "The request passed the safety check."),
    metrics: {
      reasonCode: strategy.scope?.reasonCode,
      ignoredInstructions: strategy.scope?.ignoredInstructions?.length || 0,
    },
  });

  await emitProgress?.({
    stage: "quota_checked",
    status: "running",
    title: uiText(lang, "检查今日额度", "Check today's quota"),
    message: uiText(lang, "正在检查 AI 精准匹配剩余次数。", "Checking remaining AI match quota."),
  });
  const quotaBefore = await ensureQuotaAvailable(req, AI_QUOTA_BUCKET);
  throwIfClientClosed(isClientClosed);
  await emitProgress?.({
    stage: "quota_checked",
    status: "done",
    title: uiText(lang, "今日额度可用", "Today's quota is available"),
    message: uiText(lang, `AI 精准匹配今日剩余 ${quotaBefore.remaining} 次。`, `${quotaBefore.remaining} AI matches remain today.`),
    metrics: quotaBefore,
  });

  let projectAccount = null;
  const projectHandle = normalizeHandle(body.projectHandle || strategy.projectHandle);
  if (projectHandle) {
    await emitProgress?.({
      stage: "twitter_user_lookup",
      status: "running",
      title: uiText(lang, "验证项目 X 账号", "Verify project X account"),
      message: uiText(lang, `正在通过后端内部用户查询确认 @${projectHandle}。`, `Confirming @${projectHandle} through the internal user lookup.`),
      sources: localizeProgressSources(["projectHandle"], lang),
    });
    throwIfClientClosed(isClientClosed);
    projectAccount = await lookupProjectAccount(projectHandle, { failOnUpstreamError: true });
    if (!projectAccount) {
      throw publicError("PROJECT_ACCOUNT_NOT_FOUND", 404, "没有找到这个项目 X 账号，请检查用户名后重试。", {
        quotaCharged: false,
      });
    }
    throwIfClientClosed(isClientClosed);
    await emitProgress?.({
      stage: "twitter_user_lookup",
      status: projectAccount ? "done" : "skipped",
      title: projectAccount
        ? uiText(lang, "项目 X 账号已确认", "Project X account confirmed")
        : uiText(lang, "项目 X 账号未确认，继续使用 brief", "Project X account not confirmed; continuing with the brief"),
      message: projectAccount
        ? uiText(lang, `已确认 @${projectAccount.handle}。`, `Confirmed @${projectAccount.handle}.`)
        : uiText(lang, "后端内部用户查询未命中，本次继续根据项目描述匹配。", "The internal lookup did not find the account, so this run continues with the project brief."),
      metrics: projectAccount ? { source: projectAccount.source, lookupWarning: projectAccount.lookupWarning || null } : undefined,
      sources: localizeProgressSources(["internal_twitter_user_lookup"], lang),
    });
  }

  await emitProgress?.({
    stage: "strategy",
    status: "done",
    title: uiText(lang, "搜索策略已生成", "Search strategy generated"),
    message: strategy.projectUnderstanding?.idealKolProfile || uiText(lang, "已生成目标 KOL 画像。", "The target KOL profile has been generated."),
    metrics: {
      strategyId: strategy.strategyId,
      filters: strategy.filters,
      source: strategy.filterPlan?.source,
    },
  });
  for (const reasoning of strategy.publicReasoning || []) {
    await emitProgress?.({
      type: "reasoning",
      stage: "strategy",
      delta: sanitizePublicText(reasoning, 500, lang),
    });
  }

  const hardFilters = normalizeProductHardFilters(body.hardFilters || body.filters || {});
  const filters = getAiSearchSqlFilters(strategy.filters, hardFilters);
  const compositeQuery = buildCompositeQuery({ strategy, projectHandle });
  const briefTerms = extractBriefTerms(`${strategy.projectBrief || ""} ${strategy.semanticQuery || ""}`);

  throwIfClientClosed(isClientClosed);
  const recallTopK = getAiRecallTopK(req);
  const searchResult = await searchKolMarketingProfiles({
    query: compositeQuery,
    filters,
    limit: recallTopK,
    redisClient: req.redisClient,
    skipAutoFilterExtraction: true,
    isAborted: isClientClosed,
    onProgress: async (event) => {
      const stageMap = {
        search_plan: "strategy",
        embedding: "embedding",
        db_search: "db_search",
      };
      await emitProgress?.({
        stage: stageMap[event.stage] || event.stage,
        status: event.status,
        title: searchProgressTitle(event.stage, lang),
        message: searchProgressMessage(event, lang),
        metrics: {
          filters: event.filters,
          semanticQuery: event.semanticQuery,
          embeddingModel: event.embeddingModel,
          embeddingCacheHit: event.embeddingCacheHit,
          resultCount: event.resultCount,
          candidateTotal: event.candidateTotal,
          dbCostMs: event.dbCostMs,
          searchMode: event.searchMode,
        },
      });
    },
  });

  throwIfClientClosed(isClientClosed);
  await emitProgress?.({
    stage: "candidate_evaluation",
    status: "running",
    title: uiText(lang, "深评召回候选", "Evaluate recalled candidates"),
    message: uiText(lang, "正在对 Embedding 召回候选进行语义匹配深评。", "Evaluating semantic fit for the candidates recalled by embeddings."),
    metrics: { recalledCount: searchResult.items.length, evaluatorEnabled: isEvaluatorLlmEnabled(req) },
  });
  const evaluation = await evaluateAiMatchCandidates({
    req,
    strategy,
    rows: searchResult.items,
    filters,
    briefTerms,
    lang,
  });
  throwIfClientClosed(isClientClosed);
  await emitProgress?.({
    stage: "candidate_evaluation",
    status: "done",
    title: uiText(lang, "候选深评完成", "Candidate evaluation complete"),
    message: evaluation.meta.fallback
      ? uiText(lang, "已使用 Embedding 相似度作为语义匹配代理信号。", "Used embedding similarity as the semantic-fit proxy.")
      : uiText(lang, "已完成候选 KOL 的 AI 语义匹配深评。", "AI semantic evaluation is complete for recalled KOLs."),
    metrics: evaluation.meta,
  });

  throwIfClientClosed(isClientClosed);
  await emitProgress?.({
    stage: "ranking",
    status: "running",
    title: uiText(lang, "整理推荐顺序与理由", "Rank candidates and reasons"),
    message: uiText(lang, "正在综合 AI 匹配度、真实流量、影响力和 Soul 生成推荐名单。", "Ranking recommendations by AI fit, real traffic, influence, and Soul."),
  });

  const domainForScore = filters.domains?.[0] || "Web3";
  const marketForScore = filters.language || "GLOBAL";
  const scoreContext = buildScoreContext(searchResult.items, domainForScore, marketForScore);
  const rankedItems = searchResult.items
    .map((row) => {
      const candidateId = String(row.twitterUserId || row.id || row.handle || "");
      const assessment = evaluation.assessmentsById.get(candidateId) || buildProxyAssessment(row, briefTerms, domainForScore, marketForScore, lang);
      const scoreBreakdown = scoreAiRecommendation(row, assessment, domainForScore, marketForScore, scoreContext);
      return mapKolProfile(row, {
        domain: domainForScore,
        market: marketForScore,
        lang: body.lang,
        briefTerms,
        assessment,
        scoreBreakdown,
      });
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.aiMatchScore || 0) - (a.aiMatchScore || 0) || (a.influenceRank ?? Number.MAX_SAFE_INTEGER) - (b.influenceRank ?? Number.MAX_SAFE_INTEGER));
  const items = rankedItems.slice(0, requestedLimit);
  const candidateTotal = searchResult.items[0]?.candidateTotal || searchResult.items.length;

  await emitProgress?.({
    stage: "ranking",
    status: "done",
    title: uiText(lang, "推荐顺序已整理", "Recommendation order is ready"),
    message: uiText(lang, `已生成 ${items.length} 名推荐 KOL。`, `${items.length} recommended KOLs have been generated.`),
    metrics: { returned: items.length, candidateTotal },
  });
  await emitProgress?.({
    type: "reasoning",
    stage: "ranking",
    delta: sanitizePublicText(
      uiText(
        lang,
        `候选集共 ${candidateTotal} 人，Embedding 召回 ${searchResult.items.length} 人，最终按 AI 匹配度、真实流量、影响力和 Soul 排序。`,
        `The candidate pool contains ${candidateTotal} KOLs; embeddings recalled ${searchResult.items.length}. Final ranking uses AI fit, real traffic, influence, and Soul.`
      ),
      500,
      lang
    ),
  });

  if (items.length === 0) {
    console.warn("[EchoHunt KOL Match] AI search returned empty result, quota not charged", {
      requestId,
      authCenterUserId: getAuthCenterUserId(req),
      strategyId: strategy.strategyId,
      filters: searchResult.filters,
      inputFilters: searchResult.inputFilters,
      derivedFilters: searchResult.derivedFilters,
      filterPlan: searchResult.filterPlan,
      searchMode: searchResult.searchMode,
      candidateTotal,
      dbCostMs: searchResult.dbCostMs,
    });
  }

  throwIfClientClosed(isClientClosed);
  const quota = items.length === 0
    ? buildNoChargeQuota(AI_QUOTA_BUCKET, quotaBefore, req)
    : await consumeQuota(req, AI_QUOTA_BUCKET);
  const data = {
    mode: "ai",
    strategyId: strategy.strategyId,
    projectAccount,
    projectUnderstanding: strategy.projectUnderstanding,
    semanticQuery: searchResult.semanticQuery,
    filters: searchResult.filters,
    inputFilters: searchResult.inputFilters,
    derivedFilters: searchResult.derivedFilters,
    filterReasons: searchResult.filterReasons,
    filterPlan: searchResult.filterPlan,
    items,
    meta: {
      candidateTotal,
      returned: items.length,
      limit: requestedLimit,
      recallTopK,
      recalledCount: searchResult.items.length,
      searchMode: searchResult.searchMode,
      evaluation: evaluation.meta,
      scoreWeights: AI_SCORE_WEIGHTS,
      dbCostMs: searchResult.dbCostMs,
      totalCostMs: Date.now() - startedAt,
      embeddingModel: searchResult.embeddingModel,
      embeddingCacheHit: searchResult.embeddingCacheHit,
      quota,
      lang,
      generatedAt: new Date().toISOString(),
      requestId,
      ...getKolMatchRuntimeMeta(req),
    },
    quota,
    trace: buildTrace({ strategy, filters: searchResult.filters, candidateTotal, returned: items.length, quota, lang }),
  };

  throwIfClientClosed(isClientClosed);
  await writeIdempotentResult(req, AI_QUOTA_BUCKET, idempotencyKey, data);
  return data;
}

function normalizeSseProgress(event = {}, lang = "zh") {
  if (event.type === "reasoning") {
    return {
      stage: event.stage || "strategy",
      delta: sanitizePublicText(event.delta, 500, lang),
    };
  }
  return {
    stage: event.stage || "unknown",
    status: event.status || "running",
    title: sanitizePublicText(event.title || event.stage || uiText(lang, "处理进度", "Processing"), 120, lang),
    message: sanitizePublicText(event.message || "", 300, lang),
    publicReasoning: sanitizePublicText(event.publicReasoning || "", 500, lang),
    sources: localizeProgressSources(event.sources || [], lang),
    metrics: event.metrics || undefined,
  };
}

router.use(authenticateAuthCenterToken());
router.use(requireKolMatchVip);
router.use(resolveEchohuntAppEnv);
router.use(resolveKolMatchRuntimeConfig);

const quotaHandler = async (req, res) => {
  try {
    const data = await getQuotaSnapshot(req);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, "KOL_MATCH_QUOTA_FAILED");
  }
};

const projectAccountLookupHandler = async (req, res) => {
  try {
    const handle = normalizeHandle(req.query.handle);
    const account = await lookupProjectAccount(handle, { failOnUpstreamError: true });
    if (!account) {
      return res.status(404).json({
        success: false,
        error: "PROJECT_ACCOUNT_NOT_FOUND",
        message: "没有找到这个项目 X 账号，请检查用户名后重试。",
        data: { quotaCharged: false },
      });
    }
    return res.json({ success: true, data: account });
  } catch (error) {
    return sendError(res, error, "PROJECT_ACCOUNT_LOOKUP_FAILED");
  }
};

const strategyHandler = async (req, res) => {
  const startedAt = Date.now();
  try {
    const data = await generateKolMatchStrategy(req.body || {}, req);
    const quota = await getQuotaSnapshot(req);
    return res.json({
      success: true,
      data: {
        ...data,
        costPreview: {
          bucket: AI_QUOTA_BUCKET,
          cost: 1,
          remainingBefore: quota.aiMatch.remaining,
        },
        totalCostMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    return sendError(res, error, "KOL_MATCH_STRATEGY_FAILED");
  }
};

const aiSearchHandler = async (req, res) => {
  const configError = getAiServiceConfigError();
  if (configError) {
    return sendError(res, publicError("KOL_MATCH_SERVICE_UNAVAILABLE", 503, "KOL Match 服务暂不可用，请稍后再试。", { reason: configError }));
  }

  try {
    const data = await runAiMatch(req, req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    if (isConfigError(error)) {
      return sendError(res, publicError("KOL_MATCH_SERVICE_UNAVAILABLE", 503, "KOL Match 服务暂不可用，请稍后再试。"));
    }
    return sendError(res, error, "KOL_MATCH_AI_SEARCH_FAILED");
  }
};

const aiSearchStreamHandler = async (req, res) => {
  const configError = getAiServiceConfigError();
  const lang = normalizeUiLang(req.body?.lang, req.query?.lang, req.headers?.["x-language"], req.headers?.["accept-language"]);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  const heartbeat = setInterval(() => {
    if (closed) return;
    try {
      writeSseHeartbeat(res);
    } catch {
      closed = true;
    }
  }, 15000);

  const emit = async (event) => {
    if (closed) return;
    if (event?.type === "reasoning") {
      writeSse(res, "reasoning", normalizeSseProgress(event, lang));
      return;
    }
    writeSse(res, "progress", normalizeSseProgress(event, lang));
  };

  try {
    if (configError) {
      throw publicError("KOL_MATCH_SERVICE_UNAVAILABLE", 503, "KOL Match 服务暂不可用，请稍后再试。", { reason: configError });
    }
    const data = await runAiMatch(req, req.body || {}, emit, {
      isClientClosed: () => closed,
    });
    if (!closed) writeSse(res, "final", { success: true, data });
  } catch (error) {
    const status = error.status || (isConfigError(error) ? 503 : 500);
    const code = error.code || error.message || "KOL_MATCH_AI_SEARCH_FAILED";
    const message = error.publicMessage || (status >= 500
      ? uiText(lang, "KOL 匹配失败，请稍后重试。", "KOL matching failed. Please try again later.")
      : uiText(lang, "请求参数不符合要求，请检查后重试。", "The request parameters are invalid. Please check and try again."));
    console.warn("[EchoHunt KOL Match] stream failed", {
      requestId: getRequestId(req),
      authCenterUserId: getAuthCenterUserId(req),
      code,
      status,
      quotaCharged: false,
    });
    if (!closed) {
      writeSse(res, "error", {
        success: false,
        error: code,
        message,
        data: {
          ...(error.data || {}),
          quotaCharged: false,
          quotaRefunded: false,
        },
      });
    }
  } finally {
    clearInterval(heartbeat);
    if (!closed) res.end();
  }
};

const filterSearchHandler = async (req, res) => {
  const configError = getPgServiceConfigError();
  if (configError) {
    return sendError(res, publicError("KOL_MATCH_SERVICE_UNAVAILABLE", 503, "KOL Match 服务暂不可用，请稍后再试。", { reason: configError }));
  }

  const idempotencyKey = normalizeIdempotencyKey(req.body?.idempotencyKey);
  try {
    const cached = await readIdempotentResult(req, FILTER_QUOTA_BUCKET, idempotencyKey);
    if (cached) return res.json({ success: true, data: cached });

    const quotaBefore = await ensureQuotaAvailable(req, FILTER_QUOTA_BUCKET);
    const startedAt = Date.now();
    const queryResult = await queryKolProfilesByFilters(req.body || {}, req);
    const briefTerms = [];
    const items = queryResult.rows.map((row) => mapKolProfile(row, {
      domain: queryResult.filters.domain,
      market: queryResult.filters.market,
      lang: req.body?.lang,
      briefTerms,
    }));
    if (items.length === 0) {
      console.warn("[EchoHunt KOL Match] filter search returned empty result, quota not charged", {
        requestId: getRequestId(req),
        authCenterUserId: getAuthCenterUserId(req),
        filters: queryResult.filters,
        candidateTotal: queryResult.candidateTotal,
        dbCostMs: queryResult.dbCostMs,
      });
    }
    const quota = items.length === 0
      ? buildNoChargeQuota(FILTER_QUOTA_BUCKET, quotaBefore, req)
      : await consumeQuota(req, FILTER_QUOTA_BUCKET);
    const data = {
      mode: "filter",
      items,
      meta: {
        candidateTotal: queryResult.candidateTotal,
        returned: items.length,
        limit: queryResult.filters.limit,
        filters: queryResult.filters,
        sort: queryResult.filters.sort,
        candidateScanLimit: queryResult.candidateScanLimit,
        dbCostMs: queryResult.dbCostMs,
        totalCostMs: Date.now() - startedAt,
        quota,
        generatedAt: new Date().toISOString(),
        requestId: getRequestId(req),
        ...getKolMatchRuntimeMeta(req),
      },
      quota,
    };
    await writeIdempotentResult(req, FILTER_QUOTA_BUCKET, idempotencyKey, data);
    return res.json({ success: true, data });
  } catch (error) {
    const normalizedError = normalizeKolMatchError(error, "KOL_MATCH_FILTER_SEARCH_FAILED");
    let normalizedFilters = null;
    try {
      normalizedFilters = normalizeFilterSearchInput(req.body || {}, req);
    } catch (normalizeError) {
      normalizedFilters = { error: normalizeError.message };
    }
    logKolMatchError("[EchoHunt KOL Match] filter search failed", req, normalizedError, {
      filters: normalizedFilters,
    });
    return sendError(res, normalizedError, "KOL_MATCH_FILTER_SEARCH_FAILED");
  }
};

const kolsLookupHandler = async (req, res) => {
  const configError = getPgServiceConfigError();
  if (configError) {
    return sendError(res, publicError("KOL_MATCH_SERVICE_UNAVAILABLE", 503, "KOL Match 服务暂不可用，请稍后再试。", { reason: configError }));
  }

  try {
    const row = await queryKolProfileByHandle(req.query.handle, {
      filters: {
        domain: req.query.domain,
        market: req.query.market,
      },
      limit: 1,
    });
    if (!row) {
      return res.status(404).json({
        success: false,
        error: "KOL_NOT_FOUND",
        message: "没有找到这个 KOL，请检查用户名或调整领域/市场后重试。",
        data: { quotaCharged: false },
      });
    }
    const domain = normalizeDomain(req.query.domain, Array.isArray(row.domains) && row.domains.includes("AI") ? "AI" : "Web3");
    const market = normalizeMarket(req.query.market || row.language, row.language || "GLOBAL");
    return res.json({
      success: true,
      data: mapKolProfile(row, { domain, market, lang: req.query.lang, briefTerms: [] }),
    });
  } catch (error) {
    return sendError(res, error, "KOL_LOOKUP_FAILED");
  }
};

const kolsDetailHandler = async (req, res) => {
  const configError = getPgServiceConfigError();
  if (configError) {
    return sendError(res, publicError("KOL_MATCH_SERVICE_UNAVAILABLE", 503, "KOL Match 服务暂不可用，请稍后再试。", { reason: configError }));
  }

  try {
    const row = await queryKolProfileByTwitterUserId(req.params.twitterUserId, {
      filters: {
        domain: req.query.domain,
        market: req.query.market,
      },
      limit: 1,
    });
    if (!row) {
      return res.status(404).json({
        success: false,
        error: "KOL_NOT_FOUND",
        message: "没有找到这个 KOL。",
        data: { quotaCharged: false },
      });
    }
    const domain = normalizeDomain(req.query.domain, Array.isArray(row.domains) && row.domains.includes("AI") ? "AI" : "Web3");
    const market = normalizeMarket(req.query.market || row.language, row.language || "GLOBAL");
    return res.json({
      success: true,
      data: mapKolProfile(row, { domain, market, lang: req.query.lang, briefTerms: [] }),
    });
  } catch (error) {
    return sendError(res, error, "KOL_DETAIL_FAILED");
  }
};

router.get("/quota", dispatchByEchohuntEnv("quota", quotaHandler));
router.get("/project-account/lookup", dispatchByEchohuntEnv("project-account-lookup", projectAccountLookupHandler));
router.post("/strategy", dispatchByEchohuntEnv("strategy", strategyHandler));
router.post("/ai-search", dispatchByEchohuntEnv("ai-search", aiSearchHandler));
router.post("/ai-search/stream", dispatchByEchohuntEnv("ai-search-stream", aiSearchStreamHandler));
router.post("/filter-search", dispatchByEchohuntEnv("filter-search", filterSearchHandler));
router.get("/kols/lookup", dispatchByEchohuntEnv("kols-lookup", kolsLookupHandler));
router.get("/kols/:twitterUserId", dispatchByEchohuntEnv("kols-detail", kolsDetailHandler));

module.exports = router;
