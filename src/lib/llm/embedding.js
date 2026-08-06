/**
 * LLM 统一 Embedding 调用封装
 *
 * 设计目标：
 * - 所有业务统一从 src/lib/llm 调 embedding，不在业务模块里各自初始化 OpenAI SDK；
 * - 优先支持内部 embedding endpoint，例如 backend-v1 /ai/embedding，避免业务服务直连外部 LiteLLM 被网关拦截；
 * - 未配置 endpoint 时，再退回 OpenAI-compatible embeddings.create；
 * - 维度在这里统一传入并校验，避免 pgvector 查询时才暴露 dimension mismatch；
 * - 只打印排查必要的模型、维度、耗时、状态，不打印 API Key 和输入原文。
 */

const axios = require("axios");
const OpenAI = require("openai");
const config = require("./config");

// OpenAI-compatible 客户端创建成本较高，这里按服务地址/超时/重试配置复用。
const embeddingClientCache = new Map();

function getNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getDefaultEmbeddingModel() {
  return process.env.LLM_EMBEDDING_MODEL || "gemini-embedding-001";
}

function getDefaultEmbeddingDimensions() {
  return getNumber(process.env.LLM_EMBEDDING_DIMENSIONS, 1536);
}

function getDefaultEmbeddingEndpointURL() {
  return process.env.LLM_EMBEDDING_ENDPOINT_URL || "";
}

function getDefaultEmbeddingBaseURL() {
  return process.env.LLM_EMBEDDING_BASE_URL || process.env.LLM_BASE_URL || config.baseURL || "";
}

function getDefaultEmbeddingApiKey() {
  return process.env.LLM_EMBEDDING_API_KEY || config.apiKey;
}

function getDefaultEmbeddingTimeout() {
  return getNumber(process.env.LLM_EMBEDDING_TIMEOUT_MS || config.timeout, 30000);
}

function getDefaultEmbeddingMaxRetries() {
  return getNumber(process.env.LLM_EMBEDDING_MAX_RETRIES || config.maxRetries, 2);
}

function normalizeEmbeddingInput(input) {
  return String(input || "").trim();
}

function getEmbeddingClient({ apiKey, baseURL, timeout, maxRetries }) {
  const cacheKey = `${baseURL || "default"}:${timeout}:${maxRetries}`;
  if (!embeddingClientCache.has(cacheKey)) {
    if (!apiKey) {
      const error = new Error("LLM embedding API key is not configured");
      error.code = "LLM_EMBEDDING_NOT_CONFIGURED";
      throw error;
    }

    console.log("[LLM Embedding] create OpenAI-compatible client", {
      baseURLConfigured: Boolean(baseURL),
      apiKeyConfigured: Boolean(apiKey),
      timeout,
      maxRetries,
    });

    embeddingClientCache.set(cacheKey, new OpenAI({
      apiKey,
      baseURL: baseURL || undefined,
      timeout,
      maxRetries,
    }));
  }

  return embeddingClientCache.get(cacheKey);
}

function isNumberArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function extractEmbeddingVector(payload) {
  // 兼容项目内部 /ai/embedding、OpenAI-compatible 以及后续可能新增的轻包装格式。
  if (isNumberArray(payload)) return payload;
  if (isNumberArray(payload?.embedding)) return payload.embedding;
  if (isNumberArray(payload?.vector)) return payload.vector;
  if (isNumberArray(payload?.data)) return payload.data;
  if (isNumberArray(payload?.data?.embedding)) return payload.data.embedding;
  if (isNumberArray(payload?.data?.vector)) return payload.data.vector;
  if (isNumberArray(payload?.data?.[0]?.embedding)) return payload.data[0].embedding;
  if (isNumberArray(payload?.result?.embedding)) return payload.result.embedding;
  if (isNumberArray(payload?.result?.vector)) return payload.result.vector;
  return null;
}

async function requestEmbeddingByEndpoint(input, options) {
  const {
    endpointURL,
    model,
    dimensions,
    timeout,
    namespace = "default",
  } = options;
  const startedAt = Date.now();

  console.log("[LLM Embedding] endpoint request start", {
    namespace,
    model,
    requestedDimensions: dimensions,
    endpointConfigured: Boolean(endpointURL),
    inputLength: input.length,
  });

  let response;
  try {
    response = await axios.post(
      endpointURL,
      {
        // backend-v1 /ai/embedding 使用 text 字段；input/model/dimensions 用于兼容后续统一 endpoint。
        text: input,
        input,
        model,
        dimensions,
      },
      {
        timeout,
        headers: { "Content-Type": "application/json" },
        validateStatus: () => true,
      }
    );
  } catch (error) {
    console.error("[LLM Embedding] endpoint request failed", {
      namespace,
      model,
      requestedDimensions: dimensions,
      costMs: Date.now() - startedAt,
      code: error.code,
      message: error.message,
    });
    throw error;
  }

  const payload = response.data;
  if (response.status < 200 || response.status >= 300 || (payload && payload.code && Number(payload.code) !== 200)) {
    const error = new Error(payload?.message || payload?.msg || `embedding endpoint failed: ${response.status}`);
    error.code = "LLM_EMBEDDING_ENDPOINT_FAILED";
    error.status = response.status;
    console.error("[LLM Embedding] endpoint response failed", {
      namespace,
      model,
      requestedDimensions: dimensions,
      httpStatus: response.status,
      serviceCode: payload?.code,
      costMs: Date.now() - startedAt,
      message: error.message,
    });
    throw error;
  }

  const vector = extractEmbeddingVector(payload);
  console.log("[LLM Embedding] endpoint request success", {
    namespace,
    model,
    requestedDimensions: dimensions,
    returnedDimensions: Array.isArray(vector) ? vector.length : null,
    costMs: Date.now() - startedAt,
  });

  return vector;
}

