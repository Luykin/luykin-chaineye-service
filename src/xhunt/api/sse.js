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

    console.log(`[sse feeds 调试] 获取 Feed 数据: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[sse feeds 调试] Feed 请求失败: ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[sse feeds 调试] Feed 数据获取成功，数据量:`, {
      tweets_feed: data?.data?.tweets_feed?.length || 0,
      follow_feed: data?.data?.follow_feed?.following_action?.length || 0,
      bwe_news: data?.data?.bwe_news?.length || 0,
    });

    return data?.data || null;
  } catch (error) {
    console.error(`[sse feeds 调试] Feed 请求错误:`, error);
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

    console.log(`[sse feeds 调试] 获取 Top Tweet 数据: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[sse feeds 调试] Top Tweet 请求失败: ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[sse feeds 调试] Top Tweet 数据获取成功，数据量:`, {
      data: data?.data?.data?.length || 0,
    });

    return data?.data?.data || null;
  } catch (error) {
    console.error(`[sse feeds 调试] Top Tweet 请求错误:`, error);
    return null;
  }
}

/**
 * 全局 SSE 连接管理器
 */
class SSEConnectionManager {
  constructor() {
    this.connections = new Set(); // 存储所有活跃的 SSE 连接
    this.lastFeedData = null;
    this.lastTopTweetData = null;
    this.feedIntervalId = null;
    this.topTweetIntervalId = null;
    this.isInitialized = false;
  }

  /**
   * 添加 SSE 连接
   */
  addConnection(res) {
    this.connections.add(res);
    console.log(
      `[sse feeds 调试] 新增连接，当前连接数: ${this.connections.size}`
    );

    // 初始化轮询（如果还没有初始化）
    if (!this.isInitialized) {
      this.initializePolling();
    }
  }

  /**
   * 移除 SSE 连接
   */
  removeConnection(res) {
    this.connections.delete(res);
    console.log(
      `[sse feeds 调试] 移除连接，当前连接数: ${this.connections.size}`
    );

    // 如果没有连接了，停止轮询
    if (this.connections.size === 0 && this.isInitialized) {
      this.stopPolling();
    }
  }

  /**
   * 向所有连接的客户端推送消息
   */
  broadcast(eventType, data) {
    const message = {
      type: eventType,
      timestamp: new Date().toISOString(),
      data: data,
    };

    const messageStr = `event: ${eventType}\ndata: ${JSON.stringify(
      message
    )}\n\n`;
    let closedConnections = 0;

    this.connections.forEach((res) => {
      try {
        res.write(messageStr);
      } catch (error) {
        // 连接已关闭，移除它
        console.error(`[sse feeds 调试] 推送消息失败（连接已关闭）:`, error);
        closedConnections++;
        this.connections.delete(res);
      }
    });

    if (closedConnections > 0) {
      console.log(
        `[sse feeds 调试] 清理了 ${closedConnections} 个已关闭的连接`
      );
    }

    console.log(
      `[sse feeds 调试] 推送消息 ${eventType} 到 ${this.connections.size} 个客户端`
    );
  }

  /**
   * 初始化轮询
   */
  initializePolling() {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;
    console.log(`[sse feeds 调试] 初始化轮询服务`);

    // 立即执行一次初始请求
    this.pollFeed();
    this.pollTopTweet();

    // 设置定时器
    this.feedIntervalId = setInterval(() => {
      this.pollFeed();
    }, 30 * 1000); // 每30秒

    this.topTweetIntervalId = setInterval(() => {
      this.pollTopTweet();
    }, 2 * 60 * 1000); // 每2分钟
  }

  /**
   * 停止轮询
   */
  stopPolling() {
    if (this.feedIntervalId) {
      clearInterval(this.feedIntervalId);
      this.feedIntervalId = null;
    }
    if (this.topTweetIntervalId) {
      clearInterval(this.topTweetIntervalId);
      this.topTweetIntervalId = null;
    }
    this.isInitialized = false;
    console.log(`[sse feeds 调试] 停止轮询服务`);
  }

  /**
   * 轮询 Feed 数据（每30秒）
   */
  async pollFeed() {
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
        const lastAllMessages = this.lastFeedData
          ? [
              ...(this.lastFeedData.tweets_feed || []),
              ...(this.lastFeedData.follow_feed?.following_action || []),
              ...(this.lastFeedData.bwe_news || []),
            ]
          : [];

        if (hasNewMessages(lastAllMessages, allMessages)) {
          console.log(`[sse feeds 调试] 检测到 Feed 新消息，推送通知`);
          this.broadcast("feed_update", {
            source: "feed",
            data: feedData,
          });
        }

        // 更新缓存
        this.lastFeedData = feedData;
      }
    } catch (error) {
      console.error(`[sse feeds 调试] Feed 轮询错误:`, error);
    }
  }

  /**
   * 轮询 Top Tweet 数据（每2分钟）
   */
  async pollTopTweet() {
    try {
      const topTweetData = await fetchTopTweetData();

      if (topTweetData) {
        // 比较是否有新消息
        if (hasNewMessages(this.lastTopTweetData, topTweetData)) {
          console.log(`[sse feeds 调试] 检测到 Top Tweet 新消息，推送通知`);
          this.broadcast("gossip_update", {
            source: "top_tweet",
            data: topTweetData,
          });
        }

        // 更新缓存
        this.lastTopTweetData = topTweetData;
      }
    } catch (error) {
      console.error(`[sse feeds 调试] Top Tweet 轮询错误:`, error);
    }
  }
}

// 创建全局单例
const connectionManager = new SSEConnectionManager();

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

  // 添加到连接管理器
  connectionManager.addConnection(res);

  // 处理客户端断开连接
  req.on("close", () => {
    console.log("[sse feeds 调试] SSE 客户端断开连接");
    connectionManager.removeConnection(res);
    res.end();
  });

  // 处理错误
  req.on("error", (error) => {
    console.error("[sse feeds 调试] SSE 连接错误:", error);
    connectionManager.removeConnection(res);
    res.end();
  });
});

module.exports = router;
module.exports.setupSSEHeaders = setupSSEHeaders;
