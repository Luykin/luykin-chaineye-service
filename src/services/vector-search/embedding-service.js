const crypto = require("crypto");
const { OpenAIEmbeddings } = require("@langchain/openai");
const llmConfig = require("../../lib/llm/config");

/**
 * 通用向量检索 embedding 服务。
 *
 * 环境变量命名规则：
 * - <PREFIX>_EMBEDDING_MODEL：embedding 模型名，例如 KOL_MARKETING_PROFILE_EMBEDDING_MODEL。
 * - <PREFIX>_EMBEDDING_DIMENSIONS：embedding 维度，必须和库里 vector 维度一致。
 * - <PREFIX>_EMBEDDING_API_KEY：embedding 服务 API Key，不填则复用 LLM_API_KEY。
 * - <PREFIX>_EMBEDDING_BASE_URL：embedding 服务 Base URL，不填则复用 LLM_BASE_URL / llmConfig.baseURL。
 * - <PREFIX>_EMBEDDING_CACHE_TTL_SECONDS：Redis embedding 缓存 TTL，默认 86400 秒。
 * - <PREFIX>_EMBEDDING_MAX_RETRIES：embedding 请求重试次数。
 * - <PREFIX>_EMBEDDING_TIMEOUT_MS：embedding 请求超时时间，默认 30000ms。
 *
 * 业务方通过 envPrefixes 控制优先级，例如：
 * ["KOL_MARKETING_PROFILE", "KOL_SEARCH"] 会依次读取
 * KOL_MARKETING_PROFILE_EMBEDDING_MODEL -> KOL_SEARCH_EMBEDDING_MODEL -> VECTOR_SEARCH_EMBEDDING_MODEL。
 */

// OpenAIEmbeddings 客户端创建成本较高，这里按 namespace/model/baseURL/dimensions 复用。
const clientCache = new Map();

