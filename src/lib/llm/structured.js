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
 * 处理多种格式：直接 JSON、markdown 代码块包裹、数组消息格式等
 */
function parseJsonResponse(content) {
  if (!content) {
    return content;
  }
  
  // 处理数组消息格式 [{"type":"text","text":"..."}]
  // 有些模型直接返回数组对象而不是字符串
  if (Array.isArray(content) && content.length > 0) {
    const textItem = content.find(item => item && item.type === 'text' && item.text);
    if (textItem) {
      // 递归解析 text 字段
      return parseJsonResponse(textItem.text);
    }
  }
  
  // 如果已经是对象（但不是数组），直接返回
  if (typeof content !== 'string') {
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
  
  // 尝试 3：处理字符串形式的数组消息格式 '[{"type":"text","text":"..."}]'
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr) && arr.length > 0) {
        // 查找 type=text 的元素
        const textItem = arr.find(item => item && item.type === 'text' && item.text);
        if (textItem) {
          // 递归解析 text 字段中的 JSON
          return parseJsonResponse(textItem.text);
        }
      }
    } catch (e) {
      // 不是合法的数组 JSON，继续尝试其他方式
    }
  }
  
  // 尝试 4：找到第一个 { 和最后一个 }
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    try {
      return JSON.parse(trimmed.substring(jsonStart, jsonEnd + 1));
    } catch (e) {
      console.log("[LLM structuredChat] Failed to parse extracted JSON");
    }
  }
  
  // 尝试 5：找到第一个 [ 和最后一个 ]
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

/**
 * 简单的 JSON Schema 校验
 * 仅校验第一层 required 字段是否存在
 */
function validateJsonSchema(data, schema, path = '') {
  const errors = [];
  
  if (!schema || typeof schema !== 'object') {
    return errors;
  }
  
  // 如果是对象类型，校验 required 字段
  if (schema.type === 'object' && schema.properties) {
    const required = schema.required || [];
    
    for (const field of required) {
      if (!(field in data)) {
        errors.push(`${path ? path + '.' : ''}${field}: 必填字段缺失`);
      }
    }
    
    // 递归校验子对象
    for (const [key, value] of Object.entries(data)) {
      const propSchema = schema.properties[key];
      if (propSchema && typeof value === 'object' && value !== null) {
        const subErrors = validateJsonSchema(value, propSchema, `${path ? path + '.' : ''}${key}`);
        errors.push(...subErrors);
      }
    }
  }
  
  // 如果是数组类型，校验 items
  if (schema.type === 'array' && schema.items && Array.isArray(data)) {
    data.forEach((item, index) => {
      const subErrors = validateJsonSchema(item, schema.items, `${path}[${index}]`);
      errors.push(...subErrors);
    });
  }
  
  return errors;
}

async function structuredChat(message, schema, options = {}) {
  const { model: modelName, temperature = 0, systemPrompt, maxTokens } = options;

  return withRetry(async () => {
    // schema 应该是普通 JSON Schema（来自用户输入）
    const jsonSchemaObj = schema;

    // 使用 LiteLLM 的 json_schema 格式
    // 参考: https://docs.litellm.ai/docs/providers/lm_studio
    const llm = getChatModel({
      model: modelName,
      temperature,
      streaming: false,
      maxTokens,
      responseFormat: "json_schema",
      jsonSchema: {
        name: "structured_output",
        schema: jsonSchemaObj,
      },
    });

    try {
      // 构建消息
      const messages = [];
      
      // 默认系统提示：要求直接返回 JSON，不要 markdown
      const defaultSystemPrompt = "重要：直接返回纯 JSON，不要 markdown 代码块，不要 ```json 标记,并且严格按照JSON Schema定义返回，请勿擅自额外包其他格式。";
      
      if (systemPrompt) {
        messages.push(new SystemMessage(systemPrompt + "\n\n" + defaultSystemPrompt));
      } else {
        messages.push(new SystemMessage(defaultSystemPrompt));
      }
      messages.push(new HumanMessage(message));

      // 调用模型（返回的已经是结构化 JSON）
      const response = await llm.invoke(messages);
      const content = response.content;
    
      console.log(JSON.stringify(content), '======111调用模型返回结果111======')
      // 尝试解析 JSON，处理多种格式
      let result = parseJsonResponse(content);
      
      // 校验是否为对象
      if (typeof result !== 'object' || result === null || Array.isArray(result)) {
        throw new Error('返回结果不是有效的 JSON 对象');
      }
      
      // 简单校验 JSON Schema
      const validationErrors = validateJsonSchema(result, jsonSchemaObj);
      if (validationErrors.length > 0) {
        console.log('[LLM structuredChat] Schema validation failed:', validationErrors);
        throw new Error('返回结果不符合 JSON Schema 格式要求，请稍后重试');
      }
      
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
