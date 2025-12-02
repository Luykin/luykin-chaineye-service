const express = require("express");
const { securityMiddleware } = require("../middleware/security");
const {
  authenticateToken,
  authenticateTokenOptional,
} = require("../middleware/auth");
const { aiContentRateLimit } = require("../middleware/aiContentRateLimit");
const { checkProStatus } = require("../middleware/pro-status");
const { applyProDataFiltering } = require("../utils/pro-data-filtering");
const { isRequestXHuntVip } = require("../constants/xhuntVip");

const router = express.Router();

// URL映射配置
const URL_MAPPINGS = {
  kota: "https://kota.chaineye.tools",
  kb: "http://127.0.0.1:8087",
  kota_temporary: "http://172.31.0.8:16531",
  k8s_kota: "https://data.cryptohunt.ai",
};

// 默认目标服务器
const DEFAULT_TARGET = "kota";

// 代理请求处理函数
async function proxyRequest(req, res, targetUrl) {
  try {
    // 构建请求选项
    const options = {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    // 如果有请求体，添加到选项中
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      options.body = JSON.stringify(req.body);
    }

    // 发送请求到目标服务器
    const response = await fetch(targetUrl, options);

    // 检查响应内容类型
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    let data;
    if (isJson) {
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error(targetUrl, "JSON parse error:", jsonError);
        // 如果JSON解析失败，尝试获取原始文本用于调试
        const rawText = await response.text();
        console.error(targetUrl, "Raw response:", rawText.substring(0, 500));
        return res.status(502).json({
          error: "目标服务器返回了无效的JSON数据",
          details: "服务器响应格式错误",
        });
      }
    } else {
      // 非JSON响应，可能是HTML错误页面
      const rawText = await response.text();
      console.error(targetUrl, "Non-JSON response:", rawText.substring(0, 500));
      return res.status(502).json({
        error: "目标服务器返回了非JSON格式的响应",
        details: "可能是服务器错误或维护中",
      });
    }

    // 设置浏览器缓存策略
    setBrowserCacheHeaders(res, req.method);

    // // 针对特定路径做响应数据增强处理
    // try {
    //   const isHotBoardPath = req.path === "/public/info/board/hot";
    //   if (
    //     isHotBoardPath &&
    //     data &&
    //     data.data &&
    //     Array.isArray(data.data.data)
    //   ) {
    //     data.data.data = data.data.data.map((item) => {
    //       try {
    //         const statistic =
    //           item && item.tweet && item.tweet.statistic
    //             ? item.tweet.statistic
    //             : null;
    //         if (statistic && typeof statistic === "object") {
    //           // 增加别名字段，不修改原有字段
    //           statistic.like_count = statistic.likes;
    //           statistic.view_count = statistic.views;
    //         }
    //       } catch (_) {}
    //       return item;
    //     });
    //   }
    // } catch (transformErr) {
    //   console.warn("Proxy response transform warning:", transformErr);
    // }

    // Pro 用户数据裁切逻辑（统一管理）
    // 针对非 Pro 用户进行数据过滤
    try {
      data = applyProDataFiltering(req, data);
    } catch (filterErr) {
      console.warn("Pro data filtering warning:", filterErr);
    }

    // 返回响应
    res.status(response.status).json(data);
  } catch (error) {
    console.error(targetUrl, "Proxy request error:", error);
    res.status(500).json({ error: "请求失败" });
  }
}

