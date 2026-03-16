/**
 * LLM 服务配置
 * 
 * 注意：环境变量延迟读取，确保 dotenv 已加载
 */

// 配置默认值
const DEFAULT_CONFIG = {
  // LiteLLM 服务地址
  baseURL: 'https://aaii.xclaw.info/v1/',
  
  // 默认模型
  defaultModel: 'gemini-3-flash-preview',
  
  // 默认温度（0.3 = 保守稳定，适合数据分析类任务）
  temperature: 0.3,
  
  // 请求超时（毫秒）- 延长到 120 秒，避免 LLM 服务慢时超时
  timeout: 120000,
  
  // 失败重试次数
  maxRetries: 3,
};

/**
 * 获取 API Key（延迟读取，确保 dotenv 已加载）
 */
function getApiKey() {
  const key = process.env.LLM_API_KEY;
  
  if (!key) {
    console.warn('[LLM Config] Warning: LLM_API_KEY not set in environment variables');
  }
  
  return key;
}

// 导出配置
module.exports = {
  ...DEFAULT_CONFIG,
  get apiKey() {
    return getApiKey();
  },
};
