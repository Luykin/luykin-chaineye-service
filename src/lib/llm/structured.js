/**
 * 结构化输出对话
 * 
 * 使用示例：
 * 
 * ===== 示例1：基本使用 =====
 * 
 * const { structuredChat, z } = require('../lib/llm');
 * 
 * // 定义 Schema（在使用的地方定义）
 * const ProjectSchema = z.object({
 *   projectName: z.string(),
 *   category: z.enum(['DeFi', 'NFT', 'GameFi', 'Infra', 'Other']),
 *   riskLevel: z.enum(['low', 'medium', 'high']),
 *   summary: z.string().max(200),
 * });
 * 
 * const result = await structuredChat(
 *   '分析这个项目：Uniswap 是一个去中心化交易所...',
 *   ProjectSchema
 * );
 * 
 * console.log(result);
 * // {
 * //   projectName: 'Uniswap',
 * //   category: 'DeFi',
 * //   riskLevel: 'medium',
 * //   keyInvestors: ['a16z', 'Paradigm'],
 * //   summary: 'Uniswap 是以太坊上最大的 DEX...',
 * //   tags: ['DEX', 'AMM', 'DeFi'],
 * //   potentialScore: 8
 * // }
 * 
 * 
 * ===== 示例2：自定义 Schema =====
 * 
 * const { structuredChat, z } = require('../lib/llm');
 * 
 * // 自定义分析 Schema
 * const TweetAnalysisSchema = z.object({
 *   sentiment: z.enum(['positive', 'negative', 'neutral']).describe('情感倾向'),
 *   confidence: z.number().min(0).max(1).describe('置信度'),
 *   keywords: z.array(z.string()).describe('关键词'),
 * });
 * 
 * const tweet = '比特币突破新高！牛市来了！';
 * 
 * const analysis = await structuredChat(
 *   `分析这条推文：${tweet}`,
 *   TweetAnalysisSchema,
 *   { name: 'tweet_analysis' }  // 用于日志追踪
 * );
 * 
 * console.log(analysis);
 * // {
 * //   sentiment: 'positive',
 * //   confidence: 0.92,
 * //   keywords: ['比特币', '新高', '牛市']
 * // }
 * 
 * 
 * ===== 示例3：指定模型和系统提示 =====
 * 
 * const { structuredChat, schemas } = require('../lib/llm');
 * 
 * const result = await structuredChat(
 *   '分析：以太坊 Layer 2 解决方案',
 *   schemas.ProjectAnalysisSchema,
 *   {
 *     model: 'gpt-4o',                    // 指定用更好的模型
 *     temperature: 0,                     // 结构化输出建议用 0
 *     name: 'layer2_analysis',            // 标识名
 *     systemPrompt: '你是资深的区块链研究员，擅长技术架构分析。'  // 系统提示
 *   }
 * );
 * 
 * 
 * ===== 示例4：处理错误 =====
 * 
 * const { structuredChat, LLMSchemaError } = require('../lib/llm');
 * 
 * try {
 *   const result = await structuredChat('分析', MySchema);
 * } catch (error) {
 *   if (error instanceof LLMSchemaError) {
 *     // Schema 解析失败（模型输出格式不对）
 *     console.error('Schema 解析失败:', error.message);
 *   } else {
 *     // 其他错误（网络、API Key 等）
 *     console.error('调用失败:', error.message);
 *   }
 * }
 */

const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { getChatModel } = require('./models');
const { withRetry, LLMSchemaError } = require('./utils/errors');

/**
 * 将 Zod Schema 转换为 OpenAI 函数调用格式
 * @param {z.ZodSchema} schema 
 * @param {string} name 
 * @returns {Object}
 */
function schemaToFunction(schema, name) {
  // 尝试从 schema 获取描述
  const description = schema.description || `${name} output`;
  
  return {
    name,
    description,
    parameters: zodSchemaToJsonSchema(schema),
  };
}

/**
 * 简化的 Zod to JSON Schema 转换
 * @param {z.ZodSchema} zodSchema 
 * @returns {Object}
 */
function zodSchemaToJsonSchema(zodSchema) {
  // 使用 zod 的 _def 来获取内部结构
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
      type: 'object',
      properties,
      required,
    };
  }
  
  return zodTypeToJsonSchema(zodSchema);
}

/**
 * 单个 Zod 类型转换
 * @param {z.ZodType} type 
 * @returns {Object}
 */
function zodTypeToJsonSchema(type) {
  const def = type._def;
  
  switch (def.typeName) {
    case 'ZodString':
      return { 
        type: 'string',
        description: def.description,
      };
    case 'ZodNumber':
      return { 
        type: 'number',
        description: def.description,
        ...(def.minimum !== undefined && { minimum: def.minimum }),
        ...(def.maximum !== undefined && { maximum: def.maximum }),
      };
    case 'ZodBoolean':
      return { 
        type: 'boolean',
        description: def.description,
      };
    case 'ZodArray':
      return {
        type: 'array',
        items: zodTypeToJsonSchema(def.type),
        description: def.description,
      };
    case 'ZodEnum':
      return {
        type: 'string',
        enum: def.values,
        description: def.description,
      };
    case 'ZodOptional':
      return zodTypeToJsonSchema(def.innerType);
    case 'ZodDefault':
      return zodTypeToJsonSchema(def.innerType);
    default:
      return { type: 'string' };
  }
}

/**
 * 结构化对话 - 返回按 Schema 定义的对象
 * @param {string} message - 用户消息
 * @param {z.ZodSchema} schema - Zod Schema
 * @param {Object} options - 选项
 * @param {string} options.model - 模型名称
 * @param {number} options.temperature - 温度（默认 0）
 * @param {string} options.name - schema 名称（用于日志）
 * @param {string} options.systemPrompt - 系统提示
 * @returns {Promise<Object>}
 */
async function structuredChat(message, schema, options = {}) {
  const {
    model,
    temperature = 0,  // 结构化输出建议用 0
    name = 'structured_output',
    systemPrompt,
  } = options;

  return withRetry(async () => {
    const llm = getChatModel({ 
      model, 
      temperature,
    });

    // 构建消息
    const messages = [];
    
    if (systemPrompt) {
      messages.push(new SystemMessage(systemPrompt));
    }
    
    messages.push(new HumanMessage(message));

    // 使用 function calling 方式
    const functionDef = schemaToFunction(schema, name);
    
    try {
      const response = await llm.bind({
        functions: [functionDef],
        function_call: { name },
      }).invoke(messages);

      // 解析函数调用结果
      const functionCall = response.additional_kwargs?.function_call;
      
      if (functionCall && functionCall.arguments) {
        const parsed = JSON.parse(functionCall.arguments);
        
        // 用 Zod 验证
        return schema.parse(parsed);
      }
      
      // 如果没有 function_call，尝试直接解析 content
      const content = response.content;
      if (typeof content === 'string') {
        try {
          const parsed = JSON.parse(content);
          return schema.parse(parsed);
        } catch (e) {
          throw new LLMSchemaError(new Error(`无法解析输出: ${content}`));
        }
      }
      
      throw new LLMSchemaError(new Error('模型未返回有效输出'));
    } catch (error) {
      if (error.name === 'ZodError') {
        throw new LLMSchemaError(error);
      }
      throw error;
    }
  });
}

module.exports = {
  structuredChat,
};
