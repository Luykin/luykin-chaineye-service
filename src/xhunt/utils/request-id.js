const { AsyncLocalStorage } = require("async_hooks");
const util = require("util");

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


const LOG_LEVEL_PRIORITY = {
  error: 0,
  warn: 1,
  info: 2,
  log: 2,
  debug: 3,
  silent: -1,
};

const rateLimitState = new Map();

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
};

const parseNumber = (value, defaultValue) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const getConsoleLogConfig = () => {
  const logLevel = String(process.env.LOG_LEVEL || "info").toLowerCase();
  return {
    level: LOG_LEVEL_PRIORITY[logLevel] === undefined ? "info" : logLevel,
    rateLimitEnabled: parseBool(process.env.LOG_RATE_LIMIT_ENABLED, true),
    rateLimitWindowMs: parseNumber(process.env.LOG_RATE_LIMIT_WINDOW_MS, 30 * 1000),
    rateLimitMax: parseNumber(process.env.LOG_RATE_LIMIT_MAX, 5),
    warnRateLimitMax: parseNumber(process.env.LOG_WARN_RATE_LIMIT_MAX, 10),
    errorRateLimitMax: parseNumber(process.env.LOG_ERROR_RATE_LIMIT_MAX, 20),
    maxArgChars: parseNumber(process.env.LOG_MAX_ARG_CHARS, 1200),
    objectDepth: parseNumber(process.env.LOG_OBJECT_DEPTH, 2),
    maxArrayLength: parseNumber(process.env.LOG_MAX_ARRAY_LENGTH, 20),
    maxRateLimitKeys: parseNumber(process.env.LOG_MAX_RATE_LIMIT_KEYS, 2000),
  };
};

const getMethodPriority = (method) => {
  if (method === "error") return LOG_LEVEL_PRIORITY.error;
  if (method === "warn") return LOG_LEVEL_PRIORITY.warn;
  if (method === "debug") return LOG_LEVEL_PRIORITY.debug;
  return LOG_LEVEL_PRIORITY.info;
};

const shouldLogByLevel = (method, config) => {
  if (config.level === "silent") return false;
  return getMethodPriority(method) <= LOG_LEVEL_PRIORITY[config.level];
};

const truncateString = (value, maxLength) => {
  if (typeof value !== "string" || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
};

const sanitizeLogArg = (arg, config) => {
  const maxLength = config.maxArgChars;
  if (typeof arg === "string") return truncateString(arg, maxLength);
  if (arg instanceof Error) {
    return truncateString(arg.stack || arg.message || String(arg), maxLength);
  }
  if (typeof arg === "object" && arg !== null) {
    try {
      return truncateString(
        util.inspect(arg, {
          depth: config.objectDepth,
          maxArrayLength: config.maxArrayLength,
          maxStringLength: Math.max(100, Math.floor(maxLength / 2)),
          breakLength: 160,
          compact: true,
        }),
        maxLength
      );
    } catch (error) {
      return "[Uninspectable object]";
    }
  }
  return arg;
};

const normalizeLogKey = (method, args) => {
  const firstArg = args[0];
  let message;
  if (typeof firstArg === "string") {
    message = firstArg;
  } else if (firstArg instanceof Error) {
    message = firstArg.message || firstArg.name || "Error";
  } else {
    message = util.inspect(firstArg, { depth: 1, maxArrayLength: 5, maxStringLength: 80 });
  }

  message = String(message || "")
    .replace(/\[requestId=[^\]]+\]/g, "[requestId=*]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/twid\d+/gi, "twid#")
    .replace(/\b\d{4,}\b/g, "#")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<iso-time>")
    .slice(0, 240);

  return `${method}:${message}`;
};

const getRateLimitMax = (method, config) => {
  if (method === "error") return config.errorRateLimitMax;
  if (method === "warn") return config.warnRateLimitMax;
  return config.rateLimitMax;
};

const shouldLogByRateLimit = (method, args, config, originalConsole) => {
  if (!config.rateLimitEnabled) return true;

  const maxLogs = getRateLimitMax(method, config);
  if (maxLogs <= 0) return false;

  const now = Date.now();
  const windowMs = Math.max(1000, config.rateLimitWindowMs);
  const key = normalizeLogKey(method, args);
  let state = rateLimitState.get(key);

  if (!state || now - state.windowStart >= windowMs) {
    if (state && state.suppressed > 0) {
      originalConsole.warn.call(
        console,
        `[logger] suppressed ${state.suppressed} repeated ${method} logs in ${windowMs}ms: ${key.slice(0, 180)}`
      );
    }
    state = { windowStart: now, count: 0, suppressed: 0 };
    rateLimitState.set(key, state);

    if (rateLimitState.size > config.maxRateLimitKeys) {
      const keysToDelete = Array.from(rateLimitState.keys()).slice(
        0,
        Math.ceil(config.maxRateLimitKeys / 4)
      );
      keysToDelete.forEach((k) => rateLimitState.delete(k));
    }
  }

  state.count += 1;
  if (state.count <= maxLogs) return true;

  state.suppressed += 1;
  return false;
};

/**
 * 通用的 console 方法包装器，自动在日志中注入 requestId
 * 如果第一个参数是字符串，直接在字符串前面拼接 requestId
 * 如果第一个参数不是字符串，在前面插入 requestId 标签
 */
const wrapConsoleMethod = (originalMethod, method = "log", originalConsole = console) => {
  if (!originalMethod || typeof originalMethod !== "function") {
    // 如果原始方法不存在或不是函数，返回空函数
    return () => {};
  }

  return function wrappedMethod(...args) {
    const config = getConsoleLogConfig();

    if (!shouldLogByLevel(method, config)) {
      return;
    }

    if (!shouldLogByRateLimit(method, args, config, originalConsole)) {
      return;
    }

    const sanitizedArgs = args.map((arg) => sanitizeLogArg(arg, config));

    // 如果没有参数，直接调用原始方法
    if (sanitizedArgs.length === 0) {
      return originalMethod.apply(console, sanitizedArgs);
    }

    const rawFirstArg = args[0];
    const firstArg = sanitizedArgs[0];

    // 检查是否已经包含 requestId 标签（避免重复添加）
    if (hasRequestIdTag(firstArg)) {
      return originalMethod.apply(console, sanitizedArgs);
    }

    // 尝试获取 requestId
    let reqFromArgs = null;
    if (isExpressRequest(rawFirstArg)) {
      reqFromArgs = rawFirstArg;
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
        ...sanitizedArgs.slice(1),
      ]);
    }

    // 如果第一个参数不是字符串，在前面插入 requestId 标签
    // 但如果第一个参数是 req 对象，为了避免打印整个对象，跳过它
    if (reqFromArgs) {
      return originalMethod.apply(console, [
        requestIdTag,
        ...sanitizedArgs.slice(1),
      ]);
    }

    // 其他情况：在前面插入 requestId 标签
    return originalMethod.apply(console, [requestIdTag, ...sanitizedArgs]);
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
      const wrapped = wrapConsoleMethod(originalMethod, method, originalConsole);
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

