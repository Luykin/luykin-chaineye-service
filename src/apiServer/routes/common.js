const fundraisingRoutes = require("../../routes/fundraising");
const cryptoRoutes = require("../../routes/cryptohunt-tg");
const proxyRoutes = require("../../routes/proxy");
const newsRoutes = require("../../routes/ex-news");
const generalRoutes = require("../../routes/general");
const rootdataTampermonkeyRoutes = require("../../routes/rootdata-tampermonkey");
const socialListeningInternalRoutes = require("../../routes/social-listening-internal");
const internalQueryRoutes = require("../../routes/internal-query");
const { adminAuth } = require("../../admin/middleware/adminAuth");

const INTERNAL_QUERY_EXPIRATION = new Date("2027-02-20T00:00:00Z");

/**
 * 注册通用与第三方工具路由
 */
function registerCommonRoutes(app) {
  app.use("/api/fundraising", fundraisingRoutes);
  app.use("/api/crypto", cryptoRoutes);
  app.use("/api/proxy", adminAuth, proxyRoutes);
  app.use("/api/news", newsRoutes);
  app.use("/api/general", generalRoutes);

  // RootData Fundraising Tampermonkey 采集入口（独立 token 校验，不使用 admin JWT）
  app.use("/api/internal/rootdata/fundraising", rootdataTampermonkeyRoutes);

  // Social Listening 爬虫补充搜索关键词（公开只读接口）
  app.use("/api/internal/social-listening", socialListeningInternalRoutes);

  // 内部查询API - 使用随机字符前缀，无需安全中间件
  app.use(
    "/api/internal-x9k2m7p4q8",
    (req, res, next) => {
      if (new Date() >= INTERNAL_QUERY_EXPIRATION) {
        return res.status(403).json({
          success: false,
          error: "FORBIDDEN",
          message: "请联系管理员开通权限",
        });
      }
      next();
    },
    internalQueryRoutes
  );
}

module.exports = {
  registerCommonRoutes,
};
