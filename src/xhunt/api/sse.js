const express = require("express");
const router = express.Router();
const { authenticateTokenFromQueryOptional } = require("../middleware/auth");

/**
 * 设置 SSE (Server-Sent Events) 响应头的公共方法
 * @param {express.Response} res - Express 响应对象
 */
function setupSSEHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // 禁用 nginx 缓冲
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

/**
 * 获取时间戳（当前时间减去1小时，秒级时间戳）
 */
function getTimestamp() {
  return Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
}

/**
 * 计算数据的关键标识（用于检测新消息）
 * @param {Array} data - 数据数组
 * @returns {Array} 关键标识数组
 */
function computeDataKeys(data) {
  if (!Array.isArray(data)) return [];

  return data.map((item) => {
    // 对于 feed 数据，使用 id 作为标识
    if (item.id) return `feed-${item.id}`;
    // 对于 top_tweet 数据，也使用 id
    if (item.tweet?.id) return `tweet-${item.tweet.id}`;
    // 如果没有 id，使用其他唯一标识
    return `item-${JSON.stringify(item).substring(0, 100)}`;
  });
}

/**
 * 检测是否有新消息（消息变多）
 * @param {Array} oldData - 旧数据
 * @param {Array} newData - 新数据
 * @returns {boolean} 是否有新消息
 */
function hasNewMessages(oldData, newData) {
  if (!oldData || !Array.isArray(oldData) || oldData.length === 0) {
    // 如果没有旧数据，只要有新数据就算有新消息
    return newData && Array.isArray(newData) && newData.length > 0;
  }

  if (!newData || !Array.isArray(newData) || newData.length === 0) {
    // 如果新数据为空，不算有新消息
    return false;
  }

  // 如果新数据比旧数据多，说明有新消息
  if (newData.length > oldData.length) {
    return true;
  }

  // 如果数量相同或更少，检查是否有不同的数据
  const oldKeys = new Set(computeDataKeys(oldData));
  const newKeys = computeDataKeys(newData);

  // 检查新数据中是否有旧数据中没有的
  return newKeys.some((key) => !oldKeys.has(key));
}

/**
 * 获取 Feed 数据
 */
async function fetchFeedData() {
  try {
    const timestamp = getTimestamp();
    const url = `https://data.cryptohunt.ai/fetch/twitter/feed?timestamp=${timestamp}`;

    console.log(`[sse feeds] 获取 Feed 数据: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[sse feeds] Feed 请求失败: ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[sse feeds] Feed 数据获取成功，数据量:`, {
      tweets_feed: data?.data?.tweets_feed?.length || 0,
      follow_feed: data?.data?.follow_feed?.following_action?.length || 0,
      bwe_news: data?.data?.bwe_news?.length || 0,
    });

    return data?.data || null;
  } catch (error) {
    console.error(`[sse feeds] Feed 请求错误:`, error);
    return null;
  }
}

/**
 * 获取 Top Tweet 数据
 */
async function fetchTopTweetData() {
  try {
    const timestamp = getTimestamp();
    const url = `https://data.cryptohunt.ai/fetch/twitter/top_tweet?group=cn&days=1&by_view=false&filter_tag=gossip&timestamp=${timestamp}`;

    console.log(`[sse feeds] 获取 Top Tweet 数据: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[sse feeds] Top Tweet 请求失败: ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[sse feeds] Top Tweet 数据获取成功，数据量:`, {
      data: data?.data?.data?.length || 0,
    });

    return data?.data?.data || null;
  } catch (error) {
    console.error(`[sse feeds] Top Tweet 请求错误:`, error);
    return null;
  }
}

/**
 * SSE (Server-Sent Events) 推送接口
 * GET /api/xhunt/sse/feeds
 *
 * 用于实时推送 feed 数据
 *
 */
router.get("/feeds", authenticateTokenFromQueryOptional, (req, res) => {
  // 设置 SSE 响应头
  setupSSEHeaders(res);

  // 发送初始连接确认
  res.write(": SSE connection established\n\n");
  res.flushHeaders();

  // 存储上次的数据，用于比较
  let lastFeedData = null;
  let lastTopTweetData = null;

  // 定时器 ID
  let feedIntervalId = null;
  let topTweetIntervalId = null;

  // 清理定时器的函数
  const cleanup = () => {
    if (feedIntervalId) {
      clearInterval(feedIntervalId);
      feedIntervalId = null;
    }
    if (topTweetIntervalId) {
      clearInterval(topTweetIntervalId);
      topTweetIntervalId = null;
    }
  };

  // 发送 SSE 消息的辅助函数
  const sendSSEMessage = (eventType, data) => {
    try {
      const message = {
        type: eventType,
        timestamp: new Date().toISOString(),
        data: data,
      };
      res.write(`event: ${eventType}\ndata: ${JSON.stringify(message)}\n\n`);
    } catch (error) {
      console.error(`[sse feeds] 发送消息错误:`, error);
    }
  };

  // 轮询 Feed 数据（每30秒）
  const pollFeed = async () => {
    try {
      const feedData = await fetchFeedData();

      if (feedData) {
        // 提取所有消息用于比较
        const allMessages = [
          ...(feedData.tweets_feed || []),
          ...(feedData.follow_feed?.following_action || []),
          ...(feedData.bwe_news || []),
        ];

        // 比较是否有新消息
        const lastAllMessages = lastFeedData
          ? [
              ...(lastFeedData.tweets_feed || []),
              ...(lastFeedData.follow_feed?.following_action || []),
              ...(lastFeedData.bwe_news || []),
            ]
          : [];

        if (hasNewMessages(lastAllMessages, allMessages)) {
          console.log(`[sse feeds] 检测到 Feed 新消息，推送通知`);
          sendSSEMessage("feed_update", {
            source: "feed",
            data: feedData,
          });
        }

        // 更新缓存
        lastFeedData = feedData;
      }
    } catch (error) {
      console.error(`[sse feeds] Feed 轮询错误:`, error);
    }
  };

  // 轮询 Top Tweet 数据（每2分钟）
  const pollTopTweet = async () => {
    try {
      const topTweetData = await fetchTopTweetData();

      if (topTweetData) {
        // 比较是否有新消息
        if (hasNewMessages(lastTopTweetData, topTweetData)) {
          console.log(`[sse feeds] 检测到 Top Tweet 新消息，推送通知`);
          sendSSEMessage("gossip_update", {
            source: "top_tweet",
            data: topTweetData,
          });
        }

        // 更新缓存
        lastTopTweetData = topTweetData;
      }
    } catch (error) {
      console.error(`[sse feeds] Top Tweet 轮询错误:`, error);
    }
  };

  // 立即执行一次初始请求
  pollFeed();
  pollTopTweet();

  // 设置定时器
  feedIntervalId = setInterval(pollFeed, 30 * 1000); // 每30秒
  topTweetIntervalId = setInterval(pollTopTweet, 3 * 60 * 1000); // 每3分钟

  // 处理客户端断开连接
  req.on("close", () => {
    console.log("[sse feeds] SSE 客户端断开连接");
    cleanup();
    res.end();
  });

  // 处理错误
  req.on("error", (error) => {
    console.error("[sse feeds] SSE 连接错误:", error);
    cleanup();
    res.end();
  });
});

module.exports = router;
module.exports.setupSSEHeaders = setupSSEHeaders;
