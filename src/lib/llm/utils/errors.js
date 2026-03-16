/**
 * LLM 错误定义
 */

class LLMError extends Error {
  constructor(message, type, retryable = false) {
    super(message);
    this.name = 'LLMError';
    this.type = type;
    this.retryable = retryable;
  }
}

class LLMTimeoutError extends LLMError {
  constructor(message = '请求超时') {
    super(message, 'TIMEOUT', true);
    this.name = 'LLMTimeoutError';
  }
}

class LLMRateLimitError extends LLMError {
  constructor(message = '触发速率限制') {
    super(message, 'RATE_LIMIT', true);
    this.name = 'LLMRateLimitError';
  }
}

class LLMSchemaError extends LLMError {
  constructor(originalError) {
    super(`Schema 解析失败: ${originalError.message}`, 'SCHEMA_ERROR', false);
    this.name = 'LLMSchemaError';
    this.originalError = originalError;
  }
}

class LLMAPIError extends LLMError {
  constructor(message, statusCode) {
    super(message, 'API_ERROR', statusCode >= 500);
    this.name = 'LLMAPIError';
    this.statusCode = statusCode;
  }
}

/**
 * 睡眠函数
 * @param {number} ms - 毫秒
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带重试的包装函数
 * @param {Function} fn - 要执行的函数
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise<any>}
 */
async function withRetry(fn, maxRetries = 3) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // 判断是否需要重试
      const shouldRetry = error.retryable || 
        (error.code === 'ECONNRESET') ||
        (error.code === 'ETIMEDOUT') ||
        (error.statusCode >= 500);
      
      if (!shouldRetry || i === maxRetries - 1) {
        throw error;
      }
      
      // 指数退避：1s, 2s, 4s
      const delay = 1000 * Math.pow(2, i);
      console.log(`[LLM] Retry ${i + 1}/${maxRetries} after ${delay}ms`);
      await sleep(delay);
    }
  }
  
  throw lastError;
}

module.exports = {
  LLMError,
  LLMTimeoutError,
  LLMRateLimitError,
  LLMSchemaError,
  LLMAPIError,
  withRetry,
  sleep,
};
