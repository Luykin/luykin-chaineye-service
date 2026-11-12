const { registerCommonRoutes } = require("./common");
const { registerAuthCenterRoutes } = require("./auth-center");
const { registerXhuntRoutes } = require("./xhunt");
const { registerAdminRoutes } = require("./admin");
const { adminAuth } = require("../../admin/middleware/adminAuth");
const xhuntInternalVipRoutes = require("../../xhunt/api/internal-vip");

/**
 * 统一注册所有业务与管理路由
 * @param {import("express").Express} app
 * @param {{ perfApiRouter?: any }} options
 */
function registerRoutes(app, { perfApiRouter } = {}) {
  // 1. 通用业务与工具路由 (/api/fundraising, /api/crypto, /api/news 等)
  registerCommonRoutes(app);

  // 2. 统一登录认证中心路由 (/api/xhunt/auth-center, /api/xhunt/web/auth 等)
  registerAuthCenterRoutes(app);

  // 独立服务凭证鉴权的 XHunt VIP 内部会员接口
  app.use("/api/internal/xhunt/v1/vip", xhuntInternalVipRoutes);

  // 3. XHunt 插件业务路由 (/api/xhunt/auth, /api/xhunt/reviews, /api/xhunt/notes 等)
  registerXhuntRoutes(app);

  // 4. 性能监控 API (需管理员鉴权)
  if (perfApiRouter) {
    app.use("/api/stats/perf", adminAuth, perfApiRouter);
  }

  // 5. 管理后台路由 (/admin, /api/admin/*)
  registerAdminRoutes(app);
}

module.exports = {
  registerRoutes,
};
