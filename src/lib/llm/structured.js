/**
 * 结构化输出对话 - 使用 OpenAI API 原生 json_schema 格式
 */

const axios = require('axios');
const { z } = require('zod');
const config = require('./config');
const { withRetry, LLMSchemaError } = require('./utils/errors');

/**
 * 将普通 JSON Schema 转换为 OpenAI JSON Schema 格式
 * 支持嵌套对象和数组
 */
function jsonSchemaToOpenAI(jsonSchema, name = 'output') {
  // 深拷贝并添加 additionalProperties: false
  const processedSchema = processSchema(jsonSchema);
  
  return {
    name,
    description: jsonSchema.description || 'Structured output',
    schema: processedSchema
  };
}

/**
 * 递归处理 Schema，添加 additionalProperties: false
 */
function processSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }
  
  // 处理数组类型
  if (schema.type === 'array' && schema.items) {
    return {
      ...schema,
      items: processSchema(schema.items)
    };
  }
  
  // 处理对象类型
  if (schema.type === 'object' && schema.properties) {
    const processedProperties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      processedProperties[key] = processSchema(value);
    }
    
    return {
      ...schema,
      properties: processedProperties,
      additionalProperties: false
    };
  }
  
  // 其他类型直接返回
  return schema;
}

/**
 * 将 Zod Schema 转换为 OpenAI JSON Schema 格式
 */
function zodToJsonSchema(zodSchema, name = 'output') {
  const def = zodSchema._def;
  
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
    schema: {
      type: 'object',
      properties: {
        value: zodTypeToOpenApiSchema(zodSchema)
      },
      required: ['value'],
      additionalProperties: false
    }
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
      return zodTypeToOpenApiSchema(def.innerType);
    }
    case 'ZodNullable': {
      const inner = zodTypeToOpenApiSchema(def.innerType);
      return { ...inner, nullable: true };
    }
    case 'ZodObject': {
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

  const apiKey = config.apiKey;
  console.log('[LLM structuredChat] apiKey retrieved:', !!apiKey);
  
  if (!apiKey) {
    console.error('[LLM structuredChat] ERROR: LLM_API_KEY is not configured');
    throw new Error('LLM_API_KEY is not configured');
  }

  return withRetry(async () => {
    // 转换 schema
    let jsonSchema;
    if (schema._def) {
      jsonSchema = zodToJsonSchema(schema, name);
    } else {
      jsonSchema = jsonSchemaToOpenAI(schema, name);
    }
    
    console.log('[LLM structuredChat] Converted schema:', JSON.stringify(jsonSchema.schema, null, 2).substring(0, 500));
    
    // 构建消息
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: message });
    
    try {
      console.log('[LLM structuredChat] Sending request to:', config.baseURL);
      console.log('[LLM structuredChat] Using model:', model);
      
      const response = await axios.post(
        `${config.baseURL}chat/completions`,
        {
          model,
          messages,
          temperature,
          response_format: {
            type: 'json_schema',
            json_schema: jsonSchema
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
      console.log('[LLM structuredChat] Raw response:', content?.substring(0, 200));
      
      if (!content) {
        throw new Error('Empty response from model');
      }
      
      // 解析结果（处理可能的双重 JSON 编码）
      let parsed = content;
      
      // 如果 content 是字符串，尝试解析
      if (typeof content === 'string') {
        try {
          parsed = JSON.parse(content);
        } catch (e) {
          console.error('[LLM structuredChat] JSON parse error:', e.message);
          console.error('[LLM structuredChat] Content:', content);
          throw new LLMSchemaError(new Error(`Invalid JSON: ${e.message}`));
        }
      }
      
      // 如果解析后还是字符串（双重编码），再解析一次
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch (e) {
          // 忽略，可能本来就是字符串类型
        }
      }
      
      console.log('[LLM structuredChat] Parsed type:', typeof parsed);
      console.log('[LLM structuredChat] Parsed preview:', JSON.stringify(parsed).substring(0, 200));
      
      // 如果有 Zod Schema，进行验证
      if (schema._def && schema.parse) {
        try {
          return schema.parse(parsed);
        } catch (zodError) {
          console.error('[LLM structuredChat] Zod validation error:', zodError.errors);
          throw new LLMSchemaError(zodError);
        }
      }
      
      return parsed;
      
    } catch (error) {
      console.error('[LLM structuredChat] Request failed:', error.message);
      if (error.response) {
        console.error('[LLM structuredChat] Response status:', error.response.status);
        console.error('[LLM structuredChat] Response data:', JSON.stringify(error.response.data, null, 2));
      }
      
      if (error.response?.data?.error) {
        throw new Error(`API Error: ${error.response.data.error.message || error.response.data.error}`);
      }
      if (error.name === 'ZodError' || error instanceof LLMSchemaError) {
        throw error;
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
