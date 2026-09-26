const {
  securityMiddleware,
  fingerprintLimiter,
  rateLimiter,
  browserOnlyMiddleware,
  sseSecurityMiddleware,
} = require("../../xhunt/middleware/security");

const xHuntAuthRoutes = require("../../xhunt/api/auth");
const xHuntProxyRoutes = require("../../xhunt/api/proxy");
const xHuntReviewsRoutes = require("../../xhunt/api/reviews");
const xHuntNotesRoutes = require("../../xhunt/api/notes");
const xHuntUserSettingsRoutes = require("../../xhunt/api/user-settings");
const xHuntReportRoutes = require("../../xhunt/api/report");
const xHuntPrivateMessageRoutes = require("../../xhunt/api/private-messages");
const xHuntCampaignRoutes = require("../../xhunt/api/campaign");
const xHuntWebsiteCampaignRoutes = require("../../xhunt/api/website-campaigns");
const xHuntEchohuntRoutes = require("../../xhunt/api/echohunt");
const xHuntHotVoteRoutes = require("../../xhunt/api/hot-vote");
const xHuntUserEntryRoutes = require("../../xhunt/api/user-entry");
const xHuntSSERoutes = require("../../xhunt/api/sse");
const xHuntStatsRoutes = require("../../xhunt/api/stats");
const xHuntGhostFollowingRoutes = require("../../xhunt/api/ghost-following");
const xHuntRootdataRoutes = require("../../xhunt/api/rootdata");
const xHuntTagsRoutes = require("../../xhunt/api/tags");
const xHuntSpecialMarkersRoutes = require("../../xhunt/api/special-markers");
const xHuntTwitterRenameRoutes = require("../../xhunt/api/twitter-rename");
const xHuntAIDetectRoutes = require("../../xhunt/api/ai-detect");
const xHuntKolChatRoutes = require("../../xhunt/api/kol-chat");
const xHuntKolMarketingSearchRoutes = require("../../xhunt/api/kol-marketing");

/**
 * 注册 XHunt 插件核心业务与功能路由
 */
function registerXhuntRoutes(app) {
  app.use(
    "/api/xhunt/auth",
    fingerprintLimiter,
    browserOnlyMiddleware,
    securityMiddleware,
    xHuntAuthRoutes
  );

  app.use(
    "/api/xhunt/proxy",
    fingerprintLimiter,
    browserOnlyMiddleware,
    securityMiddleware,
    xHuntProxyRoutes
  );

  app.use(
    "/api/xhunt/reviews",
    fingerprintLimiter,
    browserOnlyMiddleware,
    securityMiddleware,
    xHuntReviewsRoutes
  );

  app.use(
    "/api/xhunt/notes",
    fingerprintLimiter,
    browserOnlyMiddleware,
    securityMiddleware,
    xHuntNotesRoutes
  );

  app.use(
    "/api/xhunt/user/settings",
    fingerprintLimiter,
    browserOnlyMiddleware,
    securityMiddleware,
    xHuntUserSettingsRoutes
  );

  app.use(
    "/api/xhunt/report",
    fingerprintLimiter, // 这里不要加浏览器验证，外部会检查健康状态
    xHuntReportRoutes
  );

  // 私信接口
  app.use("/api/xhunt/private-messages", xHuntPrivateMessageRoutes);

  // 活动接口
  app.use("/api/xhunt/campaigns", xHuntCampaignRoutes);
  app.use("/api/xhunt/website/campaigns", xHuntWebsiteCampaignRoutes);
  app.use("/api/xhunt/echohunt", xHuntEchohuntRoutes);

  // 热点投票接口
  app.use("/api/xhunt/hot-vote", xHuntHotVoteRoutes);

  // 未注册用户登记接口
  app.use("/api/xhunt/user-entry", xHuntUserEntryRoutes);

  // SSE 接口 - 实时推送数据（包含 feeds 等）
  app.use("/api/xhunt/sse", rateLimiter, sseSecurityMiddleware, xHuntSSERoutes);

  // 统计路由 - 无需安全中间件，方便内部监控
  app.use("/api/xhunt/stats", xHuntStatsRoutes);

  // Ghost Following 额度管理接口 - 分析关注列表活跃度
  app.use("/api/xhunt/ghost-following", xHuntGhostFollowingRoutes);

  // Rootdata 搜索接口 - 基于 PostgreSQL 的 Fundraising 数据 内部使用
  app.use("/api/rootdata", xHuntRootdataRoutes);

  // 用户标签查询接口 - 数据库版标签，优先按 Twitter ID 查询
  app.use(
    "/api/xhunt/tags",
    fingerprintLimiter,
    browserOnlyMiddleware,
    securityMiddleware,
    xHuntTagsRoutes
  );

  // Twitter 账号特殊标记（疑似诈骗/官方认证/自定义标记）查询接口
  app.use(
    "/api/xhunt/special-markers",
    fingerprintLimiter,
    browserOnlyMiddleware,
    securityMiddleware,
    xHuntSpecialMarkersRoutes
  );

  // Twitter 改名历史查询接口（专用代理，避免开放通用外部 URL 代理）
  app.use(
    "/api/xhunt/twitter",
    fingerprintLimiter,
    browserOnlyMiddleware,
    securityMiddleware,
    xHuntTwitterRenameRoutes
  );

  // AI 探测功能接口 - 推文内容分析和评分
  app.use(
    "/api/xhunt/ai",
    fingerprintLimiter,
    browserOnlyMiddleware,
    securityMiddleware,
    xHuntAIDetectRoutes
  );

  // KOL Chat 代理接口 - KOL AI 分身聊天
  app.use(
    "/api/xhunt/kol-chat",
    fingerprintLimiter,
    browserOnlyMiddleware,
    securityMiddleware,
    xHuntKolChatRoutes
  );

  // KOL Marketing Profile 向量检索接口
  app.use(
    "/api/xhunt/kol-marketing",
    fingerprintLimiter,
    browserOnlyMiddleware,
    securityMiddleware,
    xHuntKolMarketingSearchRoutes
  );
}

module.exports = {
  registerXhuntRoutes,
};
