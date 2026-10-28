const { getVersionFromRequest, isVersionGreaterOrEqual } = require("./version");
const { getXUserId, checkLegacyPro } = require("./legacy-pro");
const {
  isRequestXHuntVip,
  isRequestInternalTestUser,
} = require("../constants/xhuntVip");

// 最小版本号：只有 >= 0.4.05 的版本才启用数据裁切
const MIN_VERSION_FOR_PRO = "0.4.05";
const DELETED_TWEET_WINDOW_MS = 24 * 60 * 60 * 1000;
const DELETED_TWEET_HIDDEN_MESSAGE = "您暂时无法查看详细删帖内容";

function maskDeletedTweetValue(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((item) => maskDeletedTweetValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        maskDeletedTweetValue(childValue, childKey),
      ])
    );
  }

  if (typeof value === "string") {
    // 保留列表渲染、关联和时间展示所需的技术字段。
    if (key === "id" || key.endsWith("_id") || key === "create_time") {
      return value;
    }
    if (key === "text" || key === "html") {
      return DELETED_TWEET_HIDDEN_MESSAGE;
    }
    return "";
  }

  if (typeof value === "number") {
    // 保留删帖状态，其他计数与版本信息不对外展示。
    return key === "is_delete" ? value : 0;
  }

  if (typeof value === "boolean") {
    return false;
  }

  return value;
}

function applyDeletedTweetFiltering(req, data) {
  if (!data || typeof data !== "object") {
    return data;
  }

  // 内部用户不受删帖数据时间及内容限制。
  if (isRequestInternalTestUser(req)) {
    return data;
  }

  const items = data?.data?.data;
  if (!Array.isArray(items)) {
    return data;
  }

  const filtered = {
    ...data,
    data: {
      ...data.data,
    },
  };

  // 除内部用户外，所有用户都只能查看最近 24 小时内的删帖记录。
  const now = Date.now();
  const cutoff = now - DELETED_TWEET_WINDOW_MS;
  const recentItems = items.filter((item) => {
    const createTime = Date.parse(item?.create_time);
    return (
      Number.isFinite(createTime) && createTime >= cutoff && createTime <= now
    );
  });

  if (isRequestXHuntVip(req)) {
    filtered.data.data = recentItems;
    return filtered;
  }

  // 保留 24 小时内每条数据的完整结构和数组长度，只隐藏具体内容。
  filtered.data.data = recentItems.map((item) =>
    maskDeletedTweetValue(item)
  );
  filtered.proMessage = DELETED_TWEET_HIDDEN_MESSAGE;
  return filtered;
}

/**
 * Pro 用户数据裁切逻辑（统一管理）
 * 根据 req.isPro 状态和请求路径，对返回数据进行过滤
 *
 * 数据权限功能列表：
 * - 删帖功能：/public/fetch/tweet/deleted（内部用户不限时间，其他用户限最近 24 小时）
 * - 删除账户信息：/public/fetch/twitter/user（部分字段）
 * - 实时feeds流：后续实现
 * - 账户profile改变：/public/fetch/twitter/user（部分字段）
 * - 最近5条关注和被关注：/public/fetch/twitter/follow_relation
 *
 * 注意：除删帖接口外，只有版本号 >= 0.4.05 才会进行数据裁切。
 *
 * @param {express.Request} req - Express 请求对象
 * @param {any} data - 原始响应数据
 * @returns {any} 过滤后的数据
 */
