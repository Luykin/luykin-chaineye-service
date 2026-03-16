/**
 * 结构化输出对话 - 使用 LangChain withStructuredOutput
 */

const { z } = require('zod');
const { getChatModel } = require('./models');
const { withRetry, LLMSchemaError } = require('./utils/errors');

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
 * 将 Zod Schema 转换为 JSON Schema（用于 LangChain）
 */
function zodToJsonSchema(zodSchema, name = 'output') {
  const def = zodSchema._def;
  
  if (def.typeName === 'ZodObject') {
    const properties = {};
    const required = [];
    
    for (const [key, value] of Object.entries(def.shape())) {
      properties[key] = zodTypeToJsonSchema(value);
      if (!value.isOptional()) {
        required.push(key);
      }
    }
    
    return {
      name,
      description: zodSchema.description || 'Structured output',
      strict: true,
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
    strict: true,
    schema: {
      type: 'object',
      properties: {
        value: zodTypeToJsonSchema(zodSchema)
      },
      required: ['value'],
      additionalProperties: false
    }
  };
}

function zodTypeToJsonSchema(type) {
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
        items: zodTypeToJsonSchema(def.type)
      };
      if (def.description) result.description = def.description;
      return result;
    }
    case 'ZodEnum': {
      const result = { type: 'string', enum: def.values };
      if (def.description) result.description = def.description;
      return result;
    }
    case 'ZodOptional':
      return zodTypeToJsonSchema(def.innerType);
    case 'ZodNullable': {
      const inner = zodTypeToJsonSchema(def.innerType);
      return { ...inner, nullable: true };
    }
    case 'ZodObject': {
      const properties = {};
      const required = [];
      
      for (const [key, value] of Object.entries(def.shape())) {
        properties[key] = zodTypeToJsonSchema(value);
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
 * 结构化对话 - 使用 LangChain withStructuredOutput
 */
async function structuredChat(message, schema, options = {}) {
  const {
    model: modelName,
    temperature = 0,
    name = 'structured_output',
    systemPrompt,
  } = options;

  return withRetry(async () => {
    // 获取模型实例（复用 models.js 的缓存）
    const llm = getChatModel({ 
      model: modelName, 
      temperature,
      streaming: false 
    });
    
    // 转换 schema
    let jsonSchema;
    let zodSchema;
    
    if (schema._def) {
      // 是 Zod Schema
      jsonSchema = zodToJsonSchema(schema, name);
      zodSchema = schema;
    } else {
      // 是普通 JSON Schema
      jsonSchema = {
        name,
        description: schema.description || 'Structured output',
        strict: true,
        schema: schema
      };
      zodSchema = jsonSchemaToZod(schema);
    }
    
    try {
      // 使用 withStructuredOutput 绑定 schema
      const structuredLlm = llm.withStructuredOutput(jsonSchema, {
        name: name,
        strict: true
      });
      
      // 构建消息
      const messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: message });
      
      // 调用模型
      const result = await structuredLlm.invoke(messages);
      
      // 使用 Zod 验证（如果提供了 Zod Schema）
      if (schema._def && zodSchema.parse) {
        try {
          return zodSchema.parse(result);
        } catch (zodError) {
          console.error('[LLM structuredChat] Zod validation error:', zodError);
          throw formatZodError(zodError, result);
        }
      }
      
      return result;
      
    } catch (error) {
      console.error('[LLM structuredChat] Error:', error.message, error.stack);
      
      // 处理 LangChain 错误
      if (error.message?.includes('strict mode')) {
        throw new LLMSchemaError(new Error(
          '模型不支持严格 Schema 模式，请尝试简化 Schema 或更换模型'
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
