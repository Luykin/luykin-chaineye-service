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
 * SSE (Server-Sent Events) 推送接口
 * GET /api/xhunt/sse/feeds
 *
 * 用于实时推送 feed 数据
 *
 * 查询参数:
 * - token: (可选) JWT token，用于用户认证
 * - x-request-id: UUID v4 格式的请求ID
 * - x-request-timestamp: 时间戳（毫秒）
 * - x-device-fingerprint: 32位十六进制设备指纹
 * - x-request-signature: HMAC SHA256 签名
 * - x-extension-version: 扩展版本号
 * - x-user-id: (可选) 用户ID
 * - x-window-location-href: 窗口 location.href
 */
router.get("/feeds", authenticateTokenFromQueryOptional, (req, res) => {
  // 设置 SSE 响应头
  setupSSEHeaders(res);

  // 发送初始连接确认
  res.write(": SSE connection established\n\n");
  res.flushHeaders();

  // 如果有认证用户，可以在消息中包含用户信息
  const userInfo = req.user
    ? { userId: req.user.id, username: req.user.username }
    : null;

  // 模拟数据生成器
  let messageId = 1;
  const feedTypes = ["news", "update", "alert", "notification"];
  const sampleMessages = [
    "New project added to the platform",
    "System maintenance scheduled",
    "Important announcement",
    "Feature update available",
    "User activity detected",
  ];

  // 生成随机 feed 数据
  const generateFeedData = () => {
    const feedType = feedTypes[Math.floor(Math.random() * feedTypes.length)];
    const message =
      sampleMessages[Math.floor(Math.random() * sampleMessages.length)];

    return {
      id: messageId++,
      type: feedType,
      message: message,
      timestamp: new Date().toISOString(),
      user: userInfo, // 如果已认证，包含用户信息
      data: {
        title: `${
          feedType.charAt(0).toUpperCase() + feedType.slice(1)
        } ${messageId}`,
        content: `This is a test ${feedType} message with ID ${messageId}`,
        metadata: {
          priority: Math.floor(Math.random() * 5) + 1,
          category: feedType,
        },
      },
    };
  };

  // 定期发送数据（每 5 秒发送一次）
  const intervalId = setInterval(() => {
    try {
      const feedData = generateFeedData();

      // SSE 格式：data: {json}\n\n
      res.write(`data: ${JSON.stringify(feedData)}\n\n`);

      // 如果达到 100 条消息，自动停止
      if (messageId > 100) {
        clearInterval(intervalId);
        res.write(
          "event: close\ndata: Connection closed after 100 messages\n\n"
        );
        res.end();
      }
    } catch (error) {
      console.error("SSE 发送错误:", error);
      clearInterval(intervalId);
      res.end();
    }
  }, 5000);

  // 处理客户端断开连接
  req.on("close", () => {
    console.log("SSE 客户端断开连接");
    clearInterval(intervalId);
    res.end();
  });

  // 处理错误
  req.on("error", (error) => {
    console.error("SSE 连接错误:", error);
    clearInterval(intervalId);
    res.end();
  });
});

module.exports = router;
module.exports.setupSSEHeaders = setupSSEHeaders;
