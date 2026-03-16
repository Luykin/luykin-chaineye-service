/**
 * 结构化输出对话 - 使用 LiteLLM json_schema 格式
 *
 * 根据 LiteLLM 文档：https://docs.litellm.ai/docs/providers/lm_studio
 * 直接传递普通 JSON Schema，LiteLLM 会处理结构约束
 */

const { getChatModel } = require("./models");
const { withRetry } = require("./utils/errors");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");

/**
 * 解析 LLM 返回的 JSON 响应
 * 处理多种格式：直接 JSON、markdown 代码块包裹等
 */
function parseJsonResponse(content) {
  if (!content || typeof content !== 'string') {
    return content;
  }
  
  const trimmed = content.trim();
  
  // 尝试 1：直接解析
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    // 继续尝试其他方式
  }
  
  // 尝试 2：提取 markdown 代码块 ```json ... ```
  const jsonCodeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonCodeBlockMatch) {
    try {
      return JSON.parse(jsonCodeBlockMatch[1].trim());
    } catch (e) {
      console.log("[LLM structuredChat] Failed to parse code block content");
    }
  }
  
  // 尝试 3：找到第一个 { 和最后一个 }
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    try {
      return JSON.parse(trimmed.substring(jsonStart, jsonEnd + 1));
    } catch (e) {
      console.log("[LLM structuredChat] Failed to parse extracted JSON");
    }
  }
  
  // 尝试 4：找到第一个 [ 和最后一个 ]
  const arrStart = trimmed.indexOf('[');
  const arrEnd = trimmed.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(trimmed.substring(arrStart, arrEnd + 1));
    } catch (e) {
      console.log("[LLM structuredChat] Failed to parse extracted array");
    }
  }
  
  // 都失败了，返回原始内容
  console.log("[LLM structuredChat] Could not parse as JSON, returning raw content");
  return content;
}

async function structuredChat(message, schema, options = {}) {
  const { model: modelName, temperature = 0, systemPrompt } = options;

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
      responseFormat: "json_schema",
      jsonSchema: {
        name: "structured_output",
        schema: jsonSchemaObj,
      },
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
      
      // 尝试解析 JSON，处理多种格式
      let result = parseJsonResponse(content);
      return result;
    } catch (error) {
      console.error("[LLM structuredChat] Error:", error.message);
      throw error;
    }
  });
}

module.exports = {
  structuredChat,
};
