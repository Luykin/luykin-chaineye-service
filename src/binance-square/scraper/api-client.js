const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");

const BASE_URL = "https://www.binance.com";
const REQUEST_DELAY_MIN = 500;
const REQUEST_DELAY_MAX = 1200;
const REQUEST_TIMEOUT = 10000;
const MAX_RETRIES = 3;
const DEFAULT_MAX_PAGES = 30;
const PROXY_AGENT_CACHE = new Map();

function buildProxyConfig(proxyUrl) {
  if (!proxyUrl) return {};

  try {
    let httpsAgent = PROXY_AGENT_CACHE.get(proxyUrl);
    if (!httpsAgent) {
      httpsAgent = new HttpsProxyAgent(proxyUrl);
      PROXY_AGENT_CACHE.set(proxyUrl, httpsAgent);
    }
    return {
      // axios 内置 proxy 在部分 HTTP 代理访问 HTTPS 站点时会返回 400；
      // 显式使用 HTTPS proxy agent，走 CONNECT 隧道，与 curl -x 行为一致。
      httpsAgent,
      proxy: false,
    };
  } catch (e) {
    console.warn(`[api-client] 代理地址无效，已忽略: ${proxyUrl} (${e.message})`);
    return {};
  }
}

function buildRequestConfig({ timeout = REQUEST_TIMEOUT, headers = {}, proxyUrl = null, signal = null } = {}) {
  return {
    timeout,
    signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ...headers,
    },
    ...buildProxyConfig(proxyUrl),
  };
}