function normalizeEnvPrefixes(envPrefixes = []) {
  return Array.from(
    new Set(
      [
        ...envPrefixes,
        "VECTOR_SEARCH",
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
}

// 根据业务前缀读取环境变量，并自动追加 VECTOR_SEARCH 作为通用兜底前缀。
function getEnvValue(envPrefixes, suffix, fallbackNames = []) {
  const names = [];
  for (const prefix of normalizeEnvPrefixes(envPrefixes)) {
    names.push(`${prefix}_${suffix}`);
  }
  names.push(...fallbackNames);

  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }

  return "";
}

// 当前业务要使用的 embedding 模型；必须和数据表里存量向量的模型一致。
function getConfiguredEmbeddingModel(options = {}) {
  return options.model || getEnvValue(options.envPrefixes, "EMBEDDING_MODEL");
}

// 当前业务期望的 embedding 维度；pgvector 字段维度不一致会直接报错。
function getEmbeddingDimensions(options = {}) {
  const configured = options.dimensions || getEnvValue(options.envPrefixes, "EMBEDDING_DIMENSIONS");
  const dimensions = Number(configured || 1536);
  return Number.isFinite(dimensions) && dimensions > 0 ? Math.floor(dimensions) : 1536;
}

// query embedding 缓存时间，避免同一个搜索词反复请求 embedding 服务。
function getEmbeddingCacheTtlSeconds(options = {}) {
  const configured = options.cacheTtlSeconds || getEnvValue(options.envPrefixes, "EMBEDDING_CACHE_TTL_SECONDS");
  const ttl = Number(configured || 86400);
  return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 86400;
}

// embedding 服务地址：业务配置优先，其次复用通用 LLM 服务地址。
function getEmbeddingBaseURL(options = {}) {
  return (
    options.baseURL ||
    getEnvValue(options.envPrefixes, "EMBEDDING_BASE_URL", ["LLM_BASE_URL"]) ||
    llmConfig.baseURL ||
    ""
  );
}

// 统一清洗自然语言 query，控制最大长度，避免 embedding 输入过长。
function normalizeQueryText(text) {
  return String(text || "").trim().replace(/\s+/g, " ").slice(0, 500);
}

// 缓存 key 必须包含模型、维度、baseURL，防止切模型/切维度后命中旧 embedding。
function getEmbeddingCacheKey(namespace, text, model, dimensions, baseURL) {
  const normalized = normalizeQueryText(text);
  const safeNamespace = String(namespace || "default").trim() || "default";
  const hash = crypto
    .createHash("sha256")
    .update(`${safeNamespace}\n${model}\n${dimensions}\n${baseURL || ""}\n${normalized}`)
    .digest("hex");
  return `vector_search:embedding:${safeNamespace}:${hash}`;
}

function createEmbeddingClient(options = {}) {
  // model/apiKey/baseURL/dimensions 都在这里统一解析，便于多业务复用同一套逻辑。
  const model = getConfiguredEmbeddingModel(options);
  const apiKey =
    options.apiKey ||
    getEnvValue(options.envPrefixes, "EMBEDDING_API_KEY", ["LLM_API_KEY"]) ||
    llmConfig.apiKey;
  const baseURL = getEmbeddingBaseURL(options);
  const dimensions = getEmbeddingDimensions(options);

  if (!model) {
    const error = new Error("embedding model is not configured");
    error.code = "VECTOR_EMBEDDING_NOT_CONFIGURED";
    throw error;
  }

  if (!apiKey) {
    const error = new Error("embedding API key is not configured");
    error.code = "VECTOR_EMBEDDING_NOT_CONFIGURED";
    throw error;
  }

  return new OpenAIEmbeddings({
    model,
    modelName: model,
    apiKey,
    configuration: baseURL ? { baseURL } : undefined,
    // 关键：这里必须传给 OpenAIEmbeddings，不能只在结果侧校验；
    // 否则 text-embedding-3-large 等模型会返回默认维度，和表字段 vector(1536) 不匹配。
    dimensions,
    maxRetries: Number(
      options.maxRetries ||
        getEnvValue(options.envPrefixes, "EMBEDDING_MAX_RETRIES") ||
        llmConfig.maxRetries ||
        2
    ),
    timeout: Number(
      options.timeout || getEnvValue(options.envPrefixes, "EMBEDDING_TIMEOUT_MS") || 30000
    ),
  });
}

function getEmbeddingClient(options = {}) {
  // 同一个业务 namespace 下，不同模型/服务地址/维度需要不同客户端。
  const model = getConfiguredEmbeddingModel(options);
  const namespace = String(options.namespace || "default");
  const baseURL = getEmbeddingBaseURL(options);
  const dimensions = getEmbeddingDimensions(options);
  const cacheKey = `${namespace}:${model}:${baseURL}:${dimensions}`;

  if (!clientCache.has(cacheKey)) {
    clientCache.set(cacheKey, createEmbeddingClient(options));
  }

  return clientCache.get(cacheKey);
}

async function readEmbeddingCache(redisClient, cacheKey) {
  // Redis 不是强依赖，读缓存失败只降级为实时生成 embedding。
  if (!redisClient || !cacheKey) return null;

  try {
    const cached = await redisClient.get(cacheKey);
    if (!cached) return null;

    const parsed = JSON.parse(cached);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch (error) {
    console.warn("[Vector Embedding] cache read failed:", error.message);
    return null;
  }
}

async function writeEmbeddingCache(redisClient, cacheKey, embedding, options = {}) {
  // Redis 不是强依赖，写缓存失败不能影响主链路。
  if (!redisClient || !cacheKey || !Array.isArray(embedding)) return;

  try {
    await redisClient.setEx(
      cacheKey,
      getEmbeddingCacheTtlSeconds(options),
      JSON.stringify(embedding)
    );
  } catch (error) {
    console.warn("[Vector Embedding] cache write failed:", error.message);
  }
}

function assertEmbeddingDimensions(embedding, options = {}) {
  // 在进入 pgvector 查询前做维度校验，避免数据库层报难排查的 vector 维度错误。
  const expected = getEmbeddingDimensions(options);

  if (!Array.isArray(embedding)) {
    const error = new Error("embedding result is not an array");
    error.code = "VECTOR_EMBEDDING_INVALID";
    throw error;
  }

  if (embedding.length !== expected) {
    const error = new Error(`embedding dimension mismatch: expected ${expected}, got ${embedding.length}`);
    error.code = "VECTOR_EMBEDDING_DIMENSION_MISMATCH";
    throw error;
  }
}

async function getQueryEmbedding(options = {}) {
  // 主流程：清洗 query -> 查 Redis 缓存 -> 生成 embedding -> 校验维度 -> 写回缓存。
  const normalizedQuery = normalizeQueryText(options.query);
  if (!normalizedQuery) {
    const error = new Error("query is empty");
    error.code = "VECTOR_QUERY_EMPTY";
    throw error;
  }

  const model = getConfiguredEmbeddingModel(options);
  const dimensions = getEmbeddingDimensions(options);
  const baseURL = getEmbeddingBaseURL(options);
  const namespace = String(options.namespace || "default").trim() || "default";
  const cacheKey = getEmbeddingCacheKey(
    namespace,
    normalizedQuery,
    model || "unknown",
    dimensions,
    baseURL
  );
  const cachedEmbedding = await readEmbeddingCache(options.redisClient, cacheKey);

  if (cachedEmbedding) {
    assertEmbeddingDimensions(cachedEmbedding, options);
    return {
      embedding: cachedEmbedding,
      model,
      cacheHit: true,
      normalizedQuery,
      namespace,
    };
  }

  const client = getEmbeddingClient(options);
  const embedding = await client.embedQuery(normalizedQuery);
  assertEmbeddingDimensions(embedding, options);
  await writeEmbeddingCache(options.redisClient, cacheKey, embedding, options);

  return {
    embedding,
    model,
    cacheHit: false,
    normalizedQuery,
    namespace,
  };
}

function resetEmbeddingClientsForTest() {
  clientCache.clear();
}

module.exports = {
  getConfiguredEmbeddingModel,
  getEmbeddingDimensions,
  getQueryEmbedding,
  normalizeQueryText,
  resetEmbeddingClientsForTest,
};
