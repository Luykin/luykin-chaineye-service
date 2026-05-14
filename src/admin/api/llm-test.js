/**
 * 管理后台 - LLM 测试工具 API
 * 
 * 提供接口：
 * - POST /api/admin/llm-test - 执行测试
 * - GET /api/admin/llm-test/models - 可用模型列表
 * 
 * 注意：前端页面已迁移到 React 管理后台
 */

const express = require('express');
const { adminAuth } = require('../middleware/adminAuth');
const { chat, structuredChat } = require('../../lib/llm');
const { z } = require('zod');

const router = express.Router();

// 可用模型列表
const AVAILABLE_MODELS = [
  { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash lite Preview（默认）', default: true },
  { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'v0/Kimi-K2.5', label: 'Kimi K2.5' },
  { value: 'v0/gpt-5-mini', label: 'GPT-5 Mini' },
  { value: 'v0/deepseek-v3.2', label: 'DeepSeek V3.2' },
];

/**
 * 将 JSON Schema 转换为 Zod Schema（简化版）
 * 支持：string, number, boolean, array, enum, object
 */
function jsonSchemaToZod(schema, required = true) {
  if (!schema || typeof schema !== 'object') {
    return z.any();
  }

  // 处理 anyOf/oneOf（简化处理，取第一个）
  if (schema.anyOf || schema.oneOf) {
    const variants = schema.anyOf || schema.oneOf;
    if (variants.length > 0) {
      return jsonSchemaToZod(variants[0], required);
    }
  }

  let zodType;

  switch (schema.type) {
    case 'string':
      zodType = z.string();
      if (schema.enum) {
        zodType = z.enum(schema.enum);
      }
      if (schema.minLength !== undefined) {
        zodType = zodType.min(schema.minLength);
      }
      if (schema.maxLength !== undefined) {
        zodType = zodType.max(schema.maxLength);
      }
      break;

    case 'number':
    case 'integer':
      zodType = schema.type === 'integer' ? z.number().int() : z.number();
      if (schema.minimum !== undefined) {
        zodType = zodType.min(schema.minimum);
      }
      if (schema.maximum !== undefined) {
        zodType = zodType.max(schema.maximum);
      }
      break;

    case 'boolean':
      zodType = z.boolean();
      break;

    case 'array':
      const itemSchema = jsonSchemaToZod(schema.items, true);
      zodType = z.array(itemSchema);
      if (schema.minItems !== undefined) {
        zodType = zodType.min(schema.minItems);
      }
      if (schema.maxItems !== undefined) {
        zodType = zodType.max(schema.maxItems);
      }
      break;

    case 'object':
      const shape = {};
      const requiredFields = schema.required || [];
      
      for (const [key, propSchema] of Object.entries(schema.properties || {})) {
        const isRequired = requiredFields.includes(key);
        shape[key] = jsonSchemaToZod(propSchema, isRequired);
      }
      
      zodType = z.object(shape);
      break;

    default:
      zodType = z.any();
  }

  // 添加描述（用于传给模型）
  if (schema.description) {
    zodType = zodType.describe(schema.description);
  }

  return zodType;
}

/**
 * 解析 JSON Schema
 */
function parseJsonSchema(jsonSchema) {
  if (!jsonSchema || Object.keys(jsonSchema).length === 0) {
    return null;
  }

  try {
    return jsonSchemaToZod(jsonSchema, true);
  } catch (error) {
    throw new Error(`Schema 解析失败: ${error.message}`);
  }
}

// ========== 路由 ==========

/**
 * GET /api/admin/llm-test/models
 * 获取可用模型列表
 */
router.get('/models', adminAuth, (req, res) => {
  res.json({
    success: true,
    data: AVAILABLE_MODELS,
  });
});

/**
 * POST /api/admin/llm-test
 * 执行 LLM 测试
 * 
 * Body: {
 *   prompt: string,
 *   model: string,
 *   temperature: number (0-2),
 *   outputFormat: 'text' | 'json',
 *   jsonSchema?: object,
 *   systemPrompt?: string
 * }
 */
router.post('/', adminAuth, express.json(), async (req, res) => {
  try {
    const {
      prompt,
      model = 'gemini-3.1-flash-lite-preview',
      temperature = 0.7,
      outputFormat = 'text',
      jsonSchema,
      systemPrompt,
    } = req.body;
    
    // 从 header 获取 requestId
    const requestId = req.headers['x-request-id'] || null;

    // 参数校验
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        success: false,
        error: '请输入提示词 (prompt)',
      });
    }

    // 校验模型
    const validModel = AVAILABLE_MODELS.find(m => m.value === model);
    if (!validModel) {
      return res.status(400).json({
        success: false,
        error: '无效的模型选择',
      });
    }

    // 校验温度
    const temp = parseFloat(temperature);
    if (isNaN(temp) || temp < 0 || temp > 2) {
      return res.status(400).json({
        success: false,
        error: '温度必须在 0-2 之间',
      });
    }

    const startTime = Date.now();
    let result;
    let error = null;

    console.log(`[LLM Test] [${requestId || 'N/A'}] Starting LLM call... Model: ${model}, OutputFormat: ${outputFormat}`);

    try {
      if (outputFormat === 'json' && jsonSchema) {
        // 结构化输出模式 - 直接传递原始 JSON Schema
        console.log(`[LLM Test] [${requestId || 'N/A'}] Calling structuredChat with JSON Schema...`);
        
        result = await structuredChat(prompt, jsonSchema, {
          model,
          temperature: temp,
          systemPrompt: systemPrompt || undefined,
        });
        console.log(`[LLM Test] [${requestId || 'N/A'}] structuredChat completed`);
      } else {
        // 文本输出模式
        console.log(`[LLM Test] [${requestId || 'N/A'}] Calling chat...`);
        result = await chat(prompt, {
          model,
          temperature: temp,
          systemPrompt: systemPrompt || undefined,
          responseFormat: 'json_object',
        });
        console.log(`[LLM Test] [${requestId || 'N/A'}] chat completed`);
      }
    } catch (err) {
      error = {
        message: err.message,
        type: err.name || 'Error',
      };
      console.error(`[LLM Test] [${requestId || 'N/A'}] Error during LLM call:`, err);
    }

    const duration = Date.now() - startTime;

    // 记录测试日志
    console.log(`[LLM Test] [${requestId || 'N/A'}] Completed. User: ${req.admin?.email || 'unknown'}, Model: ${model}, Duration: ${duration}ms, Success: ${!error}`);

    res.json({
      success: !error,
      data: error ? null : result,
      error,
      meta: {
        model,
        temperature: temp,
        outputFormat,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
        requestId: requestId || null,
      },
    });

  } catch (error) {
    console.error('[LLM Test] Unexpected error:', error);
    res.status(500).json({
      success: false,
      error: '服务器内部错误',
    });
  }
});

module.exports = router;
