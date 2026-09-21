const { setupSqlite } = require("../../models/sqlite-start");
const { setupPostgres, pgInstance } = require("../../models/postgres-start");
const { setupPostgresFundraising } = require("../../models/postgres-fundraising");
const {
  isPostgresReadOnlyConfigured,
  setupK8sPostgresReadOnlyConnection,
} = require("../../infra/k8s/postgres-readonly");
const {
  isPostgresWriteConfigured,
  setupK8sPostgresWriteConnection,
} = require("../../infra/k8s/postgres-write");
const binanceSquareRoutes = require("../../binance-square/api/binance-square");
const { loadVipLists, startRefreshSubscriber } = require("../../xhunt/constants/xhuntVip");

const SOCIAL_LISTENING_READONLY_SCOPE = "social-listening";

/**
 * 初始化数据库与后台基础服务 (SQLite, PostgreSQL, 只读从库, 可写主库, 币安广场, VIP内存缓存)
 */
async function initDatabasesAndServices() {
  // 初始化数据库
  // PostgreSQL版本: 16.9
  await setupSqlite(); // 初始化本地 SQLite
  await setupPostgres(); // 初始化主 PostgreSQL（src/models/postgres-start.js：cryptohunt + xhunt 相关业务表）
  await setupPostgresFundraising(); // 初始xhunt里面老版本化融资业务 PostgreSQL

  if (isPostgresReadOnlyConfigured()) {
    try {
      await setupK8sPostgresReadOnlyConnection(); // 初始化 K8s 注入的 PostgreSQL 只读从库连接；不执行 sync
    } catch (error) {
      console.error(
        "[API Server] ❌ 默认 PostgreSQL 只读从库初始化失败，依赖默认只读从库的业务接口会返回 503:",
        error.message
      );
    }
  } else {
    console.warn("[API Server] 默认 PostgreSQL 只读从库未配置，依赖默认只读从库的业务接口会返回 503");
  }

  if (isPostgresReadOnlyConfigured(SOCIAL_LISTENING_READONLY_SCOPE)) {
    try {
      await setupK8sPostgresReadOnlyConnection(SOCIAL_LISTENING_READONLY_SCOPE); // 初始化 Social Listening 独立只读池；不执行 sync
    } catch (error) {
      console.error(
        "[API Server] ❌ Social Listening 只读从库初始化失败，相关接口会返回 503:",
        error.message
      );
    }
  } else {
    console.warn("[API Server] Social Listening 只读从库未配置，相关接口会返回 503");
  }

  if (isPostgresWriteConfigured()) {
    try {
      await setupK8sPostgresWriteConnection(); // 初始化 PostgreSQL 可写主库连接；不执行 sync
    } catch (error) {
      console.error(
        "[API Server] ❌ PostgreSQL 可写主库初始化失败，KOL 商务合作画像同步会跳过:",
        error.message
      );
    }
  } else {
    console.warn("[API Server] PostgreSQL 可写主库未配置，KOL 商务合作画像同步会跳过");
  }

  // 初始化币安广场模型（使用主业务 PostgreSQL 实例 pgInstance）
  try {
    binanceSquareRoutes.initRoutes(pgInstance);
    console.log("[API Server] 币安广场模型初始化完成");
  } catch (e) {
    console.error("[API Server] ❌ 币安广场模型初始化失败:", e.message);
  }

  // 加载 VIP / 内测用户名单到内存（依赖 PostgreSQL 已连接）
  try {
    await loadVipLists();
    // 启动 Redis Pub/Sub 订阅，实时同步其他 worker 的修改
    startRefreshSubscriber().catch((e) => {
      console.error("[API Server] ❌ 启动 VIP 实时同步失败:", e.message);
    });
  } catch (e) {
    console.error("[API Server] ❌ 加载 VIP 名单失败:", e.message);
    console.error("[API Server] 提示: 如果表不存在，请先执行 yarn db:migrate:pg 和 node scripts/seed-vip-lists.js");
  }
}

module.exports = {
  initDatabasesAndServices,
};
