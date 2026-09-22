const adminRoutes = require("../../admin/api/admin");
const adminReviewsRoutes = require("../../admin/api/reviews");
const adminLlmTestRoutes = require("../../admin/api/llm-test");
const adminTampermonkeyRoutes = require("../../admin/api/tampermonkey");
const adminKolMarketingRoutes = require("../../admin/api/kol-marketing");
const adminBusinessCollaborationRoutes = require("../../admin/api/business-collaboration");
const adminSocialListeningRoutes = require("../../xhunt/social-listening/api/admin");
const binanceSquareRoutes = require("../../binance-square/api/binance-square");
const xHuntHotVoteAdminRoutes = require("../../xhunt/api/hot-vote-admin");
const { adminAuth, requirePermission } = require("../../admin/middleware/adminAuth");

/**
 * 注册管理后台相关路由
 */
function registerAdminRoutes(app) {
  // 管理后台（登录、会话、管理员基础配置）
  app.use("/admin", adminRoutes);

  // 管理后台 - 热点投票管理
  app.use("/api/admin/hot-vote", adminAuth, requirePermission("hot-vote"), xHuntHotVoteAdminRoutes);

  // 管理后台 - 评论管理
  app.use("/api/admin/reviews", adminAuth, adminReviewsRoutes);

  // 管理后台 - LLM 测试工具 API
  app.use("/api/admin/llm-test", adminAuth, adminLlmTestRoutes);

  // 管理后台 - Tampermonkey 采集脚本与 token 管理
  app.use("/api/admin/tampermonkey", adminAuth, adminTampermonkeyRoutes);

  // 管理后台 - KOL Marketing 只读状态（供 KOL Match 配置页展示）
  app.use("/api/admin/kol-marketing", adminAuth, adminKolMarketingRoutes);

  // 管理后台 - 定向合作活动
  app.use("/api/admin/business-collaboration", adminAuth, adminBusinessCollaborationRoutes);

  // 管理后台 - EchoHunt Social Listening
  app.use("/api/admin/social-listening", adminAuth, adminSocialListeningRoutes);

  // 管理后台 - 币安广场
  app.use("/api/admin/binance-square", adminAuth, binanceSquareRoutes.router);
}

module.exports = {
  registerAdminRoutes,
};
