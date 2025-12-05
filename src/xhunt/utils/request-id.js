const { AsyncLocalStorage } = require("async_hooks");

const requestContext = new AsyncLocalStorage();

const getRequestId = (req) =>
  req?.headers?.["x-request-id"] ||
  req?.headers?.["request-id"] ||
  req?.securityContext?.requestId ||
  "no-request-id";

const formatRequestIdTag = (requestIdOrReq) => {
  const requestId =
    typeof requestIdOrReq === "string"
      ? requestIdOrReq
      : getRequestId(requestIdOrReq);
  return `[requestId=${requestId || "unknown"}]`;
};

const requestContextMiddleware = (req, _res, next) => {
  // 为每个请求建立独立的上下文，便于日志中关联 requestId
  requestContext.run({ req }, next);
};

const getCurrentRequest = () => requestContext.getStore()?.req;

/**
 * 通用的 console 方法包装器，自动在日志中注入 requestId
 * 如果第一个参数是字符串，直接在字符串前面拼接 requestId
 * 如果第一个参数不是字符串，在前面插入 requestId 标签
 */
const wrapConsoleMethod = (originalMethod) => {
  return (...args) => {
    if (args.length === 0) {
      return originalMethod(...args);
    }

    const firstArg = args[0];

    // 检查是否已经包含 requestId 标签（避免重复添加）
    const hasTag =
      typeof firstArg === "string" && firstArg.includes("[requestId=");

    if (hasTag) {
      return originalMethod(...args);
    }

    // 尝试获取 requestId
    let reqFromArgs = null;
    if (firstArg && typeof firstArg === "object" && firstArg.headers) {
      reqFromArgs = firstArg;
    }

    const requestIdTag = formatRequestIdTag(
      reqFromArgs || getCurrentRequest() || "unknown"
    );

    // 如果第一个参数是字符串，直接在字符串前面拼接 requestId
    if (typeof firstArg === "string") {
      const enhancedMessage = `${requestIdTag} ${firstArg}`;
      return originalMethod(enhancedMessage, ...args.slice(1));
    }

    // 如果第一个参数不是字符串，在前面插入 requestId 标签
    // 但如果第一个参数是 req 对象，为了避免打印整个对象，跳过它
    if (reqFromArgs) {
      return originalMethod(requestIdTag, ...args.slice(1));
    }

    return originalMethod(requestIdTag, ...args);
  };
};

/**
 * 包装所有 console 方法，自动注入 requestId
 */
const enhanceConsoleWithRequestId = () => {
  const methodsToWrap = ["log", "error", "warn", "info", "debug"];
  const originalConsole = { ...console };

  methodsToWrap.forEach((method) => {
    console[method] = wrapConsoleMethod(originalConsole[method]);
  });

  return originalConsole;
};

module.exports = {
  getRequestId,
  formatRequestIdTag,
  requestContextMiddleware,
  wrapConsoleMethod,
  enhanceConsoleWithRequestId,
};