async function withLinkedSignal(parentSignal, fn) {
  if (!parentSignal) {
    return fn(null);
  }
  if (parentSignal.aborted) {
    throw new Error("请求已取消");
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", onAbort, { once: true });

  try {
    return await fn(controller.signal);
  } finally {
    parentSignal.removeEventListener("abort", onAbort);
  }
}


/**
 * 随机延迟（毫秒）
 */
function sleep(ms, signal = null) {
  if (signal?.aborted) {
    return Promise.reject(new Error("请求已取消"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let onAbort = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
        onAbort = null;
      }
    };

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    timer = setTimeout(() => settle(resolve), ms);
    if (signal) {
      onAbort = () => settle(reject, new Error("请求已取消"));
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function randomDelay(signal = null) {
  const ms = REQUEST_DELAY_MIN + Math.random() * (REQUEST_DELAY_MAX - REQUEST_DELAY_MIN);
  return sleep(ms, signal);
}

/**
 * 分级重试策略
 * @param {Function} fn - 异步函数
 * @param {string} operationName - 操作名称（用于日志）
 */
async function withRetry(fn, operationName, options = {}) {
  let lastError;
  const { signal = null } = options;

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      if (signal?.aborted) throw new Error("请求已取消");
      return await fn();
    } catch (error) {
      lastError = error;
      if (signal?.aborted || error.name === "CanceledError" || error.code === "ERR_CANCELED") {
        throw new Error("请求已取消");
      }

      const status = error.response?.status;
      const isNetworkError = !error.response;

      // 429 限速：等待更长时间
      if (status === 429) {
        const waitMs = (i + 1) * 5000 + Math.random() * 3000;
        console.warn(`[${operationName}] 429限流，等待 ${waitMs}ms 后重试 (${i + 1}/${MAX_RETRIES})`);
        await sleep(waitMs, signal);
        continue;
      }

      // 5xx 错误或网络错误：指数退避
      if (status >= 500 || isNetworkError) {
        const waitMs = Math.pow(2, i) * 1000 + Math.random() * 1000;
        console.warn(`[${operationName}] ${isNetworkError ? "网络错误" : `${status}错误`}，等待 ${waitMs}ms 后重试 (${i + 1}/${MAX_RETRIES})`);
        await sleep(waitMs, signal);
        continue;
      }

      // 4xx 错误（除429外）：不再重试
      if (status >= 400) {
        throw error;
      }
    }
  }

  throw lastError;
}

/**
 * 获取用户关注列表（分页遍历全部）
 * @param {string} targetUsername - 目标用户名（如 "CZ"）
 * @returns {Promise<{followers: Array, total: number}>}
 */
async function fetchFollowingList(targetUsername, options = {}) {
  const allFollowings = [];
  let pageIndex = 1;
  let hasMore = true;
  let total = 0;

  while (hasMore) {
    const res = await withRetry(
      () =>
        withLinkedSignal(options.signal, (requestSignal) =>
          axios.post(
            `${BASE_URL}/bapi/composite/v3/friendly/pgc/user/following`,
            {
              targetUsername,
              pageIndex,
              pageSize: 20,
            },
            buildRequestConfig({
              proxyUrl: options.proxyUrl,
              signal: requestSignal,
              headers: { "Content-Type": "application/json" },
            })
          )
        ),
      `fetchFollowingList(${targetUsername}, page=${pageIndex})`,
      { signal: options.signal }
    );

    if (!res.data?.success || !res.data.data?.followers) {
      console.warn(`[fetchFollowingList] ${targetUsername} 第${pageIndex}页返回异常:`, res.data);
      break;
    }

    const pageData = res.data.data;
    allFollowings.push(...pageData.followers);
    total = pageData.total || 0;

    hasMore = pageIndex * 20 < total;
    pageIndex++;

    if (hasMore) {
      await randomDelay(options.signal);
    }
  }

  return {
    followers: allFollowings,
    total,
  };
}

/**
 * 获取用户个人主页资料（profile页使用的接口）
 * @param {string} username - 用户名（如 "CZ"）
 * @returns {Promise<Object>}
 */
async function fetchUserProfile(username, options = {}) {
  const res = await withRetry(
    () =>
      withLinkedSignal(options.signal, (requestSignal) =>
        axios.post(
          `${BASE_URL}/bapi/composite/v3/friendly/pgc/user/client`,
          { username },
          buildRequestConfig({
            proxyUrl: options.proxyUrl,
            signal: requestSignal,
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json, text/plain, */*",
              "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
              "Referer": `${BASE_URL}/zh-CN/square/profile/${encodeURIComponent(username)}`,
              "clienttype": "web",
            },
          })
        )
      ),
    `fetchUserProfile(${username})`,
    { signal: options.signal }
  );

  if (!res.data?.success || !res.data.data?.username) {
    throw new Error(`用户Profile返回异常: ${JSON.stringify(res.data).slice(0, 300)}`);
  }

  return res.data.data;
}

/**
 * 获取用户帖子列表
 * @param {string} squareUid - 用户的squareUid
 * @param {string} filterType - "ALL" | "REPLY" | "QUOTE"
 * @param {number} daysBack - 回溯天数（默认7天，全量模式用）
 * @param {boolean} onlyFirstPage - 是否只查第一页（增量模式用，默认false）
 * @returns {Promise<{contents: Array, timeOffset: number}>}
 */
async function fetchUserPosts(squareUid, filterType = "ALL", daysBack = 7, onlyFirstPage = false, options = {}) {
  const allContents = [];
  let timeOffset = -1;
  let hasMore = true;
  const cutoffTime = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const maxPages = Math.max(1, Number(options.maxPages || DEFAULT_MAX_PAGES));
  let pageCount = 0;
  const seenOffsets = new Set();

  while (hasMore) {
    if (options.signal?.aborted) throw new Error("请求已取消");
    pageCount++;
    if (pageCount > maxPages) {
      console.warn(`[fetchUserPosts] ${squareUid} ${filterType} 超过最大页数 ${maxPages}，提前停止`);
      break;
    }

    const res = await withRetry(
      () =>
        withLinkedSignal(options.signal, (requestSignal) =>
          axios.get(
            `${BASE_URL}/bapi/composite/v2/friendly/pgc/content/queryUserProfilePageContentsWithFilter`,
            {
              ...buildRequestConfig({ proxyUrl: options.proxyUrl, signal: requestSignal }),
              params: {
                targetSquareUid: squareUid,
                timeOffset,
                filterType,
              },
            }
          )
        ),
      `fetchUserPosts(${squareUid}, ${filterType}, timeOffset=${timeOffset})`,
      { signal: options.signal }
    );

    if (!res.data?.success || !res.data.data) {
      console.warn(`[fetchUserPosts] ${squareUid} ${filterType} 返回异常:`, res.data);
      break;
    }

    const pageData = res.data.data;
    const contents = pageData.contents || [];

    if (contents.length === 0) {
      break;
    }

    allContents.push(...contents);

    // 增量模式：只查第一页，直接退出
    if (onlyFirstPage) {
      break;
    }

    // 检查最后一篇帖子的时间
    const lastPost = contents[contents.length - 1];
    const lastPostTime = lastPost.latestReleaseTime || lastPost.createTime || 0;

    if (lastPostTime < cutoffTime) {
      hasMore = false;
    } else if (!lastPostTime || seenOffsets.has(String(lastPostTime)) || String(lastPostTime) === String(timeOffset)) {
      console.warn(`[fetchUserPosts] ${squareUid} ${filterType} timeOffset 未推进(${lastPostTime})，提前停止，避免循环`);
      hasMore = false;
    } else {
      seenOffsets.add(String(timeOffset));
      timeOffset = lastPostTime;
      await randomDelay(options.signal);
    }
  }

  return {
    contents: allContents,
  };
}

/**
 * 获取帖子详情（用于补全回复帖的内容和计数）
 * @param {string|number} postId - 帖子ID
 * @returns {Promise<Object|null>} 详情数据，失败返回null
 */
async function fetchPostDetail(postId, options = {}) {
  try {
    const res = await withRetry(
      () =>
        withLinkedSignal(options.signal, (requestSignal) =>
          axios.get(
            `${BASE_URL}/bapi/composite/v3/friendly/pgc/special/content/detail/${postId}`,
            buildRequestConfig({ proxyUrl: options.proxyUrl, signal: requestSignal })
          )
        ),
      `fetchPostDetail(${postId})`,
      { signal: options.signal }
    );

    if (!res.data?.success || !res.data.data) {
      console.warn(`[fetchPostDetail] ${postId} 返回异常:`, res.data);
      return null;
    }

    return res.data.data;
  } catch (error) {
    console.warn(`[fetchPostDetail] ${postId} 获取失败:`, error.message);
    return null;
  }
}

module.exports = {
  fetchFollowingList,
  fetchUserProfile,
  fetchUserPosts,
  fetchPostDetail,
};
