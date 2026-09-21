const { requestContextMiddleware } = require("../../xhunt/utils/request-id");
const { rateLimiter } = require("../../xhunt/middleware/security");
const { corsMiddleware } = require("./cors");
const { helmetCspMiddleware, setupAdditionalSecurityHeaders } = require("./security");
const { conditionalCompressionMiddleware } = require("./compression");
const { setupLoggingMiddlewares } = require("./logger");
const { setupBodyParsers } = require("./body-parser");
const { setupStaticAssets } = require("./static-assets");

/**
 * 严格按顺序装配全局前置中间件流水线
 * @param {import("express").Express} app
 * @param {{ redisClient: any, perfMiddleware?: any }} options
 */
function setupMiddlewares(app, { redisClient, perfMiddleware } = {}) {
  // 1. 将请求注入异步上下文，便于日志获取 requestId
  app.use(requestContextMiddleware);

  // 2. 性能监控中间件（若启用）
  if (perfMiddleware) {
    app.use(perfMiddleware);
  }

  // 3. 将 redisClient 注入请求上下文
  if (redisClient) {
    app.use((req, res, next) => {
      req.redisClient = redisClient;
      next();
    });
  }

  // 4. 信任第一层代理 & CORS
  app.set("trust proxy", 1);
  app.use(corsMiddleware);

  // 5. 内容安全策略 (CSP)
  app.use(helmetCspMiddleware);

  // 6. 全局速率限制
  app.use(rateLimiter);

  // 7. 条件性压缩：排除流式路由和 SSE 路由
  app.use(conditionalCompressionMiddleware);

  // 8. Morgan 访问日志（入口 immediate 与出口 cost_ms）
  setupLoggingMiddlewares(app);

  // 9. 额外安全响应头 (hidePoweredBy, xssFilter, noSniff)
  setupAdditionalSecurityHeaders(app);

  // 10. 请求体解析（特殊大 body 优先，默认 200KB 兜底）
  setupBodyParsers(app);

  // 11. 静态文件长短协商缓存
  setupStaticAssets(app);
}

module.exports = {
  setupMiddlewares,
};
