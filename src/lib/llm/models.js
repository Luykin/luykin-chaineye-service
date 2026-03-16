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
 * 创建新的 ChatOpenAI 实例（不缓存，避免并发问题）
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

  // 每次创建新实例，避免并发问题
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