function applyProDataFiltering(req, data) {
  const path = req.path;

  // 删帖接口使用内部用户 / VIP 名单控制，不受插件版本和付费 Pro 状态影响。
  if (path === "/public/fetch/tweet/deleted") {
    return applyDeletedTweetFiltering(req, data);
  }

  // 检查版本号，如果版本号 < 0.4.05，直接返回原始数据，不进行裁切
  const version = getVersionFromRequest(req);
  if (!version || !isVersionGreaterOrEqual(version, MIN_VERSION_FOR_PRO)) {
    return data;
  }

  // 如果是 Pro 用户，直接返回原始数据
  if (req.isPro === true) {
    return data;
  }

  // 检查是否是老用户 Pro（在活跃用户名单中且在 2025-12-29 之前）
  // 优先使用 req.user.username（已验证的用户名），如果没有则使用 x-user-id
  const username = req.user?.username || getXUserId(req);
  const legacyProCheck = checkLegacyPro(username);
  const isLegacyPro = legacyProCheck.isLegacyPro;

  // 如果是老用户 Pro，不进行数据裁切，但添加提示信息
  if (isLegacyPro) {
    // 检查是否是需要特殊处理的接口
    const needsLegacyMessage =
      path === "/public/fetch/twitter/user" ||
      path === "/public/fetch/twitter/follow_relation";

    if (needsLegacyMessage && data && typeof data === "object") {
      const result = { ...data };
      result.legacyProMessage =
        "You are a legacy user. As a thank you for your early support, you have access to complete data until December 29, 2025.";
      return result;
    }

    // 其他接口直接返回原始数据
    return data;
  }

  // 非 Pro 用户且不是老用户，根据路径进行数据裁切
  // 1. 账户profile接口：/public/fetch/twitter/user
  // 非 Pro 用户：将 profile_his.history 数组中每个对象只保留 name 字段
  // 数据结构：{ code: 200, message: "get data success", data: { data: { profile_his: { history: [...] } } } }
  if (path === "/public/fetch/twitter/user") {
    if (data && typeof data === "object") {
      const filtered = { ...data };

      // 处理嵌套的 data.data.profile_his.history 数组
      if (
        filtered.data &&
        typeof filtered.data === "object" &&
        filtered.data.data &&
        typeof filtered.data.data === "object" &&
        filtered.data.data.profile_his &&
        typeof filtered.data.data.profile_his === "object" &&
        Array.isArray(filtered.data.data.profile_his.history)
      ) {
        // 遍历 history 数组，每个对象只保留 name 字段
        filtered.data.data.profile_his.history =
          filtered.data.data.profile_his.history.map((item) => {
            if (item && typeof item === "object" && item.name !== undefined) {
              return { name: item.name };
            }
            // 如果没有 name 字段，返回空对象
            return {};
          });
      }

      // 在 message 同级添加提示信息
      filtered.proMessage = "Pro subscription required to get full information";

      return filtered;
    }
    return data;
  }

  // 2. 关注关系接口：/public/fetch/twitter/follow_relation
  // 非 Pro 用户：将 followed_action 和 following_action 数组的前 5 条数据变成空对象
  // 数据结构：{ code: 200, message: "get data success", data: { data: { followed_action: [...], following_action: [...] } } }
  if (path === "/public/fetch/twitter/follow_relation") {
    if (data && typeof data === "object") {
      const filtered = { ...data };

      // 处理嵌套的 data.data.followed_action 数组
      if (
        filtered.data &&
        typeof filtered.data === "object" &&
        filtered.data.data &&
        typeof filtered.data.data === "object" &&
        Array.isArray(filtered.data.data.followed_action)
      ) {
        // 将前 5 条数据变成空对象
        filtered.data.data.followed_action =
          filtered.data.data.followed_action.map((item, index) => {
            if (index < 5) {
              return {};
            }
            return item;
          });
      }

      // 处理嵌套的 data.data.following_action 数组
      if (
        filtered.data &&
        typeof filtered.data === "object" &&
        filtered.data.data &&
        typeof filtered.data.data === "object" &&
        Array.isArray(filtered.data.data.following_action)
      ) {
        // 将前 5 条数据变成空对象
        filtered.data.data.following_action =
          filtered.data.data.following_action.map((item, index) => {
            if (index < 5) {
              return {};
            }
            return item;
          });
      }

      // 在 message 同级添加提示信息
      filtered.proMessage = "Pro subscription required to get full information";

      return filtered;
    }
    return data;
  }

  // 其他路径暂不处理，返回原始数据
  return data;
}

module.exports = {
  applyProDataFiltering,
};
