/**
 * LLM 服务配置
 * 除 API Key 外，其他配置都使用代码默认值
 * 
 * 温度 (temperature) 说明：
 * - 0.0: 最确定，输出稳定（适合结构化输出、分类）
 * - 0.3: 保守稳定（适合数据分析、摘要，默认）
 * - 0.7: 有创造性（适合对话、写作）
 * - 1.0+: 很随机（适合头脑风暴）
 */

const DEFAULT_CONFIG = {
  // LiteLLM 服务地址
  baseURL: 'https://aaii.xclaw.info/v1/',
  
  // 默认模型
  defaultModel: 'gemini-3-flash-preview',
  
  // 默认温度（0.3 = 保守稳定，适合数据分析类任务）
  // 对话类场景建议手动设为 0.7：chat('你好', { temperature: 0.7 })
  temperature: 0.3,
  
  // 请求超时（毫秒）
  timeout: 60000,
  
  // 失败重试次数
  maxRetries: 3,
};

// 从环境变量读取 API Key
const apiKey = process.env.LLM_API_KEY;

if (!apiKey) {
  console.warn('[LLM] Warning: LLM_API_KEY not set in environment variables');
}

module.exports = {
  ...DEFAULT_CONFIG,
  apiKey,
};
