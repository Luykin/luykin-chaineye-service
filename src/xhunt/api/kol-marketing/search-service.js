const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { getPostgresReadOnlyInstance } = require("../../../infra/k8s/postgres-readonly");
const { structuredChat } = require("../../../lib/llm");
const {
  getConfiguredEmbeddingModel,
  getQueryEmbedding,
  normalizeQueryText,
} = require("../../../services/vector-search/embedding-service");
const {
  clampLimit,
  normalizeNonNegativeInteger,
  normalizeString,
  normalizeStringArray,
  vectorToPgLiteral,
} = require("../../../services/vector-search/pgvector-utils");

// Redis embedding 缓存命名空间，避免和其他业务搜索词缓存互相污染。
const EMBEDDING_NAMESPACE = "kol_marketing_profile";

// dev.kol_marketing_profile.marketing_profile_embedding 当前是 vector(1536)。
const EMBEDDING_DIMENSIONS = 1536;

// 默认返回 200 条，最大 600 条；KOL Match AI 会默认召回并深评 600 个候选。
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 600;

// 环境变量优先级：新 KOL 画像专用配置 > 历史 KOL_SEARCH 配置 > VECTOR_SEARCH 通用配置。
const EMBEDDING_ENV_PREFIXES = ["KOL_MARKETING_PROFILE", "KOL_SEARCH"];

// KOL Match 只展示个人 KOL，过滤项目方账号。
const PERSON_PROFILE_ACCOUNT_TYPE = "person";

const FILTER_PLAN_CACHE_NAMESPACE = "kol_marketing_profile_filter_plan";
const FILTER_PLAN_VERSION = "v2_llm_structured_filters";
const FILTER_LLM_DEFAULT_TIMEOUT_MS = 8000;
const FILTER_LLM_DEFAULT_CACHE_TTL_SECONDS = 3600;
const FILTER_LLM_MIN_CONFIDENCE_FOR_FILTERS = 0.35;
const FILTER_LLM_MIN_CONFIDENCE_FOR_SEMANTIC_QUERY = 0.35;
// 只读库默认 statement_timeout 偏保守（线上默认 1500ms）。
// activityDays 会额外查最近发帖时间，偶发略超时；只在这类超时时用更长的事务级 timeout 重试一次。
const ACTIVITY_QUERY_RETRY_STATEMENT_TIMEOUT_MS = getPositiveIntegerEnv(
  ["KOL_MARKETING_ACTIVITY_QUERY_RETRY_TIMEOUT_MS", "KOL_MARKETING_ACTIVITY_RETRY_STATEMENT_TIMEOUT_MS"],
  6000,
  { min: 1000, max: 30000 }
);

const FILTER_PATCH_KEYS = [
  "language",
  "domains",
  "keywords",
  "cooperationTypes",
  "marketingGoals",
  "projectStages",
  "identityTier",
  "minFollowers",
  "maxFollowers",
  "activityDays",
  "excludeLowWillingness",
  "excludeNonAcceptingCollaboration",
];

// 这些字段在画像表里是模型生成的业务标签，或要求精确枚举值。
// LLM 可把它们写进 semanticQuery 辅助向量召回，但不能作为自动推断的 SQL 硬过滤；
// 只有前端/调用方显式传 filters 时，才允许它们进入 SQL。
const LLM_SEMANTIC_ONLY_FILTER_KEYS = [
  "keywords",
  "cooperationTypes",
  "marketingGoals",
  "projectStages",
  "identityTier",
];

const VALID_LANGUAGES = new Set(["CN", "GLOBAL"]);
const VALID_DOMAINS = new Set(["AI", "Web3"]);
const VALID_WILLINGNESS_LEVELS = new Set(["low", "medium", "high", "unknown"]);

const LANGUAGE_ALIASES = {
  zh: "CN",
  cn: "CN",
  chinese: "CN",
  china: "CN",
  "zh-cn": "CN",
  中文: "CN",
  中文区: "CN",
  华语: "CN",
  华语区: "CN",
  简中: "CN",
  en: "GLOBAL",
  english: "GLOBAL",
  global: "GLOBAL",
  overseas: "GLOBAL",
  英文: "GLOBAL",
  英文区: "GLOBAL",
  海外: "GLOBAL",
  全球: "GLOBAL",
  国际: "GLOBAL",
};

const DOMAIN_ALIASES = {
  ai: "AI",
  artificialintelligence: "AI",
  人工智能: "AI",
  大模型: "AI",
  智能体: "AI",
  aigc: "AI",
  web3: "Web3",
  "web3.0": "Web3",
  webthree: "Web3",
  crypto: "Web3",
  blockchain: "Web3",
  defi: "Web3",
  nft: "Web3",
  cex: "Web3",
  dex: "Web3",
  区块链: "Web3",
  加密: "Web3",
  加密货币: "Web3",
  交易所: "Web3",
  币安: "Web3",
  欧易: "Web3",
  okx: "Web3",
};

const WILLINGNESS_LEVEL_ALIASES = {
  high: "high",
  高: "high",
  高意愿: "high",
  强: "high",
  medium: "medium",
  mid: "medium",
  中: "medium",
  中等: "medium",
  中意愿: "medium",
  low: "low",
  低: "low",
  低意愿: "low",
  unknown: "unknown",
  未知: "unknown",
};

function getPositiveIntegerEnv(names = [], defaultValue, options = {}) {
  const min = Number.isFinite(options.min) ? options.min : 1;
  const max = Number.isFinite(options.max) ? options.max : Number.MAX_SAFE_INTEGER;
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= min) {
      return Math.min(Math.floor(value), max);
    }
  }
  return Math.min(Math.max(Math.floor(defaultValue), min), max);
}

const LLM_FILTER_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "language",
    "domains",
    "keywords",
    "cooperationTypes",
    "marketingGoals",
    "projectStages",
    "willingnessLevels",
    "identityTier",
    "minFollowers",
    "maxFollowers",
    "semanticQuery",
    "confidence",
    "reasons",
  ],
  properties: {
    language: {
      type: "string",
      enum: ["", "CN", "GLOBAL"],
      description: "CN=中文区/华语区，GLOBAL=英文区/海外/全球；不确定返回空字符串",
    },
    domains: {
      type: "array",
      items: { type: "string", enum: ["AI", "Web3"] },
      maxItems: 2,
    },
    keywords: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    cooperationTypes: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    marketingGoals: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    projectStages: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    willingnessLevels: {
      type: "array",
      items: { type: "string", enum: ["low", "medium", "high", "unknown"] },
      maxItems: 4,
      description: "愿意合作/适合合作通常返回 ['medium','high']；明确高意愿只返回 ['high']",
    },
    identityTier: { type: "string" },
    minFollowers: { type: ["number", "null"] },
    maxFollowers: { type: ["number", "null"] },
    semanticQuery: {
      type: "string",
      description: "去掉粉丝数/语言等硬条件后，用于向量检索的语义描述；保留合作场景、方向和人群意图",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    reasons: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
  },
};

