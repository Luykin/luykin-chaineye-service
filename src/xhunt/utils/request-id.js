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

const consoleErrorWithRequestId =
  (originalConsoleError = console.error) =>
  (...args) => {
    const firstArg = args[0];
    const hasTag =
      typeof firstArg === "string" && firstArg.startsWith("[requestId=");

    if (hasTag) {
      return originalConsoleError(...args);
    }

    // 如果调用方显式传入了 req，优先使用；否则尝试从上下文获取
    const reqFromArgs =
      firstArg && typeof firstArg === "object" && firstArg.headers
        ? firstArg
        : null;

    const requestIdTag = formatRequestIdTag(
      reqFromArgs || getCurrentRequest() || "unknown"
    );

    // 如果第一个参数就是 req，为避免打印出整个对象，这里剔除它
    const printableArgs = reqFromArgs ? args.slice(1) : args;

    return originalConsoleError(requestIdTag, ...printableArgs);
  };

module.exports = {
  getRequestId,
  formatRequestIdTag,
  requestContextMiddleware,
  consoleErrorWithRequestId,
};

