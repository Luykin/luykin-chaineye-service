const {
  isRequestXHuntVip,
  isRequestInternalTestUser,
} = require("../constants/xhuntVip");

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
    if (
      key === "id" ||
      key.endsWith("_id") ||
      key === "first_confirmed_at" ||
      key === "last_check"
    ) {
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

  const isVip = isRequestXHuntVip(req);
  const result = {
    ...data,
    isVip,
  };

  // 内部用户不受删帖数据时间及内容限制。
  if (isRequestInternalTestUser(req)) {
    return result;
  }

  const items = data?.data?.data;
  if (!Array.isArray(items)) {
    return result;
  }

  const filtered = {
    ...result,
    data: {
      ...data.data,
    },
  };

  // VIP 仅能查看最近 24 小时内的详细内容，超时记录仍返回但隐藏内容。
  const now = Date.now();
  const cutoff = now - DELETED_TWEET_WINDOW_MS;
  const isRecentItem = (item) => {
    const confirmedAt = Date.parse(
      item?.first_confirmed_at || item?.last_check
    );
    return (
      Number.isFinite(confirmedAt) &&
      confirmedAt >= cutoff &&
      confirmedAt <= now
    );
  };

  if (isVip) {
    filtered.data.data = items.map((item) =>
      isRecentItem(item) ? item : maskDeletedTweetValue(item)
    );
    return filtered;
  }

  // 普通用户保留每条数据的完整结构和数组长度，但隐藏全部具体内容。
  filtered.data.data = items.map((item) =>
    maskDeletedTweetValue(item)
  );
  filtered.proMessage = DELETED_TWEET_HIDDEN_MESSAGE;
  return filtered;
}

/**
 * 保留代理层现有入口名称，仅处理仍在使用的删帖 VIP 裁剪。
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

  return data;
}

module.exports = {
  applyProDataFiltering,
};