function getKolMarketingEmbeddingModel() {
  return getConfiguredEmbeddingModel({ envPrefixes: EMBEDDING_ENV_PREFIXES });
}

function getEnvBoolean(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return defaultValue;

  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}

function getEnvPositiveInteger(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getKolMarketingPersonProfileFilterSql(alias = "p") {
  const safeAlias = /^[a-z][a-z0-9_]*$/i.test(String(alias || "")) ? alias : "p";
  return {
    clause: `${safeAlias}.account_type = $personProfileAccountType`,
    bind: { personProfileAccountType: PERSON_PROFILE_ACCOUNT_TYPE },
    column: "account_type",
  };
}

function isKolMarketingFilterLlmEnabled() {
  // 默认开启 LLM 意图解析；线上异常时可用 KOL_MARKETING_FILTER_LLM_ENABLED=false 立刻降级为规则兜底。
  return getEnvBoolean("KOL_MARKETING_FILTER_LLM_ENABLED", true);
}

function getKolMarketingFilterLlmModel() {
  // 不配置时复用 src/lib/llm 的默认模型；配置专用变量可独立灰度 KOL 搜索意图解析模型。
  return process.env.KOL_MARKETING_FILTER_LLM_MODEL || process.env.LLM_MODEL || "";
}

function getFilterLlmTimeoutMs() {
  return getEnvPositiveInteger("KOL_MARKETING_FILTER_LLM_TIMEOUT_MS", FILTER_LLM_DEFAULT_TIMEOUT_MS);
}

function getFilterPlanCacheTtlSeconds() {
  const raw = process.env.KOL_MARKETING_FILTER_LLM_CACHE_TTL_SECONDS;
  if (raw !== undefined && raw !== null && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return FILTER_LLM_DEFAULT_CACHE_TTL_SECONDS;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeAliasKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function normalizeLanguage(value) {
  const raw = normalizeString(value, 32);
  if (!raw) return "";

  const alias = LANGUAGE_ALIASES[normalizeAliasKey(raw)] || LANGUAGE_ALIASES[raw];
  if (alias) return alias;

  // 当前画像表实际语言枚举只有 CN / GLOBAL；其他值不进入 SQL，避免错别字或 LLM 幻觉导致 0 召回。
  const normalized = raw.toUpperCase();
  return VALID_LANGUAGES.has(normalized) ? normalized : "";
}

function normalizeDomain(value) {
  const raw = normalizeString(value, 64);
  if (!raw) return "";

  const alias = DOMAIN_ALIASES[normalizeAliasKey(raw)] || DOMAIN_ALIASES[raw];
  if (alias) return alias;

  return VALID_DOMAINS.has(raw) ? raw : "";
}

function normalizeWillingnessLevel(value) {
  const raw = normalizeString(value, 64);
  if (!raw) return "";

  const normalized = WILLINGNESS_LEVEL_ALIASES[normalizeAliasKey(raw)] || WILLINGNESS_LEVEL_ALIASES[raw] || raw.toLowerCase();
  return VALID_WILLINGNESS_LEVELS.has(normalized) ? normalized : "";
}

function normalizeMappedStringArray(value, mapper, maxItems = 10, maxItemLength = 64) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/[，,\n]/)
      .filter(Boolean);

  return Array.from(
    new Set(
      normalizeStringArray(list, maxItems, maxItemLength)
        .map((item) => mapper(item))
        .filter(Boolean)
    )
  ).slice(0, maxItems);
}

function normalizeFlexibleStringArray(value, maxItems = 10, maxItemLength = 64) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/[，,\n]/)
      .filter(Boolean);

  return normalizeStringArray(list, maxItems, maxItemLength);
}

function normalizeWillingnessLevels(value) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/[，,\s/|]+/)
      .filter(Boolean);

  return normalizeMappedStringArray(rawValues, normalizeWillingnessLevel, 4, 64);
}

function normalizeFilters(filters = {}) {
  // 只允许白名单 filters 进入 SQL；未知字段直接丢弃，避免动态 SQL 风险。
  const input = filters && typeof filters === "object" && !Array.isArray(filters) ? filters : {};
  const normalized = {};

  // 线上表内 language 实际值是 CN / GLOBAL；兼容前端/旧调用传 zh/en。
  const language = normalizeLanguage(input.language);
  if (language) normalized.language = language;

  const domains = normalizeMappedStringArray(input.domains, normalizeDomain, 10, 64);
  if (domains.length > 0) normalized.domains = domains;

  const keywords = normalizeFlexibleStringArray(input.keywords, 10, 64);
  if (keywords.length > 0) normalized.keywords = keywords;

  const cooperationTypes = normalizeFlexibleStringArray(input.cooperationTypes, 10, 64);
  if (cooperationTypes.length > 0) normalized.cooperationTypes = cooperationTypes;

  const marketingGoals = normalizeFlexibleStringArray(input.marketingGoals, 10, 64);
  if (marketingGoals.length > 0) normalized.marketingGoals = marketingGoals;

  const projectStages = normalizeFlexibleStringArray(input.projectStages, 10, 64);
  if (projectStages.length > 0) normalized.projectStages = projectStages;

  const willingnessLevels = normalizeWillingnessLevels(
    input.willingnessLevels !== undefined ? input.willingnessLevels : input.willingnessLevel
  );
  if (willingnessLevels.length === 1) normalized.willingnessLevel = willingnessLevels[0];
  if (willingnessLevels.length > 1) normalized.willingnessLevels = willingnessLevels;

  const identityTier = normalizeString(input.identityTier, 64);
  if (identityTier) normalized.identityTier = identityTier;

  const minFollowers = normalizeNonNegativeInteger(input.minFollowers);
  if (minFollowers !== null) normalized.minFollowers = minFollowers;

  const maxFollowers = normalizeNonNegativeInteger(input.maxFollowers);
  if (maxFollowers !== null) normalized.maxFollowers = maxFollowers;

  const activityDays = normalizeNonNegativeInteger(input.activityDays);
  if (activityDays !== null && activityDays > 0) normalized.activityDays = Math.min(activityDays, 365);

  if (input.excludeLowWillingness === true) {
    delete normalized.willingnessLevel;
    delete normalized.willingnessLevels;
    normalized.excludeLowWillingness = true;
  }

  if (input.excludeNonAcceptingCollaboration === true) {
    normalized.excludeNonAcceptingCollaboration = true;
  }

  return normalized;
}

function excludeLowWillingnessWithCollaborationSql(alias = "p") {
  return `(
    ${alias}.collaboration_accepting_new_invitations IS TRUE
    OR (
      ${alias}.collaboration_accepting_new_invitations IS NULL
      AND coalesce(${alias}.willingness_level, 'unknown') <> 'low'
    )
  )`;
}

function hasMeaningfulFilters(filters = {}) {
  return Object.keys(normalizeFilters(filters)).length > 0;
}