async function requestEmbeddingByOpenAI(input, options) {
  const {
    model,
    dimensions,
    apiKey,
    baseURL,
    timeout,
    maxRetries,
    namespace = "default",
  } = options;
  const startedAt = Date.now();
  const client = getEmbeddingClient({ apiKey, baseURL, timeout, maxRetries });

  console.log("[LLM Embedding] OpenAI-compatible request start", {
    namespace,
    model,
    requestedDimensions: dimensions,
    baseURLConfigured: Boolean(baseURL),
    inputLength: input.length,
  });

  let response;
  try {
    response = await client.embeddings.create({
      model,
      input,
      // dimensions 必须显式传递，避免 gemini-embedding-001 默认返回 384 维。
      dimensions,
      encoding_format: "float",
    });
  } catch (error) {
    console.error("[LLM Embedding] OpenAI-compatible request failed", {
      namespace,
      model,
      requestedDimensions: dimensions,
      costMs: Date.now() - startedAt,
      status: error.status,
      code: error.code,
      type: error.type,
      message: error.message,
    });
    throw error;
  }

  const vector = response?.data?.[0]?.embedding;
  console.log("[LLM Embedding] OpenAI-compatible request success", {
    namespace,
    model,
    requestedDimensions: dimensions,
    returnedDimensions: Array.isArray(vector) ? vector.length : null,
    costMs: Date.now() - startedAt,
    usage: response?.usage || null,
  });

  return vector;
}

/**
 * 生成文本 embedding。
 * @param {string} input 输入文本
 * @param {Object} options 配置
 * @param {string} options.model embedding 模型名
 * @param {number} options.dimensions 期望维度
 * @param {string} options.endpointURL 内部 embedding endpoint，配置后优先使用
 * @param {string} options.baseURL OpenAI-compatible baseURL，未配置 endpoint 时使用
 * @param {string} options.apiKey OpenAI-compatible API Key，未配置 endpoint 时使用
 * @param {number} options.timeout 请求超时毫秒
 * @param {number} options.maxRetries SDK 重试次数
 * @param {string} options.namespace 日志命名空间
 * @returns {Promise<number[]>}
 */
async function embedding(input, options = {}) {
  const normalizedInput = normalizeEmbeddingInput(input);
  if (!normalizedInput) {
    const error = new Error("embedding input is empty");
    error.code = "LLM_EMBEDDING_INPUT_EMPTY";
    throw error;
  }

  const endpointURL = options.endpointURL || getDefaultEmbeddingEndpointURL();
  const resolved = {
    model: options.model || getDefaultEmbeddingModel(),
    dimensions: getNumber(options.dimensions, getDefaultEmbeddingDimensions()),
    endpointURL,
    // 配置了内部 endpoint 时不解析外部 baseURL/API Key，避免日志或 warning 混淆真实上游。
    baseURL: endpointURL ? (options.baseURL || "") : (options.baseURL || getDefaultEmbeddingBaseURL()),
    // 配置了内部 endpoint 时不读取 API Key，避免无意义的 LLM_API_KEY warning，也避免误以为会直连外部服务。
    apiKey: endpointURL ? options.apiKey : (options.apiKey || getDefaultEmbeddingApiKey()),
    timeout: getNumber(options.timeout, getDefaultEmbeddingTimeout()),
    maxRetries: getNumber(options.maxRetries, getDefaultEmbeddingMaxRetries()),
    namespace: options.namespace || "default",
  };

  if (!resolved.model) {
    const error = new Error("LLM embedding model is not configured");
    error.code = "LLM_EMBEDDING_NOT_CONFIGURED";
    throw error;
  }

  // 内部 endpoint 优先；没有 endpoint 时才使用 OpenAI-compatible 方式。
  const vector = resolved.endpointURL
    ? await requestEmbeddingByEndpoint(normalizedInput, resolved)
    : await requestEmbeddingByOpenAI(normalizedInput, resolved);

  if (!isNumberArray(vector)) {
    const error = new Error("LLM embedding result is not a numeric array");
    error.code = "LLM_EMBEDDING_INVALID";
    throw error;
  }

  if (vector.length !== resolved.dimensions) {
    console.error("[LLM Embedding] dimension mismatch", {
      namespace: resolved.namespace,
      model: resolved.model,
      expectedDimensions: resolved.dimensions,
      returnedDimensions: vector.length,
      upstream: resolved.endpointURL ? "endpoint" : "openai-compatible",
    });
    const error = new Error(`LLM embedding dimension mismatch: expected ${resolved.dimensions}, got ${vector.length}`);
    error.code = "LLM_EMBEDDING_DIMENSION_MISMATCH";
    throw error;
  }

  return vector;
}

function clearEmbeddingClientCache() {
  embeddingClientCache.clear();
}

module.exports = {
  embedding,
  clearEmbeddingClientCache,
};
