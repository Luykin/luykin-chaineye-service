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

    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[sse feeds 核心] Feed 请求失败: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data?.data?.data || null;
  } catch (error) {
    console.error(`[sse feeds 核心] Feed 请求错误:`, error);
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

    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[sse feeds 核心] Top Tweet 请求失败: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data?.data?.data || null;
  } catch (error) {
    console.error(`[sse feeds 核心] Top Tweet 请求错误:`, error);
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
    this.latestFeedItem = null; // 缓存的最新一条 Feed 数据
    this.latestTopTweetItem = null; // 缓存的最新一条 Top Tweet 数据
    this.feedIntervalId = null;
    this.topTweetIntervalId = null;
    this.isInitialized = false;
    this.redisClient = null; // Redis 客户端（延迟设置）
    this.redisKeyPrefix = "sse:feeds:"; // Redis key 前缀
    this.lastFeedPollTime = null; // 上次 Feed 轮询时间
    this.lastTopTweetPollTime = null; // 上次 Top Tweet 轮询时间
  }

  /**
   * 设置 Redis 客户端
   */
  setRedisClient(redisClient) {
    this.redisClient = redisClient;
  }

  /**
   * 从 Redis 恢复缓存数据
   */
  async restoreFromRedis() {
    if (!this.redisClient || !this.redisClient.isReady) {
      return;
    }

    try {
      // 恢复 Feed 数据
      const feedDataStr = await this.redisClient.get(
        `${this.redisKeyPrefix}feed:data`
      );
      if (feedDataStr) {
        this.lastFeedData = JSON.parse(feedDataStr);
        this.latestFeedItem = this.getLatestFeedItem(this.lastFeedData);
      }

      // 恢复 Top Tweet 数据
      const topTweetDataStr = await this.redisClient.get(
        `${this.redisKeyPrefix}top_tweet:data`
      );
      if (topTweetDataStr) {
        this.lastTopTweetData = JSON.parse(topTweetDataStr);
        this.latestTopTweetItem = this.getLatestTopTweetItem(
          this.lastTopTweetData
        );
      }
    } catch (error) {
      console.error(`[sse feeds 核心] 从 Redis 恢复缓存失败:`, error);
    }
  }

  /**
   * 保存 Feed 数据到 Redis
   */
  async saveFeedDataToRedis(feedData) {
    if (!this.redisClient || !this.redisClient.isReady) {
      return;
    }

    try {
      // 保存全量数据，设置过期时间为 7 天
      await this.redisClient.setEx(
        `${this.redisKeyPrefix}feed:data`,
        7 * 24 * 60 * 60,
        JSON.stringify(feedData)
      );
    } catch (error) {
      console.error(`[sse feeds 核心] 保存 Feed 数据到 Redis 失败:`, error);
    }
  }

  /**
   * 保存 Top Tweet 数据到 Redis
   */
  async saveTopTweetDataToRedis(topTweetData) {
    if (!this.redisClient || !this.redisClient.isReady) {
      return;
    }

    try {
      // 保存全量数据，设置过期时间为 7 天
      await this.redisClient.setEx(
        `${this.redisKeyPrefix}top_tweet:data`,
        7 * 24 * 60 * 60,
        JSON.stringify(topTweetData)
      );
    } catch (error) {
      console.error(
        `[sse feeds 核心] 保存 Top Tweet 数据到 Redis 失败:`,
        error
      );
    }
  }

  /**
   * 获取 Feed 数据中的最新一条
   */
  getLatestFeedItem(feedData) {
    if (!feedData) return null;

    // 收集所有消息，按时间排序
    const allMessages = [
      ...(feedData.tweets_feed || []).map((item) => ({
        ...item,
        source: "tweets_feed",
      })),
      ...(feedData.follow_feed?.following_action || []).map((item) => ({
        ...item,
        source: "follow_feed",
      })),
      ...(feedData.bwe_news || []).map((item) => ({
        ...item,
        source: "bwe_news",
      })),
    ];

    if (allMessages.length === 0) return null;

    // 按 create_time 降序排序，取最新的一条
    allMessages.sort((a, b) => {
      const timeA = new Date(a.create_time || 0).getTime();
      const timeB = new Date(b.create_time || 0).getTime();
      return timeB - timeA;
    });

    return allMessages[0];
  }

  /**
   * 获取 Top Tweet 数据中的最新一条
   */
  getLatestTopTweetItem(topTweetData) {
    if (
      !topTweetData ||
      !Array.isArray(topTweetData) ||
      topTweetData.length === 0
    ) {
      return null;
    }

    // 按时间排序，取最新的一条
    const sorted = [...topTweetData].sort((a, b) => {
      const timeA = new Date(
        a.tweet?.create_time || a.create_time || 0
      ).getTime();
      const timeB = new Date(
        b.tweet?.create_time || b.create_time || 0
      ).getTime();
      return timeB - timeA;
    });

    return sorted[0];
  }

  /**
   * 将最新的一条 Feed 数据转换为全量数据结构格式
   */
  formatLatestFeedItem(latestItem) {
    if (!latestItem) return null;

    const source = latestItem.source || "tweets_feed";
    const item = { ...latestItem };
    delete item.source; // 移除临时添加的 source 字段

    // 根据 source 构建对应的数据结构
    if (source === "tweets_feed") {
      return {
        tweets_feed: [item],
        follow_feed: { following_action: [] },
        bwe_news: [],
      };
    } else if (source === "follow_feed") {
      return {
        tweets_feed: [],
        follow_feed: { following_action: [item] },
        bwe_news: [],
      };
    } else if (source === "bwe_news") {
      return {
        tweets_feed: [],
        follow_feed: { following_action: [] },
        bwe_news: [item],
      };
    }

    return null;
  }

  /**
   * 添加 SSE 连接
   */
  addConnection(res) {
    this.connections.add(res);

    // 初始化轮询（如果还没有初始化）
    if (!this.isInitialized) {
      this.initializePolling();
    }

    // 立即发送当前缓存的最新一条数据（如果有）
    if (this.latestFeedItem) {
      try {
        const formattedData = this.formatLatestFeedItem(this.latestFeedItem);
        if (formattedData) {
          const message = {
            type: "feed_update",
            timestamp: new Date().toISOString(),
            data: {
              source: "feed",
              data: formattedData,
            },
          };
          const messageStr = `event: feed_update\ndata: ${JSON.stringify(
            message
          )}\n\n`;
          res.write(messageStr);
        }
      } catch (error) {
        console.error(`[sse feeds 核心] 发送初始 Feed 数据失败:`, error);
      }
    }

    if (this.latestTopTweetItem) {
      try {
        const message = {
          type: "gossip_update",
          timestamp: new Date().toISOString(),
          data: {
            source: "top_tweet",
            data: [this.latestTopTweetItem], // 保持数组格式，但只有一条
          },
        };
        const messageStr = `event: gossip_update\ndata: ${JSON.stringify(
          message
        )}\n\n`;
        res.write(messageStr);
      } catch (error) {
        console.error(`[sse feeds 核心] 发送初始 Top Tweet 数据失败:`, error);
      }
    }
  }

  /**
   * 移除 SSE 连接
   */
  removeConnection(res) {
    this.connections.delete(res);

    // 如果没有连接了，停止轮询
    if (this.connections.size === 0 && this.isInitialized) {
      this.stopPolling();
    }
  }

  /**
   * 发送心跳（保持连接活跃）
   */
  sendHeartbeat() {
    const heartbeat = ": heartbeat\n\n";
    this.connections.forEach((res) => {
      try {
        res.write(heartbeat);
      } catch (error) {
        // 连接已关闭，移除它
        this.connections.delete(res);
      }
    });
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
        closedConnections++;
        this.connections.delete(res);
      }
    });
  }

  /**
   * 初始化轮询
   */
  async initializePolling() {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;

    // 从 Redis 恢复缓存数据
    await this.restoreFromRedis();

    // 立即执行一次初始请求
    this.pollFeed();
    this.pollTopTweet();

    // 设置定时器
    this.feedIntervalId = setInterval(() => {
      this.sendHeartbeat(); // 设置心跳定时器（保持连接活跃）
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
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计信息对象
   */
  getStats() {
    // 估算每个连接的内存占用（字节）
    // 每个响应对象大约占用 1-2KB（包括响应流、缓冲区等）
    const estimatedBytesPerConnection = 2048;
    const connectionCount = this.connections.size;
    const estimatedMemoryUsage = connectionCount * estimatedBytesPerConnection;

    // 计算数据大小（字节）
    const getDataSize = (data) => {
      if (!data) return 0;
      try {
        return Buffer.byteLength(JSON.stringify(data), "utf8");
      } catch (error) {
        return 0;
      }
    };

    const feedDataSize = getDataSize(this.lastFeedData);
    const topTweetDataSize = getDataSize(this.lastTopTweetData);

    // 格式化时间
    const formatTime = (date) => {
      if (!date) return "从未轮询";
      return date.toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    };

    return {
      connections: {
        active: connectionCount,
        estimatedMemoryUsage: estimatedMemoryUsage,
        estimatedMemoryUsageFormatted: this.formatBytes(estimatedMemoryUsage),
      },
      polling: {
        initialized: this.isInitialized,
        feedInterval: this.feedIntervalId ? "运行中" : "未启动",
        topTweetInterval: this.topTweetIntervalId ? "运行中" : "未启动",
        lastFeedPollTime: this.lastFeedPollTime
          ? this.lastFeedPollTime.toISOString()
          : null,
        lastFeedPollTimeFormatted: formatTime(this.lastFeedPollTime),
        lastTopTweetPollTime: this.lastTopTweetPollTime
          ? this.lastTopTweetPollTime.toISOString()
          : null,
        lastTopTweetPollTimeFormatted: formatTime(this.lastTopTweetPollTime),
      },
      cache: {
        feed: {
          hasData: !!this.lastFeedData,
          latestItemExists: !!this.latestFeedItem,
          dataSize: feedDataSize,
          dataSizeFormatted: this.formatBytes(feedDataSize),
          lastData: this.lastFeedData
            ? JSON.stringify(this.lastFeedData, null, 2)
            : null,
          latestItem: this.latestFeedItem
            ? JSON.stringify(this.latestFeedItem, null, 2)
            : null,
        },
        topTweet: {
          hasData: !!this.lastTopTweetData,
          latestItemExists: !!this.latestTopTweetItem,
          dataSize: topTweetDataSize,
          dataSizeFormatted: this.formatBytes(topTweetDataSize),
          lastData: this.lastTopTweetData
            ? JSON.stringify(this.lastTopTweetData, null, 2)
            : null,
          latestItem: this.latestTopTweetItem
            ? JSON.stringify(this.latestTopTweetItem, null, 2)
            : null,
        },
      },
      redis: {
        configured: !!this.redisClient,
        connected: this.redisClient?.isReady || false,
      },
    };
  }

  /**
   * 格式化字节大小
   * @param {number} bytes - 字节数
   * @returns {string} 格式化后的字符串
   */
  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  }

  /**
   * 轮询 Feed 数据（每30秒）
   */
  async pollFeed() {
    try {
      const feedData = await fetchFeedData();

      // 更新轮询时间
      this.lastFeedPollTime = new Date();

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

        const hasNew = hasNewMessages(lastAllMessages, allMessages);
        const wasFirstLoad = !this.lastFeedData; // 在更新前检查是否首次加载

        if (hasNew) {
          console.log(`[sse feeds 核心] 检测到 Feed 新消息，推送通知`);
          this.broadcast("feed_update", {
            source: "feed",
            data: feedData,
          });
        }

        // 更新缓存
        this.lastFeedData = feedData;
        // 更新最新的一条 Feed 数据
        this.latestFeedItem = this.getLatestFeedItem(feedData);
        // 保存到 Redis（只在有新消息时保存，避免无意义的覆盖写入）
        // 如果是首次获取数据（没有旧数据），也需要保存
        if (hasNew || wasFirstLoad) {
          await this.saveFeedDataToRedis(feedData);
        }
      }
    } catch (error) {
      console.error(`[sse feeds 核心] Feed 轮询错误:`, error);
      // 即使出错也更新轮询时间（表示尝试过）
      this.lastFeedPollTime = new Date();
    }
  }

  /**
   * 轮询 Top Tweet 数据（每2分钟）
   */
  async pollTopTweet() {
    try {
      const topTweetData = await fetchTopTweetData();

      // 更新轮询时间
      this.lastTopTweetPollTime = new Date();

      if (topTweetData) {
        // 比较是否有新消息
        const hasNew = hasNewMessages(this.lastTopTweetData, topTweetData);
        const wasFirstLoad = !this.lastTopTweetData; // 在更新前检查是否首次加载

        if (hasNew) {
          console.log(`[sse feeds 核心] 检测到 Top Tweet 新消息，推送通知`);
          this.broadcast("gossip_update", {
            source: "top_tweet",
            data: topTweetData,
          });
        }

        // 更新缓存
        this.lastTopTweetData = topTweetData;
        // 更新最新的一条 Top Tweet 数据
        this.latestTopTweetItem = this.getLatestTopTweetItem(topTweetData);
        // 保存到 Redis（只在有新消息时保存，避免无意义的覆盖写入）
        // 如果是首次获取数据（没有旧数据），也需要保存
        if (hasNew || wasFirstLoad) {
          await this.saveTopTweetDataToRedis(topTweetData);
        }
      }
    } catch (error) {
      console.error(`[sse feeds 核心] Top Tweet 轮询错误:`, error);
      // 即使出错也更新轮询时间（表示尝试过）
      this.lastTopTweetPollTime = new Date();
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
  // 设置 Redis 客户端（如果还没有设置）
  if (!connectionManager.redisClient && req.redisClient) {
    connectionManager.setRedisClient(req.redisClient);
  }

  // 设置 SSE 响应头
  setupSSEHeaders(res);

  // 发送初始连接确认
  res.write(": SSE connection established\n\n");
  res.flushHeaders();

  // 添加到连接管理器
  connectionManager.addConnection(res);

  // 处理客户端断开连接
  req.on("close", () => {
    connectionManager.removeConnection(res);
    res.end();
  });

  // 处理错误
  req.on("error", (error) => {
    console.error("[sse feeds 核心] SSE 连接错误:", error);
    connectionManager.removeConnection(res);
    res.end();
  });
});

module.exports = router;
module.exports.setupSSEHeaders = setupSSEHeaders;
module.exports.connectionManager = connectionManager;