function normalizeFollowerRange(filters = {}) {
  const normalized = normalizeFilters(filters);
  if (
    normalized.minFollowers !== undefined &&
    normalized.maxFollowers !== undefined &&
    normalized.minFollowers > normalized.maxFollowers
  ) {
    const minFollowers = normalized.maxFollowers;
    normalized.maxFollowers = normalized.minFollowers;
    normalized.minFollowers = minFollowers;
  }

  return normalized;
}

function applyFilterPatch(baseFilters = {}, patchFilters = {}) {
  const base = normalizeFollowerRange(baseFilters);
  const patch = normalizeFollowerRange(patchFilters);
  const merged = { ...base };

  // 普通过滤字段按优先级整字段覆盖：显式 filters > LLM 推断 > 规则推断。
  for (const key of FILTER_PATCH_KEYS) {
    if (hasOwn(patch, key)) merged[key] = patch[key];
  }

  // 合作意愿字段是互斥的一组：数组 OR 和单值等值不能同时进入 SQL。
  if (hasOwn(patch, "willingnessLevels") || hasOwn(patch, "willingnessLevel")) {
    delete merged.willingnessLevels;
    delete merged.willingnessLevel;
    if (hasOwn(patch, "willingnessLevels")) {
      merged.willingnessLevels = patch.willingnessLevels;
    } else {
      merged.willingnessLevel = patch.willingnessLevel;
    }
  }

  if (patch.excludeLowWillingness === true) {
    delete merged.willingnessLevels;
    delete merged.willingnessLevel;
    merged.excludeLowWillingness = true;
  }

  return normalizeFollowerRange(merged);
}

function parseChineseInteger(text) {
  const source = String(text || "").trim();
  if (!source) return null;
  if (/^\d+(\.\d+)?$/.test(source)) return Number(source);

  const digits = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const units = { 十: 10, 百: 100, 千: 1000 };

  let total = 0;
  let current = 0;
  for (const char of source) {
    if (digits[char] !== undefined) {
      current = digits[char];
      continue;
    }
    if (units[char]) {
      total += (current || 1) * units[char];
      current = 0;
    }
  }

  total += current;
  return total > 0 ? total : null;
}

function parseHumanNumber(numberText, unitText = "") {
  const rawNumber = String(numberText || "").trim().replace(/,/g, "");
  const parsed = Number(rawNumber);
  const base = Number.isFinite(parsed) ? parsed : parseChineseInteger(rawNumber);
  if (!Number.isFinite(base) || base <= 0) return null;

  const unit = normalizeAliasKey(unitText);
  let multiplier = 1;
  if (unit === "万" || unit === "w") multiplier = 10000;
  if (unit === "千" || unit === "k") multiplier = 1000;
  if (unit === "百万" || unit === "m" || unit === "million") multiplier = 1000000;

  return Math.floor(base * multiplier);
}

function firstNumberFromPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = parseHumanNumber(match[1], match[2]);
    if (value !== null) return value;
  }

  return null;
}

function inferFollowerFiltersFromQuery(query) {
  const text = String(query || "").replace(/\s+/g, " ");
  const numberToken = "([0-9][0-9,]*(?:\\.[0-9]+)?|[零一二两三四五六七八九十百千]+)";
  const unitToken = "(万|w|千|k|m|百万|million)?";
  const followerPrefix = "(?:粉丝|followers?)";
  const separatorToken = "[^0-9零一二两三四五六七八九十百千<>不]{0,12}";

  // 先识别明确的上限表达，避免“不超过/不高于”被正向规则里的“超过/高于”误命中。
  const maxFollowers = firstNumberFromPatterns(text, [
    new RegExp(`${followerPrefix}${separatorToken}(?:不超过|不高于|最多|至多|低于|小于|少于|<=|<|under|below|less than)\\s*${numberToken}\\s*${unitToken}`, "i"),
    new RegExp(`${numberToken}\\s*${unitToken}\\s*(?:粉丝|followers?)?\\s*(?:以下|以内)`, "i"),
  ]);

  const minFollowers = firstNumberFromPatterns(text, [
    new RegExp(`${followerPrefix}${separatorToken}(?:至少|不少于|不低于|大于等于|大于|超过|高于|>=|>|more than|over|above)\\s*${numberToken}\\s*${unitToken}`, "i"),
    new RegExp(`${numberToken}\\s*${unitToken}\\s*(?:粉丝|followers?)?\\s*(?:以上|及以上|起|\\+|plus)`, "i"),
  ]);

  const filters = {};
  if (minFollowers !== null) filters.minFollowers = minFollowers;
  if (maxFollowers !== null) filters.maxFollowers = maxFollowers;
  return filters;
}

function inferFiltersFromQuery(query = "") {
  const text = String(query || "").trim();
  const inferred = {};
  const reasons = [];

  if (!text) {
    return { filters: inferred, reasons };
  }

  const wantsCn = /(中文区?|华语区?|简中|中国|国内|Chinese|CN\b)/i.test(text);
  const wantsGlobal = /(英文区?|英语|海外|全球|国际|English|Global|overseas)/i.test(text);
  if (wantsCn && !wantsGlobal) {
    inferred.language = "CN";
    reasons.push("query.language: CN");
  } else if (wantsGlobal && !wantsCn) {
    inferred.language = "GLOBAL";
    reasons.push("query.language: GLOBAL");
  }

  const domains = [];
  if (/(^|[^a-z])ai([^a-z]|$)|人工智能|大模型|智能体|agent|aigc/i.test(text)) {
    domains.push("AI");
  }
  if (/web\s*3|crypto|blockchain|defi|nft|cex|dex|区块链|加密|链上|交易所|币安|欧易|okx/i.test(text)) {
    domains.push("Web3");
  }
  if (domains.length > 0) {
    inferred.domains = Array.from(new Set(domains));
    reasons.push(`query.domains: ${inferred.domains.join(",")}`);
  }

  const followerFilters = inferFollowerFiltersFromQuery(query);
  if (followerFilters.minFollowers !== undefined) {
    inferred.minFollowers = followerFilters.minFollowers;
    reasons.push(`query.minFollowers: ${followerFilters.minFollowers}`);
  }
  if (followerFilters.maxFollowers !== undefined) {
    inferred.maxFollowers = followerFilters.maxFollowers;
    reasons.push(`query.maxFollowers: ${followerFilters.maxFollowers}`);
  }

  if (/不愿意|低意愿|合作意愿低|low willingness/i.test(text)) {
    inferred.willingnessLevel = "low";
    reasons.push("query.willingnessLevel: low");
  } else if (/高意愿|强合作|合作意愿高|非常愿意|high willingness/i.test(text)) {
    inferred.willingnessLevel = "high";
    reasons.push("query.willingnessLevel: high");
  } else if (/愿意.*合作|合作.*账号|适合.*合作|可合作|商务合作|品牌合作|投放|推广|营销|campaign|ambassador/i.test(text)) {
    // “愿意合作”在当前表里主要对应 medium/high；用数组 OR，避免只取 high 过窄。
    inferred.willingnessLevels = ["medium", "high"];
    reasons.push("query.willingnessLevels: medium,high");
  }

  return {
    filters: normalizeFilters(inferred),
    reasons,
  };
}

