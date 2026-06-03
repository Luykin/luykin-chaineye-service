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
const XHUNT_VIP_IDS = new Set();
const INTERNAL_TEST_USER_IDS = new Set();

let loaded = false;
let subscriberClient = null;
let fallbackTimer = null;
const FALLBACK_INTERVAL_MS = 60_000;
const REFRESH_CHANNEL = "xhunt:vip:refresh";

async function loadVipLists() {
  try {
    const rows = await XhuntVipTestUser.findAll({
      attributes: ["username", "twitterId", "listType"],
      raw: true,
    });

    XHUNT_VIP.clear();
    INTERNAL_TEST_USERS.clear();
    XHUNT_VIP_IDS.clear();
    INTERNAL_TEST_USER_IDS.clear();

    for (const row of rows) {
      const name = String(row.username || "").toLowerCase().trim();
      const twitterId = String(row.twitterId || "").trim();
      if (!name && !twitterId) continue;
      if (row.listType === "vip") {
        if (name) XHUNT_VIP.add(name);
        if (twitterId) XHUNT_VIP_IDS.add(twitterId);
      } else if (row.listType === "internal_test") {
        if (name) INTERNAL_TEST_USERS.add(name);
        if (twitterId) INTERNAL_TEST_USER_IDS.add(twitterId);
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

function normalizeIdentifier(value) {
  if (Array.isArray(value)) return normalizeIdentifier(value[0]);
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isXHuntVipHandle(handle) {
  const raw = normalizeIdentifier(handle);
  if (!raw) return false;
  // 优先兼容 Twitter ID，其次兼容旧的 username 判断
  if (XHUNT_VIP_IDS.has(raw)) return true;
  return XHUNT_VIP.has(raw.toLowerCase());
}

function isInternalTestUserHandle(handle) {
  const raw = normalizeIdentifier(handle);
  if (!raw) return false;
  if (INTERNAL_TEST_USER_IDS.has(raw)) return true;
  return INTERNAL_TEST_USERS.has(raw.toLowerCase());
}

function extractTwitterIdFromRequestId(value) {
  const raw = normalizeIdentifier(value);
  if (!raw) return "";
  const match = raw.match(/(?:^|-)twid(\d+)(?:$|[^\d])/i);
  return match ? match[1] : "";
}

function getRequestIdentifiers(req) {
  const headers = req && req.headers ? req.headers : {};
  return [
    // 优先使用登录态中的 Twitter ID
    req?.user?.twitterId,
    // 其次使用 x-request-id 中的 twid，例如: xxx-twid1300679567988801536
    extractTwitterIdFromRequestId(headers["x-request-id"]),
  ].map(normalizeIdentifier).filter(Boolean);
}

function isRequestXHuntVip(req) {
  try {
    // 只按 Twitter ID 判断：优先 req.user.twitterId，其次 x-request-id 中的 twid
    return getRequestIdentifiers(req).some(isXHuntVipHandle);
  } catch (_) {
    return false;
  }
}

function isRequestInternalTestUser(req) {
  try {
    return getRequestIdentifiers(req).some(isInternalTestUserHandle);
  } catch (_) {
    return false;
  }
}

module.exports = {
  isRequestXHuntVip,
  isRequestInternalTestUser,
  loadVipLists,
  startRefreshSubscriber,
  notifyRefresh,
};
