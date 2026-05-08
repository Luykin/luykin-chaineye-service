const axios = require("axios");

const BASE_URL = "https://www.binance.com";
const REQUEST_DELAY_MIN = 500;
const REQUEST_DELAY_MAX = 1200;
const REQUEST_TIMEOUT = 10000;
const MAX_RETRIES = 3;

/**
 * 随机延迟（毫秒）
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay() {
  const ms = REQUEST_DELAY_MIN + Math.random() * (REQUEST_DELAY_MAX - REQUEST_DELAY_MIN);
  return sleep(ms);
}

/**
 * 分级重试策略
 * @param {Function} fn - 异步函数
 * @param {string} operationName - 操作名称（用于日志）
 */
async function withRetry(fn, operationName) {
  let lastError;

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const status = error.response?.status;
      const isNetworkError = !error.response;

      // 429 限速：等待更长时间
      if (status === 429) {
        const waitMs = (i + 1) * 5000 + Math.random() * 3000;
        console.warn(`[${operationName}] 429限流，等待 ${waitMs}ms 后重试 (${i + 1}/${MAX_RETRIES})`);
        await sleep(waitMs);
        continue;
      }

      // 5xx 错误或网络错误：指数退避
      if (status >= 500 || isNetworkError) {
        const waitMs = Math.pow(2, i) * 1000 + Math.random() * 1000;
        console.warn(`[${operationName}] ${isNetworkError ? "网络错误" : `${status}错误`}，等待 ${waitMs}ms 后重试 (${i + 1}/${MAX_RETRIES})`);
        await sleep(waitMs);
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
async function fetchFollowingList(targetUsername) {
  const allFollowings = [];
  let pageIndex = 1;
  let hasMore = true;
  let total = 0;

  while (hasMore) {
    const res = await withRetry(
      () =>
        axios.post(
          `${BASE_URL}/bapi/composite/v3/friendly/pgc/user/following`,
          {
            targetUsername,
            pageIndex,
            pageSize: 20,
          },
          {
            timeout: REQUEST_TIMEOUT,
            headers: {
              "Content-Type": "application/json",
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
          }
        ),
      `fetchFollowingList(${targetUsername}, page=${pageIndex})`
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
      await randomDelay();
    }
  }

  return {
    followers: allFollowings,
    total,
  };
}

/**
 * 获取用户帖子列表
 * @param {string} squareUid - 用户的squareUid
 * @param {string} filterType - "ALL" | "REPLY" | "QUOTE"
 * @param {number} daysBack - 回溯天数（默认7天，全量模式用）
 * @param {boolean} onlyFirstPage - 是否只查第一页（增量模式用，默认false）
 * @returns {Promise<{contents: Array, timeOffset: number}>}
 */
async function fetchUserPosts(squareUid, filterType = "ALL", daysBack = 7, onlyFirstPage = false) {
  const allContents = [];
  let timeOffset = -1;
  let hasMore = true;
  const cutoffTime = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  while (hasMore) {
    const res = await withRetry(
      () =>
        axios.get(
          `${BASE_URL}/bapi/composite/v2/friendly/pgc/content/queryUserProfilePageContentsWithFilter`,
          {
            params: {
              targetSquareUid: squareUid,
              timeOffset,
              filterType,
            },
            timeout: REQUEST_TIMEOUT,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
          }
        ),
      `fetchUserPosts(${squareUid}, ${filterType}, timeOffset=${timeOffset})`
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
    } else {
      timeOffset = lastPostTime;
      await randomDelay();
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
async function fetchPostDetail(postId) {
  try {
    const res = await withRetry(
      () =>
        axios.get(
          `${BASE_URL}/bapi/composite/v3/friendly/pgc/special/content/detail/${postId}`,
          {
            timeout: REQUEST_TIMEOUT,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
          }
        ),
      `fetchPostDetail(${postId})`
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
  fetchUserPosts,
  fetchPostDetail,
};