function buildFilterExtractionPrompt(query) {
  return [
    "你是 KOL Marketing 搜索意图解析器，只负责把用户搜索词里的“硬过滤条件”抽成 JSON。",
    "",
    "数据库可用枚举和含义：",
    "- language 只能是 CN 或 GLOBAL。CN=中文区/华语区/国内；GLOBAL=英文区/海外/全球。",
    "- domains 只能包含 AI、Web3。交易所/CEX/币安/OKX/DeFi/加密/区块链 都归 Web3；大模型/智能体/Agent/AIGC 都归 AI。",
    "- willingnessLevels 只能包含 low、medium、high、unknown。用户说愿意合作/可合作/适合商务合作/投放/推广，通常是 [\"medium\",\"high\"]；明确高意愿才只用 [\"high\"]。",
    "- minFollowers/maxFollowers 是粉丝数硬条件，要把 5 万、50k、0.05M 等换算成真实数字。",
    "",
    "重要规则：",
    "1. 只抽用户明确表达的硬条件，不要凭空猜测。",
    "2. keywords/cooperationTypes/marketingGoals/projectStages 只有在用户明确给出可作为精确标签的条件时才填写；泛化描述请放到 semanticQuery，不要硬过滤。",
    "3. semanticQuery 用于向量检索：去掉粉丝数、语言、意愿等级这类硬过滤后，保留行业方向、合作场景、营销诉求、人群偏好。",
    "4. 不确定的字段返回空字符串、null 或空数组。",
    "",
    `用户搜索词：${JSON.stringify(query)}`,
  ].join("\n");
}

function normalizeLlmFilterExtraction(rawResult = {}) {
  const raw = rawResult && typeof rawResult === "object" && !Array.isArray(rawResult) ? rawResult : {};
  const filterSource = raw.filters && typeof raw.filters === "object" && !Array.isArray(raw.filters)
    ? raw.filters
    : raw;
  const filters = normalizeFilters({
    language: filterSource.language,
    domains: filterSource.domains,
    keywords: filterSource.keywords,
    cooperationTypes: filterSource.cooperationTypes,
    marketingGoals: filterSource.marketingGoals,
    projectStages: filterSource.projectStages,
    willingnessLevels: filterSource.willingnessLevels !== undefined ? filterSource.willingnessLevels : filterSource.willingnessLevel,
    identityTier: filterSource.identityTier,
    minFollowers: filterSource.minFollowers,
    maxFollowers: filterSource.maxFollowers,
  });

  const confidence = Number(raw.confidence);
  return {
    filters: normalizeFollowerRange(filters),
    semanticQuery: normalizeQueryText(raw.semanticQuery || ""),
    confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0,
    reasons: normalizeStringArray(raw.reasons || [], 8, 120),
  };
}

function getFilterPlanCacheKey(query, model) {
  const normalizedQuery = normalizeQueryText(query);
  const hash = crypto
    .createHash("sha256")
    .update(`${FILTER_PLAN_VERSION}\n${model || "default"}\n${normalizedQuery}`)
    .digest("hex");
  return `vector_search:filter_plan:${FILTER_PLAN_CACHE_NAMESPACE}:${hash}`;
}

async function readFilterPlanCache(redisClient, cacheKey) {
  // LLM 意图解析不是强依赖；Redis 读失败只影响缓存命中，不影响搜索主链路。
  if (!redisClient || !cacheKey) return null;

  try {
    const cached = await redisClient.get(cacheKey);
    if (!cached) return null;

    const parsed = JSON.parse(cached);
    if (parsed?.version !== FILTER_PLAN_VERSION || !parsed.result) return null;
    return parsed.result;
  } catch (error) {
    console.warn("[KOL Marketing Filter Plan] cache read failed", {
      message: error.message,
    });
    return null;
  }
}

