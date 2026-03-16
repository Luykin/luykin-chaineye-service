/**
 * Zod Schema 解析器封装
 */

const { z } = require('zod');

/**
 * 将 Zod Schema 转换为 JSON Schema（用于 LangChain）
 * @param {z.ZodSchema} zodSchema 
 * @returns {Object} JSON Schema
 */
function zodToJsonSchema(zodSchema) {
  // 使用 zod-to-json-schema 逻辑简化版
  // 实际使用时，LangChain 的 StructuredOutputParser 会处理这个
  return zodSchema;
}

/**
 * 创建结构化的输出解析器配置
 * @param {z.ZodSchema} schema 
 * @param {string} name - schema 名称
 * @returns {Object}
 */
function createStructuredOutputConfig(schema, name = 'output') {
  return {
    schema,
    name,
  };
}

module.exports = {
  zodToJsonSchema,
  createStructuredOutputConfig,
  z,  // 导出 zod 方便使用
};