// 设置浏览器缓存头
function setBrowserCacheHeaders(res, method) {
  if (method === "GET") {
    // GET 请求设置10分钟缓存
    res.setHeader("Cache-Control", "public, max-age=600"); // 600秒 = 10分钟
    res.setHeader(
      "Expires",
      new Date(Date.now() + 10 * 60 * 1000).toUTCString()
    );
  } else {
    // 非 GET 请求不缓存
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}

// 获取目标URL
function getTargetUrl(req) {
  // 提取并删除 target 参数
  const originalQuery = { ...req.query };
  const target = originalQuery.target || DEFAULT_TARGET;
  delete originalQuery.target;

  let baseUrl = (URL_MAPPINGS[target] || URL_MAPPINGS[DEFAULT_TARGET]).trim();

  // 提取路径（去除 /auth/ 或 /public/ 前缀）
  const targetPath = req.path.replace(/^\/(auth|public)\//, "");

  // 将剩余查询参数转换为查询字符串
  const search = new URLSearchParams(originalQuery).toString();

  // 拼接完整的目标 URL
  let fullPath = targetPath;
  if (search) {
    fullPath += `?${search}`;
  }
  return `${baseUrl}/${fullPath}`;
}

// 获取目标URL（流式专用：去除 public-stream 前缀）
function getTargetUrlForStreaming(req) {
  // 提取并删除 target 参数
  const originalQuery = { ...req.query };
  const target = originalQuery.target || DEFAULT_TARGET;
  delete originalQuery.target;

  let baseUrl = (URL_MAPPINGS[target] || URL_MAPPINGS[DEFAULT_TARGET]).trim();

  // 提取路径（去除 /auth/ 或 /public-stream/ 前缀）
  const targetPath = req.path.replace(/^\/(auth|public-stream)\//, "");

  // 将剩余查询参数转换为查询字符串
  const search = new URLSearchParams(originalQuery).toString();

  // 拼接完整的目标 URL
  let fullPath = targetPath;
  if (search) {
    fullPath += `?${search}`;
  }
  return `${baseUrl}/${fullPath}`;
}

// 流式代理请求处理函数
async function proxyRequestStream(req, res, targetUrl) {
  try {
    // 禁用 Express 的响应缓冲
    res.setTimeout(0);
    res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx 缓冲

    const options = {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
        Connection: "keep-alive",
        "Cache-Control": "no-cache",
      },
    };

    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      options.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, options);

    // 检查流式响应的状态
    if (!response.ok) {
      console.error(
        targetUrl,
        "Streaming request failed:",
        response.status,
        response.statusText
      );
      try {
        const errorText = await response.text();
        console.error(
          targetUrl,
          "Error response:",
          errorText.substring(0, 500)
        );
      } catch (_) {}
      return res.status(response.status).json({
        error: "流式请求失败",
        details: `目标服务器返回错误: ${response.status} ${response.statusText}`,
      });
    }

    await handleStreamingResponse(response, res);
  } catch (error) {
    console.error(targetUrl, "Proxy stream request error:", error);
    try {
      res.status(500).json({ error: "流式请求失败" });
    } catch (_) {}
  }
}

// 处理流式响应的函数
async function handleStreamingResponse(response, res) {
  try {
    // 设置流式响应的头部
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Cache-Control");
    res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx 缓冲

    // 设置状态码
    res.status(response.status);

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // 解码数据块
          const chunk = decoder.decode(value, { stream: true });

          // 直接写入，不添加额外的前缀
          res.write(chunk);

          // 强制刷新缓冲区，确保数据立即发送
          if (typeof res.flush === "function") {
            res.flush();
          }
        }
      } finally {
        reader.releaseLock();
      }
      res.end();
    } else {
      // 如果没有 body 流，尝试使用 response.text() 然后分块发送
      const text = await response.text();
      const chunks = text.split("\n");

      for (const chunk of chunks) {
        if (chunk.trim()) {
          res.write(chunk + "\n");
          // 强制刷新缓冲区
          if (typeof res.flush === "function") {
            res.flush();
          }
        }
      }
      res.end();
    }
  } catch (error) {
    console.error("Streaming response error:", error);
    try {
      res.status(500).json({ error: "流式响应处理失败" });
    } catch (_) {}
  }
}

// 代理路由 - 需要认证
router.all(
  "/auth/*",
  authenticateToken,
  securityMiddleware,
  aiContentRateLimit,
  async (req, res) => {
    const targetUrl = getTargetUrl(req);
    await proxyRequest(req, res, targetUrl);
  }
);

// 代理路由 - 删帖接口（需要 Pro 状态检查）
router.all(
  "/public/fetch/tweet/deleted",
  authenticateTokenOptional,
  checkProStatus,
  securityMiddleware,
  aiContentRateLimit,
  async (req, res) => {
    const targetUrl = getTargetUrl(req);
    await proxyRequest(req, res, targetUrl);
  }
);

// 代理路由 - 账户profile接口（需要 Pro 状态检查）
router.all(
  "/public/fetch/twitter/user",
  authenticateTokenOptional,
  checkProStatus,
  securityMiddleware,
  aiContentRateLimit,
  async (req, res) => {
    const targetUrl = getTargetUrl(req);
    await proxyRequest(req, res, targetUrl);
  }
);

// 代理路由 - 特殊接口访问控制（仅 XHunt VIP 允许返回真实数据）
router.all(
  "/public/fetch/twitter/unfollow_relation",
  authenticateTokenOptional,
  securityMiddleware,
  aiContentRateLimit,
  async (req, res) => {
    try {
      const isVip = isRequestXHuntVip(req);
      if (!isVip) {
        // 非 VIP 返回空数据
        return res.status(200).json({ data: [], isVip: false });
      }
    } catch (_) {}

    const targetUrl = getTargetUrl(req);
    await proxyRequest(req, res, targetUrl);
  }
);

// 代理路由 - 无需认证（但特定路径可选择性识别用户）
router.all(
  "/public/*",
  securityMiddleware,
  aiContentRateLimit,
  async (req, res) => {
    const targetUrl = getTargetUrl(req);
    await proxyRequest(req, res, targetUrl);
  }
);

// 代理路由 - 流式（与普通代理完全分离）
router.all("/public-stream/*", securityMiddleware, async (req, res) => {
  const targetUrl = getTargetUrlForStreaming(req);
  await proxyRequestStream(req, res, targetUrl);
});

module.exports = router;
