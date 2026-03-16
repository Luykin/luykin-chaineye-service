/**
 * 结构化输出对话 - 使用 OpenAI API 原生 json_schema 格式
 */

const axios = require('axios');
const { z } = require('zod');
const config = require('./config');
const { withRetry, LLMSchemaError } = require('./utils/errors');

/**
 * 将 Zod Schema 转换为 OpenAI JSON Schema 格式
 */
function zodToJsonSchema(zodSchema, name = 'output') {
  const def = zodSchema._def;
  
  if (def.typeName !== 'ZodObject') {
    throw new Error('Only ZodObject schemas are supported');
  }
  
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

function zodTypeToOpenApiSchema(type) {
  const def = type._def;
  
  switch (def.typeName) {
    case 'ZodString': {
      const result = { type: 'string' };
      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === 'min') result.minLength = check.value;
          if (check.kind === 'max') result.maxLength = check.value;
        }
      }
      return result;
    }
    case 'ZodNumber': {
      const result = { type: 'number' };
      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === 'min') result.minimum = check.value;
          if (check.kind === 'max') result.maximum = check.value;
        }
      }
      return result;
    }
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodArray': {
      return {
        type: 'array',
        items: zodTypeToOpenApiSchema(def.type)
      };
    }
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    case 'ZodOptional':
      return zodTypeToOpenApiSchema(def.innerType);
    default:
      return { type: 'string' };
  }
}

/**
 * 结构化对话
 */
async function structuredChat(message, schema, options = {}) {
  const {
    model = config.defaultModel,
    temperature = 0,
    name = 'structured_output',
    systemPrompt,
  } = options;

  if (!config.apiKey) {
    throw new Error('LLM_API_KEY is not configured');
  }

  return withRetry(async () => {
    // 转换 schema
    const jsonSchema = zodToJsonSchema(schema, name);
    
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
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: config.timeout
        }
      );
      
      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from model');
      }
      
      // 解析并验证
      const parsed = JSON.parse(content);
      return schema.parse(parsed);
      
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
