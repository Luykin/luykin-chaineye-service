const redis = require("redis");

let redisClient;

/**
 * 获取 Redis 客户端单例。
 * 如果客户端尚未连接，则进行初始化和连接。
 * @returns {Promise<import('redis').RedisClientType>}
 */
async function getRedisClient() {
  if (!redisClient || !redisClient.isOpen) {
    const client = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: process.env.REDIS_PORT || 6379,
      },
      // password: process.env.REDIS_PASSWORD // 如果有密码
    });

    try {
      await client.connect();
      console.log("Redis 连接成功");
      redisClient = client;

      // 监听重连事件
      redisClient.on("reconnecting", () => {
        console.log("Redis 正在重连...");
      });

      // 监听错误事件
      redisClient.on("error", (err) => {
        console.error("Redis 客户端发生错误:", err);
      });
    } catch (error) {
      console.error("Redis 连接失败:", error);
      // 如果连接失败，抛出错误，让调用方知道
      throw error;
    }
  }
  return redisClient;
}

module.exports = { getRedisClient };
