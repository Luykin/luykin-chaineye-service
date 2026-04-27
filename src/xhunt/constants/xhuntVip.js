// XHunt VIP / Internal Test Users
// 数据从数据库 xhunt_vip_test_users 加载到内存 Set，供同步查询使用
// 启动后由 apiServer.js 调用 loadVipLists() 进行初始化
//
// 多 worker 同步机制：
// 1. 每个 worker 启动时从数据库加载全量名单
// 2. 任一 worker 修改名单后，通过 Redis Pub/Sub 广播通知所有 worker 刷新
// 3. 若 Redis Pub/Sub 不可用，保留 60 秒定时兜底刷新

const { XhuntVipTestUser } = require("../../models/postgres-start");
const { getRedisClient } = require("../../lib/redisClient");

const XHUNT_VIP = new Set();
const INTERNAL_TEST_USERS = new Set();

let loaded = false;
let subscriberClient = null;
let fallbackTimer = null;
const FALLBACK_INTERVAL_MS = 60_000;
const REFRESH_CHANNEL = "xhunt:vip:refresh";

async function loadVipLists() {
  try {
    const rows = await XhuntVipTestUser.findAll({
      attributes: ["username", "listType"],
      raw: true,
    });

    XHUNT_VIP.clear();
    INTERNAL_TEST_USERS.clear();

    for (const row of rows) {
      const name = String(row.username || "").toLowerCase().trim();
      if (!name) continue;
      if (row.listType === "vip") {
        XHUNT_VIP.add(name);
      } else if (row.listType === "internal_test") {
        INTERNAL_TEST_USERS.add(name);
      }
    }

    loaded = true;
    console.log(
      `[xhuntVip] 名单加载完成: VIP=${XHUNT_VIP.size}, 内测=${INTERNAL_TEST_USERS.size}`
    );
  } catch (err) {
    console.error("[xhuntVip] 加载名单失败:", err.message);
    throw err;
  }
}

/**
 * 启动 Redis Pub/Sub 订阅，实时接收刷新通知
 */
async function startRefreshSubscriber() {
  if (subscriberClient) return; // 防止重复启动
  try {
    const redis = await getRedisClient();
    if (!redis) {
      console.warn("[xhuntVip] Redis 不可用，跳过 Pub/Sub 订阅");
      startFallbackTimer();
      return;
    }

    // 使用 duplicate 创建独立的 subscriber 连接
    subscriberClient = redis.duplicate();

    // 断线重连后自动重新订阅
    subscriberClient.on("connect", async () => {
      try {
        await subscriberClient.subscribe(REFRESH_CHANNEL, (message) => {
          loadVipLists().catch((err) => {
            console.error("[xhuntVip] Pub/Sub 触发刷新失败:", err.message);
          });
        });
        console.log("[xhuntVip] Redis Pub/Sub 订阅成功，频道:", REFRESH_CHANNEL);
      } catch (err) {
        console.error("[xhuntVip] 重新订阅失败:", err.message);
      }
    });

    subscriberClient.on("error", (err) => {
      console.error("[xhuntVip] Subscriber 连接错误:", err.message);
    });

    await subscriberClient.connect();

    // Pub/Sub 成功后，取消兜底定时器（如果存在）
    if (fallbackTimer) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
  } catch (err) {
    console.error("[xhuntVip] Pub/Sub 启动失败:", err.message);
    startFallbackTimer();
  }
}

/**
 * 通知所有 worker 刷新名单（由执行写操作的 worker 调用）
 */
async function notifyRefresh() {
  try {
    const redis = await getRedisClient();
    if (!redis) return;
    await redis.publish(REFRESH_CHANNEL, "refresh");
  } catch (err) {
    console.error("[xhuntVip] Pub/Sub 通知失败:", err.message);
  }
}

function startFallbackTimer() {
  if (fallbackTimer) return;
  fallbackTimer = setInterval(() => {
    loadVipLists().catch((err) => {
      console.error("[xhuntVip] 兜底定时刷新失败:", err.message);
    });
  }, FALLBACK_INTERVAL_MS);
  if (fallbackTimer.unref) fallbackTimer.unref();
  console.log("[xhuntVip] 已启动兜底定时刷新，间隔:", FALLBACK_INTERVAL_MS, "ms");
}

function isXHuntVipHandle(handle) {
  if (!handle || typeof handle !== "string") return false;
  return XHUNT_VIP.has(handle.toLowerCase().trim());
}

function isInternalTestUserHandle(handle) {
  if (!handle || typeof handle !== "string") return false;
  return INTERNAL_TEST_USERS.has(handle.toLowerCase().trim());
}

function isRequestXHuntVip(req) {
  try {
    const raw = req && req.headers ? req.headers["x-user-id"] : null;
    if (!raw || typeof raw !== "string") return false;
    return isXHuntVipHandle(raw);
  } catch (_) {
    return false;
  }
}

function isRequestInternalTestUser(req) {
  try {
    const raw = req && req.headers ? req.headers["x-user-id"] : null;
    if (!raw || typeof raw !== "string") return false;
    return isInternalTestUserHandle(raw);
  } catch (_) {
    return false;
  }
}

module.exports = {
  XHUNT_VIP,
  INTERNAL_TEST_USERS,
  isXHuntVipHandle,
  isRequestXHuntVip,
  isInternalTestUserHandle,
  isRequestInternalTestUser,
  loadVipLists,
  startRefreshSubscriber,
  notifyRefresh,
};
