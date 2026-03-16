/**
 * 普通对话和流式对话
 */

const { HumanMessage, SystemMessage, AIMessage } = require('@langchain/core/messages');
const { getChatModel } = require('./models');
const { withRetry } = require('./utils/errors');

/**
 * 转换 history 格式为 LangChain Message 格式
 * @param {Array} history 
 * @returns {Array}
 */
function convertHistory(history = []) {
  if (!Array.isArray(history)) return [];
  
  return history.map(msg => {
    switch (msg.role) {
      case 'system':
        return new SystemMessage(msg.content);
      case 'assistant':
        return new AIMessage(msg.content);
      case 'user':
      default:
        return new HumanMessage(msg.content);
    }
  });
}

/**
 * 普通对话
 * @param {string} message - 用户消息
 * @param {Object} options - 选项
 * @param {string} options.model - 模型名称
 * @param {number} options.temperature - 温度
 * @param {string} options.systemPrompt - 系统提示
 * @param {Array} options.history - 历史消息 [{role, content}]
 * @param {number} options.maxTokens - 最大 token 数
 * @param {string} options.responseFormat - 响应格式 ('json_object' | 'text')
 * @returns {Promise<string>} 回复文本
 */
async function chat(message, options = {}) {
  const {
    model,
    temperature,
    systemPrompt,
    history = [],
    maxTokens,
    responseFormat,
  } = options;

  return withRetry(async () => {
    const llm = getChatModel({ model, temperature, maxTokens, responseFormat });
    
    // 构建消息列表
    const messages = [];
    
    // 添加系统提示
    if (systemPrompt) {
      messages.push(new SystemMessage(systemPrompt));
    }
    
    // 添加历史消息
    if (history.length > 0) {
      messages.push(...convertHistory(history));
    }
    
    // 添加当前消息
    messages.push(new HumanMessage(message));
    
    // 调用模型
    const response = await llm.invoke(messages);
    
    return response.content;
  });
}

/**
 * 流式对话
 * @param {string} message - 用户消息
 * @param {Object} options - 选项
 * @param {string} options.model - 模型名称
 * @param {number} options.temperature - 温度
 * @param {string} options.systemPrompt - 系统提示
 * @param {Array} options.history - 历史消息
 * @returns {AsyncGenerator<string>} 流式输出
 */
async function* streamChat(message, options = {}) {
  const {
    model,
    temperature,
    systemPrompt,
    history = [],
  } = options;

  const llm = getChatModel({ 
    model, 
    temperature, 
    streaming: true 
  });
  
  // 构建消息列表
  const messages = [];
  
  if (systemPrompt) {
    messages.push(new SystemMessage(systemPrompt));
  }
  
  if (history.length > 0) {
    messages.push(...convertHistory(history));
  }
  
  messages.push(new HumanMessage(message));
  
  // 流式调用
  const stream = await llm.stream(messages);
  
  for await (const chunk of stream) {
    yield chunk.content;
  }
}

module.exports = {
  chat,
  streamChat,
};
