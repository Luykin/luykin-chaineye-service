const { QueryTypes } = require("sequelize");
const { getPostgresReadOnlyInstance } = require("../../../infra/k8s/postgres-readonly");
const {
  getConfiguredEmbeddingModel,
  getQueryEmbedding,
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

// 默认返回 20 条，最大 50 条，防止一次请求拉太多从库数据。
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// 环境变量优先级：新 KOL 画像专用配置 > 历史 KOL_SEARCH 配置 > VECTOR_SEARCH 通用配置。
const EMBEDDING_ENV_PREFIXES = ["KOL_MARKETING_PROFILE", "KOL_SEARCH"];

function getKolMarketingEmbeddingModel() {
  return getConfiguredEmbeddingModel({ envPrefixes: EMBEDDING_ENV_PREFIXES });
}

function normalizeFilters(filters = {}) {
  // 只允许白名单 filters 进入 SQL；未知字段直接丢弃，避免动态 SQL 风险。
  const input = filters && typeof filters === "object" && !Array.isArray(filters) ? filters : {};
  const normalized = {};

  const language = normalizeString(input.language, 32);
  if (language) normalized.language = language;

  const domains = normalizeStringArray(input.domains, 10, 64);
  if (domains.length > 0) normalized.domains = domains;

  const keywords = normalizeStringArray(input.keywords, 10, 64);
  if (keywords.length > 0) normalized.keywords = keywords;

  const cooperationTypes = normalizeStringArray(input.cooperationTypes, 10, 64);
  if (cooperationTypes.length > 0) normalized.cooperationTypes = cooperationTypes;

  const marketingGoals = normalizeStringArray(input.marketingGoals, 10, 64);
  if (marketingGoals.length > 0) normalized.marketingGoals = marketingGoals;

  const projectStages = normalizeStringArray(input.projectStages, 10, 64);
  if (projectStages.length > 0) normalized.projectStages = projectStages;

  const willingnessLevel = normalizeString(input.willingnessLevel, 64);
  if (willingnessLevel) normalized.willingnessLevel = willingnessLevel;

  const identityTier = normalizeString(input.identityTier, 64);
  if (identityTier) normalized.identityTier = identityTier;

  const minFollowers = normalizeNonNegativeInteger(input.minFollowers);
  if (minFollowers !== null) normalized.minFollowers = minFollowers;

  const maxFollowers = normalizeNonNegativeInteger(input.maxFollowers);
  if (maxFollowers !== null) normalized.maxFollowers = maxFollowers;

  return normalized;
}

function buildKolMarketingProfileSearchSql(filters) {
  // 固定条件必须保留：和生产 HNSW 部分索引条件一致，才能稳定命中索引。
  const clauses = [
    "p.active = true",
    "p.marketing_profile_embedding IS NOT NULL",
  ];

  // 所有用户输入都放 bind，SQL 字符串里只拼接白名单生成的固定条件。
  const bind = {};

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

  if (filters.willingnessLevel) {
    clauses.push("p.willingness_level = $willingnessLevel");
    bind.willingnessLevel = filters.willingnessLevel;
  }

  if (filters.identityTier) {
    clauses.push("p.identity_tier = $identityTier");
    bind.identityTier = filters.identityTier;
  }

  const sql = `
    SELECT
      p.twitter_user_id AS "twitterUserId",
      p.handle,
      p.name,
      p.language,
      p.domains,
      p.followers,
      p.ai_rank_global AS "aiRankGlobal",
      p.ai_rank_cn AS "aiRankCn",
      p.web3_rank_global AS "web3RankGlobal",
      p.web3_rank_cn AS "web3RankCn",
      p.marketing_summary_cn AS "marketingSummaryCn",
      p.marketing_summary_en AS "marketingSummaryEn",
      p.keywords,
      p.cooperation_types AS "cooperationTypes",
      p.marketing_goals AS "marketingGoals",
      p.project_stages AS "projectStages",
      p.willingness_level AS "willingnessLevel",
      p.willingness_score AS "willingnessScore",
      p.willingness_reason AS "willingnessReason",
      p.identity_tier AS "identityTier",
      p.embedding_model AS "embeddingModel",
      p.embedding_version AS "embeddingVersion",
      p.embedding_generated_at AS "embeddingGeneratedAt",
      -- pgvector cosine distance：距离越小越相似；这里转成 similarity，越接近 1 越相似。
      1 - (p.marketing_profile_embedding <=> $embedding::vector) AS similarity
    FROM dev.kol_marketing_profile p
    WHERE ${clauses.join(" AND ")}
    ORDER BY p.marketing_profile_embedding <=> $embedding::vector
    LIMIT $limit
  `;

  return { sql, bind };
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
  const { sql, bind } = buildKolMarketingProfileSearchSql(filters);

  // 只使用 K8s 注入的只读从库实例，不复用主库 pgInstance。
  const db = getPostgresReadOnlyInstance();

  const startedAt = Date.now();
  const rows = await db.query(sql, {
    bind: {
      ...bind,
      embedding: embeddingLiteral,
      limit,
    },
    type: QueryTypes.SELECT,
  });

  return {
    items: rows,
    filters,
    limit,
    dbCostMs: Date.now() - startedAt,
  };
}

async function searchKolMarketingProfiles(params = {}) {
  // 先把自然语言 query 转成和表内画像同维度的 query embedding。
  const embeddingResult = await getQueryEmbedding({
    namespace: EMBEDDING_NAMESPACE,
    query: params.query,
    redisClient: params.redisClient,
    envPrefixes: EMBEDDING_ENV_PREFIXES,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  // 再用 query embedding 走 pgvector 近邻检索。
  const searchResult = await queryKolMarketingProfilesByEmbedding({
    embedding: embeddingResult.embedding,
    filters: params.filters,
    limit: params.limit,
  });

  return {
    ...searchResult,
    semanticQuery: embeddingResult.normalizedQuery,
    embeddingModel: embeddingResult.model,
    embeddingCacheHit: embeddingResult.cacheHit,
  };
}

module.exports = {
  EMBEDDING_DIMENSIONS,
  MAX_LIMIT,
  buildKolMarketingProfileSearchSql,
  getKolMarketingEmbeddingModel,
  normalizeFilters,
  queryKolMarketingProfilesByEmbedding,
  searchKolMarketingProfiles,
};
