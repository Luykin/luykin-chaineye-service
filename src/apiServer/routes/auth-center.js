const xHuntWebAuthRoutes = require("../../xhunt/api/web-auth");
const xHuntAuthCenterRoutes = require("../../xhunt/auth-center/api/auth-center");
const xHuntAuthCenterInternalRoutes = require("../../xhunt/auth-center/api/internal");
const { webSignatureMiddleware } = require("../../xhunt/web-security/middleware/web-signature");

/**
 * 注册认证中心相关路由 (Web认证, 统一登录认证中心, 内部token校验)
 */
function registerAuthCenterRoutes(app) {
  // XHunt Web 用户认证接口（周边网站登录）
  app.use("/api/xhunt/web/auth", xHuntWebAuthRoutes);

  // XHunt 登录认证中心内部接口（服务端校验 token，不走 Web 签名）
  app.use("/api/xhunt/auth-center/internal", xHuntAuthCenterInternalRoutes);

  // XHunt 登录认证中心接口（多 Web 端统一登录）
  app.use("/api/xhunt/auth-center", webSignatureMiddleware(), xHuntAuthCenterRoutes);
}

module.exports = {
  registerAuthCenterRoutes,
};
