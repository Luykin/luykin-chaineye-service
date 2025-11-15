const {
  getVersionFromRequest,
  isVersionGreaterOrEqual,
} = require("./version");

// 最小版本号：只有 >= 0.2.05 的版本才启用数据裁切
const MIN_VERSION_FOR_PRO = "0.2.05";

/**
 * Pro 用户数据裁切逻辑（统一管理）
 * 根据 req.isPro 状态和请求路径，对返回数据进行过滤
 *
 * Pro 功能列表（非 Pro 用户需要过滤）：
 * - 删帖功能：/public/fetch/tweet/deleted
 * - 删除账户信息：/public/fetch/twitter/user（部分字段）
 * - 实时feeds流：后续实现
 * - 账户profile改变：/public/fetch/twitter/user（部分字段）
 * - 最近5条关注和被关注：后续实现
 *
 * 注意：只有版本号 >= 0.2.05 才会进行数据裁切，否则直接返回原始数据
 *
 * @param {express.Request} req - Express 请求对象
 * @param {any} data - 原始响应数据
 * @returns {any} 过滤后的数据
 */
function applyProDataFiltering(req, data) {
  // 检查版本号，如果版本号 < 0.2.05，直接返回原始数据，不进行裁切
  const version = getVersionFromRequest(req);
  if (!version || !isVersionGreaterOrEqual(version, MIN_VERSION_FOR_PRO)) {
    return data;
  }

  // 如果是 Pro 用户，直接返回原始数据
  if (req.isPro === true) {
    return data;
  }

  // 非 Pro 用户，根据路径进行数据裁切
  const path = req.path;

  // 1. 删帖接口：/public/fetch/tweet/deleted
  // 非 Pro 用户：将 data.data 数组中每个对象的 info 变成空对象，text 变成空字符串
  // 数据结构：{ code: 200, message: "get data success", data: { data: [...] } }
  if (path === "/public/fetch/tweet/deleted") {
    if (data && typeof data === "object") {
      const filtered = { ...data };

      // 处理嵌套的 data.data 数组
      if (
        filtered.data &&
        typeof filtered.data === "object" &&
        Array.isArray(filtered.data.data)
      ) {
        // 遍历数组，对每个对象进行处理
        filtered.data.data = filtered.data.data.map((item) => {
          if (item && typeof item === "object") {
            const filteredItem = { ...item };
            // 将 info 变成空对象
            if (filteredItem.info !== undefined) {
              filteredItem.info = {};
            }
            // 将 text 变成空字符串
            if (filteredItem.text !== undefined) {
              filteredItem.text = "";
            }
            return filteredItem;
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

  // 2. 账户profile接口：/public/fetch/twitter/user
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

  // 其他路径暂不处理，返回原始数据
  return data;
}

module.exports = {
  applyProDataFiltering,
};

