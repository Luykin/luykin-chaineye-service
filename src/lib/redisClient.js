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


/**
 * 使用 SCAN 按 pattern 分批查找 key，避免 KEYS 阻塞 Redis 主线程。
 * @param {import('redis').RedisClientType} client
 * @param {string} pattern
 * @param {{ count?: number, maxKeys?: number }} options
 * @returns {Promise<string[]>}
 */
async function scanKeys(client, pattern, options = {}) {
  const count = options.count || 500;
  const maxKeys = options.maxKeys || Infinity;
  const keys = [];

  if (!client) return keys;

  if (typeof client.scanIterator === "function") {
    for await (const item of client.scanIterator({ MATCH: pattern, COUNT: count })) {
      const batch = Array.isArray(item) ? item : [item];
      for (const key of batch) {
        keys.push(key);
        if (keys.length >= maxKeys) return keys;
      }
    }
    return keys;
  }

  let cursor = "0";
  do {
    const result = await client.scan(cursor, { MATCH: pattern, COUNT: count });
    cursor = result.cursor || result[0];
    const batch = result.keys || result[1] || [];
    for (const key of batch) {
      keys.push(key);
      if (keys.length >= maxKeys) return keys;
    }
  } while (String(cursor) !== "0");

  return keys;
}

/**
 * 分批删除 key，优先使用 UNLINK 异步释放内存，避免一次 DEL 参数过多。
 * @param {import('redis').RedisClientType} client
 * @param {string[]} keys
 * @param {number} chunkSize
 * @returns {Promise<number>}
 */
async function deleteKeysInChunks(client, keys, chunkSize = 500) {
  if (!client || !Array.isArray(keys) || keys.length === 0) return 0;

  const deleteCommand =
    typeof client.unlink === "function"
      ? client.unlink.bind(client)
      : client.del.bind(client);

  let deleted = 0;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    await deleteCommand(chunk);
    deleted += chunk.length;
  }
  return deleted;
}

module.exports = { getRedisClient, scanKeys, deleteKeysInChunks };
