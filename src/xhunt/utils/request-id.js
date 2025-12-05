const { AsyncLocalStorage } = require("async_hooks");

const requestContext = new AsyncLocalStorage();

// 防止重复增强的标志
let isEnhanced = false;
const ENHANCED_FLAG = Symbol("xhunt.console.enhanced");

const getRequestId = (req) => {
  if (!req) {
    return "no-request-id";
  }

  // 尝试从多个位置获取 requestId
  const requestId =
    req?.headers?.["x-request-id"] ||
    req?.headers?.["request-id"] ||
    req?.securityContext?.requestId;

  // 验证 requestId 是否有效（非空字符串）
  if (requestId && typeof requestId === "string" && requestId.trim()) {
    return requestId.trim();
  }

  return "no-request-id";
};

const formatRequestIdTag = (requestIdOrReq) => {
  let requestId;
  if (typeof requestIdOrReq === "string") {
    requestId = requestIdOrReq.trim() || "unknown";
  } else {
    requestId = getRequestId(requestIdOrReq);
  }
  return `[requestId=${requestId}]`;
};

const requestContextMiddleware = (req, _res, next) => {
  // 为每个请求建立独立的上下文，便于日志中关联 requestId
  try {
    requestContext.run({ req }, next);
  } catch (error) {
    // 如果 AsyncLocalStorage 出错，降级处理，继续执行请求
    // 使用 process.stderr.write 避免可能的循环调用
    process.stderr.write(
      `[request-id] AsyncLocalStorage 错误: ${error.message}\n`
    );
    next();
  }
};

const getCurrentRequest = () => {
  try {
    return requestContext.getStore()?.req;
  } catch (error) {
    // 如果获取上下文失败，返回 null
    return null;
  }
};

/**
 * 检查对象是否是 Express request 对象
 * 更严格的判断，避免误判其他有 headers 属性的对象
 */
const isExpressRequest = (obj) => {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  // Express request 对象通常有这些特征
  return (
    obj.headers &&
    typeof obj.headers === "object" &&
    (obj.method !== undefined || obj.url !== undefined || obj.path !== undefined)
  );
};

/**
 * 检查字符串是否已包含 requestId 标签
 * 使用正则表达式进行更精确的匹配，避免误判
 */
const hasRequestIdTag = (str) => {
  if (typeof str !== "string") {
    return false;
  }
  // 匹配 [requestId=...] 格式，允许在字符串任意位置
  return /\[requestId=[^\]]+\]/.test(str);
};

/**
 * 通用的 console 方法包装器，自动在日志中注入 requestId
 * 如果第一个参数是字符串，直接在字符串前面拼接 requestId
 * 如果第一个参数不是字符串，在前面插入 requestId 标签
 */
const wrapConsoleMethod = (originalMethod) => {
  if (!originalMethod || typeof originalMethod !== "function") {
    // 如果原始方法不存在或不是函数，返回空函数
    return () => {};
  }

  return function wrappedMethod(...args) {
    // 如果没有参数，直接调用原始方法
    if (args.length === 0) {
      return originalMethod.apply(console, args);
    }

    const firstArg = args[0];

    // 检查是否已经包含 requestId 标签（避免重复添加）
    if (hasRequestIdTag(firstArg)) {
      return originalMethod.apply(console, args);
    }

    // 尝试获取 requestId
    let reqFromArgs = null;
    if (isExpressRequest(firstArg)) {
      reqFromArgs = firstArg;
    }

    const requestIdTag = formatRequestIdTag(
      reqFromArgs || getCurrentRequest() || "unknown"
    );

    // 如果第一个参数是字符串，直接在字符串前面拼接 requestId
    if (typeof firstArg === "string") {
      // 处理空字符串的情况
      const enhancedMessage = firstArg
        ? `${requestIdTag} ${firstArg}`
        : requestIdTag;
      return originalMethod.apply(console, [
        enhancedMessage,
        ...args.slice(1),
      ]);
    }

    // 如果第一个参数不是字符串，在前面插入 requestId 标签
    // 但如果第一个参数是 req 对象，为了避免打印整个对象，跳过它
    if (reqFromArgs) {
      return originalMethod.apply(console, [
        requestIdTag,
        ...args.slice(1),
      ]);
    }

    // 其他情况：在前面插入 requestId 标签
    return originalMethod.apply(console, [requestIdTag, ...args]);
  };
};

/**
 * 包装所有 console 方法，自动注入 requestId
 * 支持防重复调用保护
 */
const enhanceConsoleWithRequestId = () => {
  // 防止重复增强
  if (isEnhanced) {
    return console;
  }

  const methodsToWrap = ["log", "error", "warn", "info", "debug"];
  const originalConsole = { ...console };

  methodsToWrap.forEach((method) => {
    // 检查方法是否存在且可写
    if (
      console[method] &&
      typeof console[method] === "function" &&
      !console[method][ENHANCED_FLAG]
    ) {
      const originalMethod = originalConsole[method];
      const wrapped = wrapConsoleMethod(originalMethod);
      // 标记已增强，防止重复包装
      wrapped[ENHANCED_FLAG] = true;
      console[method] = wrapped;
    }
  });

  isEnhanced = true;
  return originalConsole;
};

module.exports = {
  getRequestId,
  formatRequestIdTag,
  requestContextMiddleware,
  wrapConsoleMethod,
  enhanceConsoleWithRequestId,
};

