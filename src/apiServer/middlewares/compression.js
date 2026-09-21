const compression = require("compression");

/**
 * 条件性压缩：排除流式路由和 SSE 路由
 */
function conditionalCompressionMiddleware(req, res, next) {
  if (
    req.path.includes("/api/xhunt/proxy/public-stream/") ||
    req.path.includes("/api/xhunt/sse") ||
    req.path.includes("/api/xhunt/echohunt/kol-match/ai-search/stream")
  ) {
    // 流式路由和 SSE 路由跳过压缩中间件
    return next();
  }
  // 非流式路由应用压缩。静态资源会按 Accept-Encoding 协商 gzip/br（由 compression 中间件处理）。
  compression({ threshold: 1024 })(req, res, next);
}

module.exports = {
  conditionalCompressionMiddleware,
};
