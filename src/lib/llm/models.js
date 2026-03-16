/**
 * LangChain ChatModel 初始化
 * 使用实例缓存避免重复创建
 */

const { ChatOpenAI } = require('@langchain/openai');
const config = require('./config');

// 实例缓存 Map
// key: `${model}_${temperature}_${streaming}`
const modelCache = new Map();

/**
 * 生成缓存 key
 */
function getCacheKey(model, temperature, streaming) {
  return `${model}_${temperature}_${streaming ? 1 : 0}`;
}

/**
 * 获取或创建 ChatOpenAI 实例（带缓存）
 * @param {Object} options - 可选配置
 * @param {string} options.model - 模型名称
 * @param {number} options.temperature - 温度
 * @param {boolean} options.streaming - 是否流式
 * @param {number} options.maxTokens - 最大 token 数
 * @returns {ChatOpenAI}
 */
function getChatModel(options = {}) {
  const {
    model = config.defaultModel,
    temperature = config.temperature,
    streaming = false,
    maxTokens,
  } = options;

  const apiKey = config.apiKey;
  
  if (!apiKey) {
    throw new Error('LLM_API_KEY is not configured');
  }

  // 生成缓存 key（maxTokens 不参与缓存，因为很少变且不影响连接）
  const cacheKey = getCacheKey(model, temperature, streaming);

  // 检查缓存
  if (modelCache.has(cacheKey)) {
    const cached = modelCache.get(cacheKey);
    // 如果 maxTokens 不同，需要重新设置
    if (maxTokens && maxTokens !== cached.maxTokens) {
      cached.maxTokens = maxTokens;
    }
    return cached;
  }

  // 创建新实例
  const llm = new ChatOpenAI({
    modelName: model,
    temperature,
    streaming,
    maxTokens,
    openAIApiKey: apiKey,
    configuration: {
      baseURL: config.baseURL,
    },
    timeout: config.timeout,
    maxRetries: config.maxRetries,
  });

  // 存入缓存
  modelCache.set(cacheKey, llm);
  console.log(`[LLM] Created new model instance: ${cacheKey}`);

  return llm;
}

/**
 * 清空模型缓存（用于配置热更新时）
 */
function clearModelCache() {
  modelCache.clear();
  console.log('[LLM] Model cache cleared');
}

/**
 * 获取缓存统计
 */
function getCacheStats() {
  return {
    size: modelCache.size,
    keys: Array.from(modelCache.keys()),
  };
}

module.exports = {
  getChatModel,
  clearModelCache,
  getCacheStats,
};
