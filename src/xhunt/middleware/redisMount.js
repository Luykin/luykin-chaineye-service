const { getRedisClient } = require("../../models/postgres-start");

/**
 * Redis挂载中间件
 * 为请求提供Redis客户端，不依赖安全中间件
 */
const redisMount = async (req, res, next) => {
  try {
    // 获取Redis客户端
    const redisClient = getRedisClient();

    if (!redisClient) {
      console.error("❌ Redis客户端未初始化");
      return res.status(503).json({
        success: false,
        message: "Redis服务不可用",
      });
    }

    // 将Redis客户端添加到请求对象
    req.redisClient = redisClient;

    console.log("✅ Redis挂载中间件：Redis客户端已准备就绪");
    next();
  } catch (error) {
    console.error("❌ Redis挂载中间件初始化失败:", error);
    res.status(500).json({
      success: false,
      message: "中间件初始化失败",
      error: error.message,
    });
  }
};

module.exports = redisMount;
