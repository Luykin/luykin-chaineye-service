/**
 * 统一错误处理与 404 兜底中间件
 */
function setupErrorHandlers(app) {
  // 404 Catch-all: 所有未匹配到的路由
  app.use((req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    return res.status(404).json({
      success: false,
      error: "NOT_FOUND",
      message: "Not Found",
    });
  });

  // 专门处理请求体过大的错误
  app.use((error, req, res, next) => {
    if (error.type === "entity.too.large") {
      return res.status(413).json({
        error: "请求数据过大，请减少上报数据量",
        code: "PAYLOAD_TOO_LARGE",
        maxSize: "300KB",
      });
    }
    next(error);
  });

  // 全局 500 错误处理中间件
  app.use((err, req, res, next) => {
    console.error("❌ 服务器错误:", err.message);
    console.error("❌ 错误堆栈:", err.stack);

    // 供出口日志使用的错误信息
    res.locals.errorMessage = err.message;

    // 如果是 CORS 错误，返回更友好的错误信息
    if (err.message === "Not allowed by CORS") {
      return res.status(403).json({
        error: "CORS错误：请求被阻止",
        message: "请检查域名是否在白名单中",
        origin: req.headers.origin,
      });
    }

    res.status(500).json({
      error: "服务器内部错误！",
      message: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  });
}

module.exports = {
  setupErrorHandlers,
};
