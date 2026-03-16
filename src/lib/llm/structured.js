/**
 * 结构化输出对话 - 使用 LiteLLM json_schema 格式
 * 
 * 根据 LiteLLM 文档：https://docs.litellm.ai/docs/providers/lm_studio
 * 直接传递普通 JSON Schema，LiteLLM 会处理结构约束
 */

const { getChatModel } = require('./models');
const { withRetry } = require('./utils/errors');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');

async function structuredChat(message, schema, options = {}) {
  const {
    model: modelName,
    temperature = 0,
    systemPrompt,
  } = options;

  return withRetry(async () => {
    // 用户传递的是普通 JSON Schema，直接使用
    // 不需要转换为 Zod，LiteLLM 会处理
    const jsonSchemaObj = schema;
    
    // 使用 LiteLLM 的 json_schema 格式
    // 参考: https://docs.litellm.ai/docs/providers/lm_studio
    const llm = getChatModel({ 
      model: modelName, 
      temperature,
      streaming: false,
      responseFormat: 'json_schema',
      jsonSchema: {
        name: 'structured_output',
        schema: jsonSchemaObj
      }
    });
    
    try {
      // 构建消息
      const messages = [];
      if (systemPrompt) {
        messages.push(new SystemMessage(systemPrompt));
      }
      messages.push(new HumanMessage(message));
      
      // 调用模型（返回的已经是结构化 JSON）
      const response = await llm.invoke(messages);
      const content = response.content;
      
      // LiteLLM 返回的应该是结构化 JSON，直接解析
      const result = JSON.parse(content);
      return result;
      
    } catch (error) {
      console.error('[LLM structuredChat] Error:', error.message);
      throw error;
    }
  });
}

module.exports = {
  structuredChat,
};
