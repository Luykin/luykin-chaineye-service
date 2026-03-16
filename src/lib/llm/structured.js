/**
 * 结构化输出对话 - 使用 OpenAI API 原生 json_schema 格式
 */

const axios = require('axios');
const { z } = require('zod');
const config = require('./config');
const { withRetry, LLMSchemaError } = require('./utils/errors');

/**
 * 将 Zod Schema 转换为 OpenAI JSON Schema 格式
 * 支持：ZodObject、ZodArray、ZodString、ZodNumber、ZodBoolean、ZodEnum、ZodOptional、ZodNullable
 */
function zodToJsonSchema(zodSchema, name = 'output') {
  const def = zodSchema._def;
  
  // 处理各种类型
  if (def.typeName === 'ZodObject') {
    const properties = {};
    const required = [];
    
    for (const [key, value] of Object.entries(def.shape())) {
      properties[key] = zodTypeToOpenApiSchema(value);
      if (!value.isOptional()) {
        required.push(key);
      }
    }
    
    return {
      name,
      description: zodSchema.description || 'Structured output',
      schema: {
        type: 'object',
        properties,
        required,
        additionalProperties: false
      }
    };
  }
  
  // 如果不是 object，包装成 object
  return {
    name,
    description: zodSchema.description || 'Structured output',
    schema: zodTypeToOpenApiSchema(zodSchema)
  };
}

function zodTypeToOpenApiSchema(type) {
  const def = type._def;
  
  switch (def.typeName) {
    case 'ZodString': {
      const result = { type: 'string' };
      if (def.description) result.description = def.description;
      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === 'min') result.minLength = check.value;
          if (check.kind === 'max') result.maxLength = check.value;
        }
      }
      return result;
    }
    case 'ZodNumber':
    case 'ZodInt': {
      const result = { type: def.typeName === 'ZodInt' ? 'integer' : 'number' };
      if (def.description) result.description = def.description;
      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === 'min') result.minimum = check.value;
          if (check.kind === 'max') result.maximum = check.value;
        }
      }
      return result;
    }
    case 'ZodBoolean': {
      const result = { type: 'boolean' };
      if (def.description) result.description = def.description;
      return result;
    }
    case 'ZodArray': {
      const result = {
        type: 'array',
        items: zodTypeToOpenApiSchema(def.type)
      };
      if (def.description) result.description = def.description;
      if (def.minLength !== undefined) result.minItems = def.minLength;
      if (def.maxLength !== undefined) result.maxItems = def.maxLength;
      return result;
    }
    case 'ZodEnum': {
      const result = { type: 'string', enum: def.values };
      if (def.description) result.description = def.description;
      return result;
    }
    case 'ZodOptional': {
      const inner = zodTypeToOpenApiSchema(def.innerType);
      // 标记为可选属性，但不改变类型
      return inner;
    }
    case 'ZodNullable': {
      const inner = zodTypeToOpenApiSchema(def.innerType);
      return { ...inner, nullable: true };
    }
    case 'ZodObject': {
      // 递归处理嵌套对象
      const properties = {};
      const required = [];
      
      for (const [key, value] of Object.entries(def.shape())) {
        properties[key] = zodTypeToOpenApiSchema(value);
        if (!value.isOptional()) {
          required.push(key);
        }
      }
      
      return {
        type: 'object',
        properties,
        required,
        additionalProperties: false
      };
    }
    default:
      // 对于未知类型，返回字符串
      return { type: 'string' };
  }
}

/**
 * 将普通 JSON Schema 转换为 OpenAI 格式
 */
function jsonSchemaToOpenAI(jsonSchema, name = 'output') {
  if (jsonSchema.type === 'object' && jsonSchema.properties) {
    return {
      name,
      description: jsonSchema.description || 'Structured output',
      schema: {
        ...jsonSchema,
        additionalProperties: false
      }
    };
  }
  
  // 如果不是 object，包装成 object
  return {
    name,
    description: 'Structured output',
    schema: {
      type: 'object',
      properties: {
        value: jsonSchema
      },
      required: ['value'],
      additionalProperties: false
    }
  };
}

/**
 * 结构化对话
 * @param {string} message - 用户消息
 * @param {z.ZodSchema|Object} schema - Zod Schema 或普通 JSON Schema
 * @param {Object} options - 选项
 */
async function structuredChat(message, schema, options = {}) {
  const {
    model = config.defaultModel,
    temperature = 0,
    name = 'structured_output',
    systemPrompt,
  } = options;

  const apiKey = config.apiKey;
  console.log('[LLM structuredChat] apiKey retrieved:', !!apiKey);
  
  if (!apiKey) {
    console.error('[LLM structuredChat] ERROR: LLM_API_KEY is not configured');
    throw new Error('LLM_API_KEY is not configured');
  }

  return withRetry(async () => {
    // 转换 schema（支持 Zod 和普通 JSON Schema）
    let jsonSchema;
    if (schema._def) {
      // 是 Zod Schema
      jsonSchema = zodToJsonSchema(schema, name);
    } else {
      // 是普通 JSON Schema
      jsonSchema = jsonSchemaToOpenAI(schema, name);
    }
    
    // 构建消息
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: message });
    
    try {
      // 直接调用 API
      const response = await axios.post(
        `${config.baseURL}chat/completions`,
        {
          model,
          messages,
          temperature,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: jsonSchema.name,
              description: jsonSchema.description,
              schema: jsonSchema.schema,
              strict: true
            }
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: config.timeout
        }
      );
      
      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from model');
      }
      
      // 解析结果
      const parsed = JSON.parse(content);
      
      // 如果有 Zod Schema，进行验证
      if (schema._def && schema.parse) {
        return schema.parse(parsed);
      }
      
      // 否则直接返回
      return parsed;
      
    } catch (error) {
      if (error.response?.data?.error) {
        throw new Error(`API Error: ${error.response.data.error.message || error.response.data.error}`);
      }
      if (error.name === 'ZodError') {
        throw new LLMSchemaError(error);
      }
      if (error instanceof SyntaxError) {
        throw new LLMSchemaError(new Error(`Invalid JSON: ${error.message}`));
      }
      throw error;
    }
  });
}

module.exports = {
  structuredChat,
};
