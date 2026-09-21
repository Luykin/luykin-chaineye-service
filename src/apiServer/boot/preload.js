const path = require("path");

/**
 * 启动时模块预加载检查 - 防止运行时路径错误导致崩溃
 * 路径基准为 src 根目录
 */
const MODULES_TO_PRELOAD = [
  // 模型层
  './models/sqlite-start',
  './models/postgres-start',
  './models/postgres-fundraising',
  './infra/k8s/postgres-readonly',
  './infra/k8s/postgres-write',

  // XHunt API 路由
  './xhunt/api/auth',
  './xhunt/api/web-auth',
  './xhunt/auth-center/api/auth-center',
  './xhunt/auth-center/api/internal',
  './xhunt/web-security/middleware/web-signature',
  './xhunt/api/proxy',
  './xhunt/api/reviews',
  './xhunt/api/notes',
  './xhunt/api/report',
  './xhunt/api/stats',
  './xhunt/api/mantle',
  './xhunt/api/campaign',
  './xhunt/api/website-campaigns',
  './xhunt/api/echohunt',
  './xhunt/social-listening/api/public',
  './xhunt/social-listening/api/admin',
  './xhunt/social-listening/services/board-service',
  './xhunt/social-listening/services/ingest-service',
  './xhunt/social-listening/services/analysis-service',
  './xhunt/social-listening/services/scheduler',
  './xhunt/api/private-messages',
  './xhunt/api/rootdata',
  './xhunt/api/ghost-following',
  './xhunt/api/pro-api-credits',
  './xhunt/api/sse',
  './xhunt/api/user-entry',
  './xhunt/api/ai-detect',
  './xhunt/api/kol-chat',
  './xhunt/api/kol-marketing',
  './xhunt/api/tags',
  './xhunt/api/twitter-rename',
  './xhunt/api/hot-vote',
  './xhunt/api/hot-vote-admin',

  // Admin API
  './admin/api/admin',
  './admin/api/reviews',
  './admin/api/tampermonkey',
  './admin/api/kol-marketing',

  // 币安广场
  './binance-square/api/binance-square',

  // 其他路由
  './routes/fundraising',
  './routes/cryptohunt-tg',
  './routes/proxy',
  './routes/ex-news',
  './routes/general',
  './routes/rootdata-tampermonkey',
  './routes/internal-query',

  // RootDataPro 已完全停止：不要在 API 启动时 preload，避免触发爬虫 TaskManager 初始化。
  // './rootdatapro/api/rootdatapro',

  // 中间件
  './xhunt/middleware/security',
  './xhunt/middleware/auth',
  './admin/middleware/adminAuth',

  // 工具模块
  './lib/redisClient',
  './lib/perf-monitor',
  './xhunt/utils/request-id',
];

function preloadCriticalModules() {
  console.log('[Preload] 开始预加载关键模块...');
  const preloadErrors = [];
  const srcRoot = path.resolve(__dirname, "../../");

  for (const mod of MODULES_TO_PRELOAD) {
    const fullPath = path.resolve(srcRoot, mod);
    try {
      require(fullPath);
      // console.log(`[Preload] ✓ ${mod}`);
    } catch (err) {
      console.error(`[Preload] ✗ ${mod} 加载失败:`, err.message);
      preloadErrors.push({ module: mod, error: err.message });
    }
  }

  if (preloadErrors.length > 0) {
    console.error('[Preload] 致命错误: 以下模块加载失败，应用无法启动:');
    preloadErrors.forEach((e) => console.error(`  - ${e.module}: ${e.error}`));
    process.exit(1);
  }
  console.log(`[Preload] ✓ 所有 ${MODULES_TO_PRELOAD.length} 个模块预加载成功`);
}

module.exports = {
  MODULES_TO_PRELOAD,
  preloadCriticalModules,
};
