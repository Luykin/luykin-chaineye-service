/**
 * 结构化输出对话 - 兼容 LiteLLM/Gemini 实现
 */

const { z } = require('zod');
const { getChatModel } = require('./models');
const { withRetry, LLMSchemaError } = require('./utils/errors');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');

/**
 * 将 JSON Schema 转换为 Zod Schema（简化版）
 */
function jsonSchemaToZod(jsonSchema) {
  if (!jsonSchema || typeof jsonSchema !== 'object') {
    return z.any();
  }

  // 处理对象类型
  if (jsonSchema.type === 'object' && jsonSchema.properties) {
    const shape = {};
    const requiredFields = jsonSchema.required || [];
    
    for (const [key, propSchema] of Object.entries(jsonSchema.properties)) {
      const isRequired = requiredFields.includes(key);
      shape[key] = jsonSchemaToZod(propSchema);
      if (!isRequired) {
        shape[key] = shape[key].optional();
      }
    }
    
    return z.object(shape);
  }
  
  // 处理数组类型
  if (jsonSchema.type === 'array' && jsonSchema.items) {
    return z.array(jsonSchemaToZod(jsonSchema.items));
  }
  
  // 基础类型
  switch (jsonSchema.type) {
    case 'string':
      if (jsonSchema.enum) {
        return z.enum(jsonSchema.enum);
      }
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    default:
      return z.any();
  }
}

/**
 * 将 Schema 转换为 JSON 字符串作为提示词的一部分
 */
function schemaToJsonExample(schema) {
  const example = {};
  
  if (schema.type === 'object' && schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (prop.type === 'string') {
        example[key] = prop.enum ? prop.enum[0] : 'string_value';
      } else if (prop.type === 'number' || prop.type === 'integer') {
        example[key] = 0;
      } else if (prop.type === 'boolean') {
        example[key] = true;
      } else if (prop.type === 'array') {
        example[key] = [];
      } else if (prop.type === 'object') {
        example[key] = {};
      }
    }
  }
  
  return JSON.stringify(example, null, 2);
}

/**
 * 结构化对话 - 使用普通 Chat + JSON 解析（兼容所有模型）
 */
async function structuredChat(message, schema, options = {}) {
  const {
    model: modelName,
    temperature = 0,
    systemPrompt,
  } = options;

  return withRetry(async () => {
    // 转换 schema
    let zodSchema;
    let jsonSchemaObj;
    
    if (schema._def) {
      // 是 Zod Schema，转换为 JSON Schema
      zodSchema = schema;
      const shape = schema._def.shape?.() || {};
      jsonSchemaObj = {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(shape).map(([k, v]) => {
            const isOptional = v.isOptional?.() || false;
            const innerType = isOptional ? v._def.innerType : v;
            let type = 'string';
            if (innerType._def?.typeName === 'ZodNumber') type = 'number';
            if (innerType._def?.typeName === 'ZodBoolean') type = 'boolean';
            if (innerType._def?.typeName === 'ZodArray') type = 'array';
            return [k, { type, description: innerType.description }];
          })
        ),
        required: Object.entries(shape)
          .filter(([k, v]) => !v.isOptional?.())
          .map(([k]) => k)
      };
    } else {
      // 是普通 JSON Schema
      jsonSchemaObj = schema;
      zodSchema = jsonSchemaToZod(schema);
    }
    
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
      
      // LiteLLM 应该已经返回结构化 JSON，直接解析
      let result;
      try {
        result = JSON.parse(content);
      } catch (e) {
        // 如果解析失败，尝试提取
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[1].trim());
        } else {
          const jsonStart = content.indexOf('{');
          const jsonEnd = content.lastIndexOf('}');
          if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            result = JSON.parse(content.substring(jsonStart, jsonEnd + 1));
          } else {
            throw new Error('无法从响应中提取 JSON');
          }
        }
      }
      
      // 使用 Zod 验证
      if (zodSchema && zodSchema.parse) {
        try {
          return zodSchema.parse(result);
        } catch (zodError) {
          console.error('[LLM structuredChat] Zod validation error:', zodError);
          throw formatZodError(zodError, result);
        }
      }
      
      return result;
      
    } catch (error) {
      console.error('[LLM structuredChat] Error:', error.message);
      
      if (error.message?.includes('JSON') || error.message?.includes('json')) {
        throw new LLMSchemaError(new Error(
          `JSON 解析失败: ${error.message}。请尝试简化 Schema 或更换模型。`
        ));
      }
      
      throw error;
    }
  });
}

/**
 * 格式化 Zod 错误
 */
function formatZodError(zodError, parsed) {
  const issues = zodError.issues || [];
  
  const missingFields = issues
    .filter(e => e.message?.includes('Required') || e.message?.includes('expected') || e.code === 'invalid_type')
    .map(e => e.path?.join('.') || 'unknown')
    .filter(Boolean);
  
  if (missingFields.length > 0) {
    const returnedFields = Object.keys(parsed || {});
    const availableFields = returnedFields.length > 0 
      ? `模型返回的字段: ${returnedFields.join(', ')}` 
      : '模型返回为空或格式错误';
    
    const errorMsg = `Schema 验证失败：缺少字段: ${missingFields.join(', ')}。\n\n${availableFields}\n\n可能原因：\n1. Schema 字段名与系统提示中的字段名不一致\n2. 模型不支持严格的 Schema 约束\n3. 尝试使用更简单的 Schema`;
    
    return new LLMSchemaError(new Error(errorMsg));
  }
  
  const errorMessages = issues.map(e => `${e.path?.join('.') || 'root'}: ${e.message}`).join('\n');
  return new LLMSchemaError(new Error(`Schema 验证失败:\n${errorMessages}`));
}

module.exports = {
  structuredChat,
};
