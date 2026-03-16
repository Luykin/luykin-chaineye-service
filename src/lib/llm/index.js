/**
 * LLM 调用中心 - 主入口
 * 
 * 提供便捷方法：
 * - chat() - 普通对话
 * - streamChat() - 流式对话  
 * - structuredChat() - 结构化输出
 * 
 * 基础实例（直接用 LangChain）：
 * - getChatModel() - 获取 ChatOpenAI 实例
 * 
 * 使用方式：
 * const { chat, structuredChat, z } = require('../lib/llm');
 * 
 * // 自定义 Schema
 * const MySchema = z.object({ name: z.string() });
 * const result = await structuredChat('分析', MySchema);
 */

const { chat, streamChat } = require('./chat');
const { structuredChat } = require('./structured');
const { getChatModel, clearModelCache, getCacheStats } = require('./models');
const { z } = require('zod');

module.exports = {
  // ===== 便捷方法（简单场景，推荐）=====
  chat,
  streamChat,
  structuredChat,
  
  // ===== 基础实例（复杂场景，直接用 LangChain）=====
  getChatModel,       // 获取 ChatOpenAI 实例
  clearModelCache,    // 清空模型缓存
  getCacheStats,      // 获取缓存统计
  
  // 导出 zod 方便自定义 Schema
  z,
};
