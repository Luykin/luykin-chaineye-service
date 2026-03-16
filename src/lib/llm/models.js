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
 * @param {string} options.responseFormat - 响应格式 ('json_object' | 'json_schema' | 'text')
 * @param {Object} options.jsonSchema - JSON Schema 对象（当 responseFormat='json_schema' 时使用）
 * @returns {ChatOpenAI}
 */
function getChatModel(options = {}) {
  const {
    model = config.defaultModel,
    temperature = config.temperature,
    streaming = false,
    maxTokens,
    responseFormat,
    jsonSchema,
  } = options;

  const apiKey = config.apiKey;
  
  if (!apiKey) {
    throw new Error('LLM_API_KEY is not configured');
  }

  // 构建额外参数（用于 LiteLLM json_schema）
  let extraBody = {};
  let modelKwargs = {};
  
  if (responseFormat === 'json_object') {
    // OpenAI/Gemini 格式：仅强制返回 JSON
    modelKwargs = {
      response_format: { type: 'json_object' }
    };
  } else if (responseFormat === 'json_schema' && jsonSchema) {
    // LiteLLM/LM Studio 格式：带 Schema 约束
    // 参考: https://docs.litellm.ai/docs/providers/lm_studio
    modelKwargs = {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: jsonSchema.name || 'structured_output',
          strict: true,
          schema: jsonSchema.schema || jsonSchema
        }
      }
    };
  }

  // 调试：打印请求参数
  if (Object.keys(modelKwargs).length > 0) {
    console.log('[LLM getChatModel] modelKwargs:', JSON.stringify(modelKwargs, null, 2));
  }

  // 构建配置
  const modelConfig = {
    modelName: model,
    temperature,
    streaming,
    maxTokens,
    openAIApiKey: apiKey,
    modelKwargs: Object.keys(modelKwargs).length > 0 ? modelKwargs : undefined,
    configuration: {
      baseURL: config.baseURL,
    },
    timeout: config.timeout,
    maxRetries: config.maxRetries,
  };

  // 每次创建新实例，避免并发问题
  const llm = new ChatOpenAI(modelConfig);

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