async function writeFilterPlanCache(redisClient, cacheKey, result) {
  const ttlSeconds = getFilterPlanCacheTtlSeconds();
  if (!redisClient || !cacheKey || !result || ttlSeconds <= 0) return;

  try {
    await redisClient.setEx(
      cacheKey,
      ttlSeconds,
      JSON.stringify({
        version: FILTER_PLAN_VERSION,
        cachedAt: new Date().toISOString(),
        result,
      })
    );
  } catch (error) {
    console.warn("[KOL Marketing Filter Plan] cache write failed", {
      message: error.message,
    });
  }
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

function sanitizeLlmError(error) {
  return normalizeString(error?.message || String(error || "LLM filter extraction failed"), 180);
}

function createSearchAbortedError() {
  const error = new Error("KOL_MARKETING_SEARCH_ABORTED");
  error.code = "KOL_MARKETING_SEARCH_ABORTED";
  return error;
}

function throwIfSearchAborted(isAborted) {
  if (typeof isAborted === "function" && isAborted()) {
    throw createSearchAbortedError();
  }
}

async function extractKolMarketingFiltersWithLlm(query, options = {}) {
  const normalizedQuery = normalizeQueryText(query);
  const model = getKolMarketingFilterLlmModel();
  const modelForLog = model || "src/lib/llm.default";

  if (!normalizedQuery || !isKolMarketingFilterLlmEnabled()) {
    return {
      enabled: isKolMarketingFilterLlmEnabled(),
      attempted: false,
      cacheHit: false,
      model: model || null,
      filters: {},
      semanticQuery: "",
      confidence: 0,
      reasons: [],
      error: null,
    };
  }

  const cacheKey = getFilterPlanCacheKey(normalizedQuery, modelForLog);
  const cached = await readFilterPlanCache(options.redisClient, cacheKey);
  if (cached) {
    const normalizedCached = normalizeLlmFilterExtraction(cached);
    return {
      enabled: true,
      attempted: true,
      cacheHit: true,
      model: cached.model || model || null,
      filters: normalizedCached.filters,
      semanticQuery: normalizedCached.semanticQuery,
      confidence: normalizedCached.confidence,
      reasons: normalizedCached.reasons,
      error: null,
    };
  }

  const startedAt = Date.now();
  const timeoutMs = getFilterLlmTimeoutMs();
  console.log("[KOL Marketing Filter Plan] LLM extraction start", {
    model: modelForLog,
    queryLength: normalizedQuery.length,
    timeoutMs,
  });

  try {
    const rawResult = await withTimeout(
      structuredChat(
        buildFilterExtractionPrompt(normalizedQuery),
        LLM_FILTER_EXTRACTION_SCHEMA,
        {
          model: model || undefined,
          temperature: 0,
          maxTokens: 900,
          systemPrompt: "你是严谨的结构化搜索条件解析器。必须只返回符合 JSON Schema 的对象，不要输出解释性文字。",
        }
      ),
      timeoutMs,
      `KOL Marketing filter LLM extraction timeout after ${timeoutMs}ms`
    );
    const normalizedResult = normalizeLlmFilterExtraction(rawResult);
    const cacheValue = {
      model: model || null,
      ...normalizedResult,
    };

    await writeFilterPlanCache(options.redisClient, cacheKey, cacheValue);

    console.log("[KOL Marketing Filter Plan] LLM extraction success", {
      model: modelForLog,
      queryLength: normalizedQuery.length,
      filters: normalizedResult.filters,
      semanticQueryLength: normalizedResult.semanticQuery.length,
      confidence: normalizedResult.confidence,
      reasonCount: normalizedResult.reasons.length,
      costMs: Date.now() - startedAt,
    });

    return {
      enabled: true,
      attempted: true,
      cacheHit: false,
      model: model || null,
      filters: normalizedResult.filters,
      semanticQuery: normalizedResult.semanticQuery,
      confidence: normalizedResult.confidence,
      reasons: normalizedResult.reasons,
      error: null,
    };
  } catch (error) {
    const message = sanitizeLlmError(error);
    console.warn("[KOL Marketing Filter Plan] LLM extraction failed, fallback to rules", {
      model: modelForLog,
      queryLength: normalizedQuery.length,
      costMs: Date.now() - startedAt,
      message,
    });

    return {
      enabled: true,
      attempted: true,
      cacheHit: false,
      model: model || null,
      filters: {},
      semanticQuery: "",
      confidence: 0,
      reasons: [],
      error: message,
    };
  }
}

function resolveFollowerConflicts(derivedFilters, ruleFilters, llmFilters) {
  const resolved = { ...derivedFilters };

  for (const key of ["minFollowers", "maxFollowers"]) {
    if (!hasOwn(ruleFilters, key) || !hasOwn(llmFilters, key)) continue;

    const ruleValue = Number(ruleFilters[key]);
    const llmValue = Number(llmFilters[key]);
    if (!Number.isFinite(ruleValue) || !Number.isFinite(llmValue) || ruleValue === llmValue) continue;

    // 粉丝数正则解析对“5 万 / 50k / 以上以下”这类硬条件更确定；
    // 当 LLM 和规则结果冲突时优先采用规则值，避免 LLM 把“5 万”误归一成 5 导致召回异常。
    resolved[key] = ruleValue;
  }

  return normalizeFollowerRange(resolved);
}

function buildFilterReasons(ruleReasons = [], llmExtraction = {}) {
  const reasons = [];
  if (llmExtraction.cacheHit) reasons.push("llm.cache: hit");
  if (llmExtraction.error) reasons.push(`llm.error: ${llmExtraction.error}`);
  for (const reason of llmExtraction.reasons || []) {
    reasons.push(`llm: ${reason}`);
  }
  for (const reason of ruleReasons || []) {
    reasons.push(`rule: ${reason}`);
  }
  return reasons.slice(0, 20);
}

function getFilterPlanSource({ explicitFilters, llmFilters, ruleFilters }) {
  const sources = [];
  if (hasMeaningfulFilters(explicitFilters)) sources.push("explicit");
  if (hasMeaningfulFilters(llmFilters)) sources.push("llm");
  if (hasMeaningfulFilters(ruleFilters)) sources.push("rule");
  return sources.length > 0 ? sources.join("+") : "semantic";
}

function shouldUseLlmFilters(llmExtraction = {}) {
  return (
    llmExtraction &&
    !llmExtraction.error &&
    llmExtraction.confidence >= FILTER_LLM_MIN_CONFIDENCE_FOR_FILTERS
  );
}

function getLlmSqlHardFilters(filters = {}) {
  const normalized = normalizeFilters(filters);
  for (const key of LLM_SEMANTIC_ONLY_FILTER_KEYS) {
    delete normalized[key];
  }
  return normalized;
}

async function buildKolMarketingSearchPlan(params = {}) {
  const query = normalizeQueryText(params.query);
  const explicitFilters = normalizeFilters(params.filters);

  // EchoHunt KOL Match 的 AI 产品层已经单独生成 strategy.filters。
  // 这里允许调用方跳过底层从 query 再次推断硬过滤，避免 composite query 中的
  // “营销/合作/campaign”等词被规则误解为必须排除 low willingness。
  if (params.skipAutoFilterExtraction) {
    return {
      explicitFilters,
      llmFilters: {},
      ruleFilters: {},
      derivedFilters: {},
      effectiveFilters: explicitFilters,
      reasons: ["auto_filter_extraction: skipped"],
      semanticQuery: query,
      filterPlan: {
        source: hasMeaningfulFilters(explicitFilters) ? "explicit" : "semantic",
        autoFilterExtractionSkipped: true,
        llmEnabled: isKolMarketingFilterLlmEnabled(),
        llmAttempted: false,
        llmCacheHit: false,
        llmModel: null,
        llmConfidence: 0,
        llmError: null,
        semanticQuery: query,
      },
    };
  }

  const { filters: ruleFilters, reasons: ruleReasons } = inferFiltersFromQuery(query);
  const llmExtraction = await extractKolMarketingFiltersWithLlm(query, {
    redisClient: params.redisClient,
  });
  const llmFilters = shouldUseLlmFilters(llmExtraction)
    ? normalizeFilters(llmExtraction.filters)
    : {};
  const llmSqlHardFilters = getLlmSqlHardFilters(llmFilters);

  // 推断过滤条件先用确定性规则兜底，再用 LLM 结构化结果覆盖，最后再做一次粉丝数冲突保护。
  const derivedFilters = resolveFollowerConflicts(
    applyFilterPatch(ruleFilters, llmSqlHardFilters),
    ruleFilters,
    llmSqlHardFilters
  );

  // 显式 filters 是用户/前端直接选择的硬条件，优先级最高。
  const effectiveFilters = applyFilterPatch(derivedFilters, explicitFilters);

  const canUseLlmSemanticQuery =
    llmExtraction.semanticQuery &&
    llmExtraction.semanticQuery.length >= 2 &&
    llmExtraction.confidence >= FILTER_LLM_MIN_CONFIDENCE_FOR_SEMANTIC_QUERY;
  const semanticQuery = canUseLlmSemanticQuery ? llmExtraction.semanticQuery : query;

  return {
    explicitFilters,
    llmFilters,
    ruleFilters,
    derivedFilters,
    effectiveFilters,
    reasons: buildFilterReasons(ruleReasons, llmExtraction),
    semanticQuery,
    filterPlan: {
      source: getFilterPlanSource({ explicitFilters, llmFilters: llmSqlHardFilters, ruleFilters }),
      llmEnabled: llmExtraction.enabled,
      llmAttempted: llmExtraction.attempted,
      llmCacheHit: llmExtraction.cacheHit,
      llmModel: llmExtraction.model,
      llmConfidence: llmExtraction.confidence,
      llmError: llmExtraction.error,
      semanticQuery,
    },
  };
}

function mergeKolMarketingFilters(inputFilters = {}, query = "") {
  const explicitFilters = normalizeFilters(inputFilters);
  const { filters: derivedFilters, reasons } = inferFiltersFromQuery(query);
  const effectiveFilters = applyFilterPatch(derivedFilters, explicitFilters);

  return {
    explicitFilters,
    derivedFilters,
    effectiveFilters,
    reasons,
  };
}

function buildKolMarketingProfileSearchSql(filters, options = {}) {
  // 固定条件必须保留：和生产 HNSW 部分索引条件一致。
  const clauses = [
    "p.active = true",
    "p.marketing_profile_embedding IS NOT NULL",
  ];

  // 所有用户输入都放 bind，SQL 字符串里只拼接白名单生成的固定条件。
  const bind = {};

  if (options.personProfileTypeFilter?.clause) {
    clauses.push(options.personProfileTypeFilter.clause);
    Object.assign(bind, options.personProfileTypeFilter.bind || {});
  }

  if (filters.language) {
    clauses.push("p.language = $language");
    bind.language = filters.language;
  }

  if (filters.minFollowers !== undefined) {
    clauses.push("p.followers >= $minFollowers");
    bind.minFollowers = filters.minFollowers;
  }

  if (filters.maxFollowers !== undefined) {
    clauses.push("p.followers <= $maxFollowers");
    bind.maxFollowers = filters.maxFollowers;
  }

  if (filters.activityDays !== undefined) {
    clauses.push("activity.last_active_at >= now() - make_interval(days => $activityDays::integer)");
    bind.activityDays = filters.activityDays;
  }

  if (filters.domains?.length > 0) {
    // && 是 PostgreSQL 数组重叠操作：只要 domains 任一项命中即可。
    clauses.push("p.domains && $domains::text[]");
    bind.domains = filters.domains;
  }

  if (filters.keywords?.length > 0) {
    clauses.push("p.keywords && $keywords::text[]");
    bind.keywords = filters.keywords;
  }

  if (filters.cooperationTypes?.length > 0) {
    clauses.push("p.cooperation_types && $cooperationTypes::text[]");
    bind.cooperationTypes = filters.cooperationTypes;
  }

  if (filters.marketingGoals?.length > 0) {
    clauses.push("p.marketing_goals && $marketingGoals::text[]");
    bind.marketingGoals = filters.marketingGoals;
  }

  if (filters.projectStages?.length > 0) {
    clauses.push("p.project_stages && $projectStages::text[]");
    bind.projectStages = filters.projectStages;
  }

  if (filters.excludeLowWillingness === true) {
    clauses.push(excludeLowWillingnessWithCollaborationSql("p"));
  } else if (filters.excludeNonAcceptingCollaboration === true) {
    // 只排除用户主动关闭接单的 KOL；未设置 collaboration 的历史画像仍保留。
    clauses.push("p.collaboration_accepting_new_invitations IS DISTINCT FROM false");
  }

  if (filters.willingnessLevels?.length > 0) {
    clauses.push("p.willingness_level = ANY($willingnessLevels::text[])");
    bind.willingnessLevels = filters.willingnessLevels;
  } else if (filters.willingnessLevel) {
    clauses.push("p.willingness_level = $willingnessLevel");
    bind.willingnessLevel = filters.willingnessLevel;
  }

  if (filters.identityTier) {
    clauses.push("p.identity_tier = $identityTier");
    bind.identityTier = filters.identityTier;
  }

  const hasHardFilters = hasMeaningfulFilters(filters);

  if (hasHardFilters) {
    // pgvector HNSW 是近似索引：在 WHERE 里叠加语言/领域/粉丝/意愿等硬过滤时，
    // 可能先取近邻候选再过滤，导致“库里有匹配数据但返回 0 条”。
    // 有硬过滤时先 materialize 过滤候选，再在候选集上做精确向量排序，保证召回正确。
    const sql = `
      WITH filtered_profiles AS MATERIALIZED (
        SELECT
          p.twitter_user_id,
          p.handle,
          coalesce(p.name, u.name::text, u.profile ->> 'name') as name,
          u.profile ->> 'profile_image_url' as avatar,
          p.language,
          p.domains,
          p.followers,
          p.ai_rank_global,
          p.ai_rank_cn,
          p.web3_rank_global,
          p.web3_rank_cn,
          p.main_tweet_view_median,
          p.reply_tweet_view_median,
          p.main_metrics_window_days,
          p.reply_metrics_window_days,
          p.soul_score,
          p.marketing_summary_cn,
          p.marketing_summary_en,
          p.keywords,
          p.cooperation_types,
          p.marketing_goals,
          p.project_stages,
          p.ai_abilities,
          p.web3_abilities,
          p.willingness_level,
          p.willingness_score,
          p.willingness_reason,
          p.willingness_confidence,
          p.willingness_evidence,
          p.identity_tier,
          p.collaboration_accepting_new_invitations,
          p.collaboration_updated_at,
          p.collaboration_synced_at,
          p.collaboration_source,
          p.updated_at,
          p.metrics_calculated_at,
          activity.last_active_at,
          p.embedding_model,
          p.embedding_version,
          p.embedding_generated_at,
          p.marketing_profile_embedding
        FROM dev.kol_marketing_profile p
        LEFT JOIN dev.twitter_user u ON u.id = p.twitter_user_id
        LEFT JOIN LATERAL (
          SELECT t.create_time AS last_active_at
          FROM dev.tweet t
          WHERE t.twitter_user_id = p.twitter_user_id
            AND t.id = t.conversation_id
            AND t.retweet_id IS NULL
          ORDER BY t.create_time DESC
          LIMIT 1
        ) activity ON true
        WHERE ${clauses.join(" AND ")}
      )
      SELECT
        fp.twitter_user_id AS "twitterUserId",
        fp.handle,
        fp.name,
        fp.avatar,
        fp.language,
        fp.domains,
        fp.followers::double precision AS followers,
        fp.ai_rank_global AS "aiRankGlobal",
        fp.ai_rank_cn AS "aiRankCn",
        fp.web3_rank_global AS "web3RankGlobal",
        fp.web3_rank_cn AS "web3RankCn",
        fp.main_tweet_view_median::double precision AS "mainTweetViewMedian",
        fp.reply_tweet_view_median::double precision AS "replyTweetViewMedian",
        fp.main_metrics_window_days::double precision AS "mainMetricsWindowDays",
        fp.reply_metrics_window_days::double precision AS "replyMetricsWindowDays",
        fp.soul_score::double precision AS "soulScore",
        fp.marketing_summary_cn AS "marketingSummaryCn",
        fp.marketing_summary_en AS "marketingSummaryEn",
        fp.keywords,
        fp.cooperation_types AS "cooperationTypes",
        fp.marketing_goals AS "marketingGoals",
        fp.project_stages AS "projectStages",
        fp.ai_abilities AS "aiAbilities",
        fp.web3_abilities AS "web3Abilities",
        fp.willingness_level AS "willingnessLevel",
        fp.willingness_score::double precision AS "willingnessScore",
        fp.willingness_reason AS "willingnessReason",
        fp.willingness_confidence::double precision AS "willingnessConfidence",
        fp.willingness_evidence AS "willingnessEvidence",
        fp.identity_tier AS "identityTier",
        fp.collaboration_accepting_new_invitations AS "collaborationAcceptingNewInvitations",
        fp.collaboration_updated_at AS "collaborationUpdatedAt",
        fp.collaboration_synced_at AS "collaborationSyncedAt",
        fp.collaboration_source AS "collaborationSource",
        fp.updated_at AS "updatedAt",
        fp.metrics_calculated_at AS "metricsCalculatedAt",
        fp.last_active_at AS "lastActiveAt",
        fp.embedding_model AS "embeddingModel",
        fp.embedding_version AS "embeddingVersion",
        fp.embedding_generated_at AS "embeddingGeneratedAt",
        count(*) over()::integer AS "candidateTotal",
        -- pgvector cosine distance：距离越小越相似；这里转成 similarity，越接近 1 越相似。
        1 - (fp.marketing_profile_embedding <=> $embedding::vector) AS similarity
      FROM filtered_profiles fp
      ORDER BY fp.marketing_profile_embedding <=> $embedding::vector
      LIMIT $limit
    `;

    return { sql, bind, searchMode: "exact_filtered" };
  }

  const sql = `
    SELECT
      p.twitter_user_id AS "twitterUserId",
      p.handle,
      coalesce(p.name, u.name::text, u.profile ->> 'name') AS name,
      u.profile ->> 'profile_image_url' AS avatar,
      p.language,
      p.domains,
      p.followers::double precision AS followers,
      p.ai_rank_global AS "aiRankGlobal",
      p.ai_rank_cn AS "aiRankCn",
      p.web3_rank_global AS "web3RankGlobal",
      p.web3_rank_cn AS "web3RankCn",
      p.main_tweet_view_median::double precision AS "mainTweetViewMedian",
      p.reply_tweet_view_median::double precision AS "replyTweetViewMedian",
      p.main_metrics_window_days::double precision AS "mainMetricsWindowDays",
      p.reply_metrics_window_days::double precision AS "replyMetricsWindowDays",
      p.soul_score::double precision AS "soulScore",
      p.marketing_summary_cn AS "marketingSummaryCn",
      p.marketing_summary_en AS "marketingSummaryEn",
      p.keywords,
      p.cooperation_types AS "cooperationTypes",
      p.marketing_goals AS "marketingGoals",
      p.project_stages AS "projectStages",
      p.ai_abilities AS "aiAbilities",
      p.web3_abilities AS "web3Abilities",
      p.willingness_level AS "willingnessLevel",
      p.willingness_score::double precision AS "willingnessScore",
      p.willingness_reason AS "willingnessReason",
      p.willingness_confidence::double precision AS "willingnessConfidence",
      p.willingness_evidence AS "willingnessEvidence",
      p.identity_tier AS "identityTier",
      p.collaboration_accepting_new_invitations AS "collaborationAcceptingNewInvitations",
      p.collaboration_updated_at AS "collaborationUpdatedAt",
      p.collaboration_synced_at AS "collaborationSyncedAt",
      p.collaboration_source AS "collaborationSource",
      p.updated_at AS "updatedAt",
      p.metrics_calculated_at AS "metricsCalculatedAt",
      activity.last_active_at AS "lastActiveAt",
      p.embedding_model AS "embeddingModel",
      p.embedding_version AS "embeddingVersion",
      p.embedding_generated_at AS "embeddingGeneratedAt",
      count(*) over()::integer AS "candidateTotal",
      -- pgvector cosine distance：距离越小越相似；这里转成 similarity，越接近 1 越相似。
      1 - (p.marketing_profile_embedding <=> $embedding::vector) AS similarity
    FROM dev.kol_marketing_profile p
    LEFT JOIN dev.twitter_user u ON u.id = p.twitter_user_id
    LEFT JOIN LATERAL (
      SELECT t.create_time AS last_active_at
      FROM dev.tweet t
      WHERE t.twitter_user_id = p.twitter_user_id
        AND t.id = t.conversation_id
        AND t.retweet_id IS NULL
      ORDER BY t.create_time DESC
      LIMIT 1
    ) activity ON true
    WHERE ${clauses.join(" AND ")}
    ORDER BY p.marketing_profile_embedding <=> $embedding::vector
    LIMIT $limit
  `;

  return { sql, bind, searchMode: "hnsw_unfiltered" };
}

function errorDetails(error) {
  return {
    code: error?.code || error?.parent?.code || error?.original?.code,
    message: error?.message || error?.parent?.message || error?.original?.message,
  };
}

function isStatementTimeoutError(error) {
  const errors = [error, error?.parent, error?.original].filter(Boolean);
  return errors.some((item) => {
    const code = String(item.code || "");
    const message = String(item.message || "");
    return code === "57014" && /statement timeout/i.test(message);
  }) || errors.some((item) => /canceling statement due to statement timeout/i.test(String(item.message || "")));
}

async function queryWithOptionalStatementTimeout(db, sql, queryOptions, statementTimeoutMs = 0) {
  const timeoutMs = Number(statementTimeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return db.query(sql, queryOptions);
  }

  return db.transaction(async (transaction) => {
    await db.query("SELECT set_config('statement_timeout', $statementTimeout, true)", {
      bind: { statementTimeout: `${Math.floor(timeoutMs)}ms` },
      type: QueryTypes.SELECT,
      transaction,
    });
    return db.query(sql, { ...queryOptions, transaction });
  });
}

async function queryKolMarketingProfilesByEmbedding(params = {}) {
  // 进入数据库前再次 clamp limit 和 normalize filters，保证 service 被内部复用时也安全。
  const limit = clampLimit(params.limit, {
    defaultLimit: DEFAULT_LIMIT,
    maxLimit: MAX_LIMIT,
  });
  const filters = normalizeFilters(params.filters);

  // embedding 数组转 pgvector literal，最终仍通过 Sequelize bind 参数传入。
  const embeddingLiteral = vectorToPgLiteral(params.embedding, EMBEDDING_DIMENSIONS);

  // 只使用 K8s 注入的只读从库实例，不复用主库 pgInstance。
  const db = getPostgresReadOnlyInstance();
  const personProfileTypeFilter = getKolMarketingPersonProfileFilterSql("p");
  const { sql, bind, searchMode } = buildKolMarketingProfileSearchSql(filters, {
    personProfileTypeFilter,
  });

  const startedAt = Date.now();
  console.log("[KOL Marketing Search] db query start", {
    filters,
    limit,
    searchMode,
    personProfileTypeColumn: personProfileTypeFilter.column || null,
    embeddingDimensions: params.embedding?.length,
  });

  const queryOptions = {
    bind: {
      ...bind,
      embedding: embeddingLiteral,
      limit,
    },
    type: QueryTypes.SELECT,
  };

  let retryInfo = null;
  let rows = [];

  try {
    try {
      rows = await queryWithOptionalStatementTimeout(db, sql, queryOptions);
    } catch (error) {
      const timeoutDetails = errorDetails(error);
      const canRetryActivityTimeout = filters.activityDays !== undefined &&
        isStatementTimeoutError(error) &&
        ACTIVITY_QUERY_RETRY_STATEMENT_TIMEOUT_MS > 0;

      if (!canRetryActivityTimeout) throw error;

      const retryStartedAt = Date.now();
      retryInfo = {
        reason: "activityDays_statement_timeout",
        retryStatementTimeoutMs: ACTIVITY_QUERY_RETRY_STATEMENT_TIMEOUT_MS,
        firstCostMs: retryStartedAt - startedAt,
      };
      console.warn("[KOL Marketing Search] db query timeout, retry activityDays with longer statement_timeout", {
        filters,
        limit,
        searchMode,
        firstCostMs: retryInfo.firstCostMs,
        firstCode: timeoutDetails.code,
        firstMessage: timeoutDetails.message,
        retryStatementTimeoutMs: ACTIVITY_QUERY_RETRY_STATEMENT_TIMEOUT_MS,
      });

      rows = await queryWithOptionalStatementTimeout(
        db,
        sql,
        queryOptions,
        ACTIVITY_QUERY_RETRY_STATEMENT_TIMEOUT_MS
      );
      retryInfo.retryCostMs = Date.now() - retryStartedAt;
    }

    const dbCostMs = Date.now() - startedAt;
    console.log("[KOL Marketing Search] db query success", {
      filters,
      limit,
      searchMode,
      resultCount: rows.length,
      dbCostMs,
      retried: Boolean(retryInfo),
      retryInfo,
    });

    return {
      items: rows,
      filters,
      limit,
      searchMode,
      dbCostMs,
      retryInfo,
    };
  } catch (error) {
    const details = errorDetails(error);
    console.error("[KOL Marketing Search] db query failed", {
      filters,
      limit,
      searchMode,
      costMs: Date.now() - startedAt,
      retried: Boolean(retryInfo),
      retryInfo,
      code: details.code,
      message: details.message,
    });
    throw error;
  }
}

async function emitSearchProgress(callback, event) {
  if (typeof callback !== "function") return;
  try {
    await callback(event);
  } catch (error) {
    // 进度回调只服务 SSE/日志，不应影响搜索主链路。
    console.warn("[KOL Marketing Search] progress callback failed", {
      stage: event?.stage,
      message: error.message,
    });
  }
}

async function searchKolMarketingProfiles(params = {}) {
  const startedAt = Date.now();
  const queryLength = String(params.query || "").trim().length;
  const isAborted = params.isAborted;
  throwIfSearchAborted(isAborted);
  await emitSearchProgress(params.onProgress, {
    stage: "search_plan",
    status: "running",
    message: "正在解析搜索语义和硬过滤条件",
  });
  const searchPlan = await buildKolMarketingSearchPlan({
    query: params.query,
    filters: params.filters,
    redisClient: params.redisClient,
    skipAutoFilterExtraction: params.skipAutoFilterExtraction === true,
  });
  await emitSearchProgress(params.onProgress, {
    stage: "search_plan",
    status: "done",
    message: "搜索语义和硬过滤条件已生成",
    filters: searchPlan.effectiveFilters,
    semanticQuery: searchPlan.semanticQuery,
    filterPlan: searchPlan.filterPlan,
  });
  throwIfSearchAborted(isAborted);

  console.log("[KOL Marketing Search] embedding step start", {
    queryLength,
    semanticQueryLength: searchPlan.semanticQuery.length,
    requestedDimensions: EMBEDDING_DIMENSIONS,
    explicitFilters: searchPlan.explicitFilters,
    llmFilters: searchPlan.llmFilters,
    ruleFilters: searchPlan.ruleFilters,
    derivedFilters: searchPlan.derivedFilters,
    effectiveFilters: searchPlan.effectiveFilters,
    filterPlan: searchPlan.filterPlan,
  });

  // 先把自然语言 query 转成和表内画像同维度的 query embedding。
  await emitSearchProgress(params.onProgress, {
    stage: "embedding",
    status: "running",
    message: "正在生成需求向量",
  });
  throwIfSearchAborted(isAborted);
  const embeddingResult = await getQueryEmbedding({
    namespace: EMBEDDING_NAMESPACE,
    query: searchPlan.semanticQuery,
    redisClient: params.redisClient,
    envPrefixes: EMBEDDING_ENV_PREFIXES,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  await emitSearchProgress(params.onProgress, {
    stage: "embedding",
    status: "done",
    message: "需求向量已生成",
    embeddingModel: embeddingResult.model,
    embeddingCacheHit: embeddingResult.cacheHit,
  });
  throwIfSearchAborted(isAborted);

  console.log("[KOL Marketing Search] embedding step success", {
    queryLength,
    embeddingModel: embeddingResult.model,
    embeddingDimensions: embeddingResult.embedding.length,
    embeddingCacheHit: embeddingResult.cacheHit,
    costMs: Date.now() - startedAt,
  });

  // 再用 query embedding 走 pgvector 近邻检索。
  await emitSearchProgress(params.onProgress, {
    stage: "db_search",
    status: "running",
    message: "正在检索 KOL 候选集",
  });
  throwIfSearchAborted(isAborted);
  const searchResult = await queryKolMarketingProfilesByEmbedding({
    embedding: embeddingResult.embedding,
    filters: searchPlan.effectiveFilters,
    limit: params.limit,
  });
  await emitSearchProgress(params.onProgress, {
    stage: "db_search",
    status: "done",
    message: "KOL 候选集检索完成",
    resultCount: searchResult.items.length,
    candidateTotal: searchResult.items[0]?.candidateTotal || searchResult.items.length,
    dbCostMs: searchResult.dbCostMs,
    searchMode: searchResult.searchMode,
  });
  throwIfSearchAborted(isAborted);

  return {
    ...searchResult,
    inputFilters: searchPlan.explicitFilters,
    llmFilters: searchPlan.llmFilters,
    ruleFilters: searchPlan.ruleFilters,
    derivedFilters: searchPlan.derivedFilters,
    filterReasons: searchPlan.reasons,
    filterPlan: searchPlan.filterPlan,
    semanticQuery: embeddingResult.normalizedQuery,
    embeddingModel: embeddingResult.model,
    embeddingCacheHit: embeddingResult.cacheHit,
  };
}

module.exports = {
  EMBEDDING_DIMENSIONS,
  MAX_LIMIT,
  buildKolMarketingSearchPlan,
  buildKolMarketingProfileSearchSql,
  extractKolMarketingFiltersWithLlm,
  inferFiltersFromQuery,
  getKolMarketingFilterLlmModel,
  getKolMarketingEmbeddingModel,
  getKolMarketingPersonProfileFilterSql,
  isKolMarketingFilterLlmEnabled,
  mergeKolMarketingFilters,
  normalizeFilters,
  queryKolMarketingProfilesByEmbedding,
  searchKolMarketingProfiles,
};
