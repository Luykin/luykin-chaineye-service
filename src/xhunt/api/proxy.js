const express = require("express");
const { securityMiddleware } = require("../middleware/security");
const {
  authenticateToken,
  authenticateTokenOptional,
} = require("../middleware/auth");
const { aiContentRateLimit } = require("../middleware/aiContentRateLimit");
const { checkProStatus } = require("../middleware/pro-status");
const { applyProDataFiltering } = require("../utils/pro-data-filtering");
const { isRequestInternalTestUser } = require("../constants/xhuntVip");

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

// 确保所有响应都包含 CORS 头（无论状态码是多少）
const ensureCorsHeaders = (req, res, allowMethods = "GET, POST, PUT, PATCH, DELETE, OPTIONS") => {
  const requestOrigin = req.headers.origin;

  // 设置 Access-Control-Allow-Origin
  res.setHeader("Access-Control-Allow-Origin", requestOrigin || "*");

  // 设置 Access-Control-Allow-Credentials（如果尚未设置）
  if (!res.hasHeader("Access-Control-Allow-Credentials")) {
    res.setHeader("Access-Control-Allow-Credentials", "false");
  }

  // 设置 Access-Control-Allow-Methods（如果尚未设置）
  if (!res.hasHeader("Access-Control-Allow-Methods")) {
    res.setHeader("Access-Control-Allow-Methods", allowMethods);
  }

  // 设置 Access-Control-Allow-Headers（如果尚未设置）
  if (!res.hasHeader("Access-Control-Allow-Headers")) {
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Request-ID, X-Request-Timestamp, X-Device-Fingerprint, X-Request-Signature, X-Extension-Version, X-User-ID, X-Window-Location-Href"
    );
  }
};

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

    // 检查响应状态码和内容类型
    const statusCode = response.status;
    const isSuccess = statusCode >= 200 && statusCode < 300;
    const isRedirect = statusCode >= 300 && statusCode < 400;
    const isError = statusCode >= 400;
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    // 先读取响应文本（无论成功还是失败都需要）
    let responseText;
    try {
      responseText = await response.text();
    } catch (readError) {
      console.error("读取响应体失败:", {
        url: targetUrl,
        method: req.method,
        status: statusCode,
        error: readError.message,
      });
      ensureCorsHeaders(req, res);
      return res.status(statusCode || 500).json({
        error: response.statusText || "请求失败",
        details: `无法读取服务器响应: ${readError.message}`,
      });
    }

    // 处理重定向状态码（300-399）
    if (isRedirect) {
      const location = response.headers.get("Location");
      console.log(`目标服务器返回重定向: ${statusCode} ${response.statusText}`, {
        url: targetUrl,
        method: req.method,
        status: statusCode,
        statusText: response.statusText,
        redirectLocation: location,
      });

      // 对于重定向，可以选择：
      // 1. 将重定向信息传递给客户端（当前实现）
      // 2. 或者自动跟随重定向（需要在 fetch 选项中设置 redirect: 'follow'，这是默认行为）
      // 注意：fetch 默认会自动跟随重定向，所以如果能看到 301，说明设置了 redirect: 'manual'
      
      // 如果重定向响应是 JSON 格式，尝试解析
      let redirectData;
      if (isJson) {
        try {
          redirectData = JSON.parse(responseText);
        } catch {
          redirectData = {
            redirect: true,
            status: statusCode,
            statusText: response.statusText,
            location: location,
            message: responseText || `资源已重定向`,
          };
        }
      } else {
        redirectData = {
          redirect: true,
          status: statusCode,
          statusText: response.statusText,
          location: location,
          message: responseText || `资源已重定向`,
        };
      }

      // 设置 CORS 头
      ensureCorsHeaders(req, res);

      // 设置 Location 响应头
      if (location) {
        res.setHeader("Location", location);
      }

      return res.status(statusCode).json(redirectData);
    }

    // 对于错误状态码（400+），打印详细的错误信息
    if (isError) {
      console.error(
        `目标服务器返回错误: ${statusCode} ${response.statusText}`,
        {
          url: targetUrl,
          method: req.method,
          status: statusCode,
          statusText: response.statusText,
          contentType: contentType,
          errorBody: responseText.substring(0, 2000), // 打印前 2000 字符，包含完整错误信息
        }
      );

      // 尝试解析为 JSON，如果失败则返回错误文本
      let errorData;
      if (isJson) {
        try {
          errorData = JSON.parse(responseText);
        } catch {
          // JSON 声明但解析失败，使用原始文本
          errorData = {
            error: response.statusText || "请求失败",
            details: responseText || `服务器返回了 ${statusCode} 状态码`,
          };
        }
      } else {
        // 非 JSON 响应（如 HTML 错误页面），构造错误响应对象
        errorData = {
          error: response.statusText || "请求失败",
          details: responseText || `服务器返回了 ${statusCode} 状态码`,
        };
      }

      // 设置 CORS 头
      ensureCorsHeaders(req, res);

      return res.status(statusCode).json(errorData);
    }

    // 处理成功响应
    let data;
    if (isJson) {
      try {
        data = JSON.parse(responseText);
      } catch (jsonError) {
        console.error("JSON parse error:", {
          url: targetUrl,
          method: req.method,
          error: jsonError.message,
          rawResponse: responseText.substring(0, 1000), // 打印前 1000 字符
        });
        ensureCorsHeaders(req, res);
        return res.status(502).json({
          error: "目标服务器返回了无效的JSON数据",
          details: "服务器响应格式错误",
        });
      }
    } else {
      // 非JSON响应，可能是HTML错误页面（虽然状态码是成功的）
      console.error("Non-JSON response:", {
        url: targetUrl,
        method: req.method,
        contentType: contentType,
        rawResponse: responseText.substring(0, 1000), // 打印前 1000 字符
      });
      ensureCorsHeaders(req, res);
      return res.status(502).json({
        error: "目标服务器返回了非JSON格式的响应",
        details: "可能是服务器错误或维护中",
      });
    }

    // 设置 CORS 头
    ensureCorsHeaders(req, res);

    // 设置浏览器缓存策略
    setBrowserCacheHeaders(res, req.method);

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
    console.error("Proxy request error:", {
      url: targetUrl,
      method: req.method,
      error: error.message,
      stack: error.stack,
    });
    ensureCorsHeaders(req, res);
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
      ensureCorsHeaders(req, res);
      return res.status(response.status).json({
        error: "流式请求失败",
        details: `目标服务器返回错误: ${response.status} ${response.statusText}`,
      });
    }

    await handleStreamingResponse(response, res, req);
  } catch (error) {
    console.error(targetUrl, "Proxy stream request error:", error);
    try {
      ensureCorsHeaders(req, res);
      res.status(500).json({ error: "流式请求失败" });
    } catch (_) {}
  }
}

// 处理流式响应的函数
async function handleStreamingResponse(response, res, req) {
  try {
    // 设置 CORS 头
    ensureCorsHeaders(req, res);

    // 设置流式响应的头部
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
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
      // 注意：如果响应已经开始发送，设置 CORS 头可能会失败，但不影响功能
      if (req && res && !res.headersSent) {
        ensureCorsHeaders(req, res);
      }
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
      const isInternalTestUser = isRequestInternalTestUser(req);
      if (!isInternalTestUser) {
        // 非 内部用户 返回空数据
        ensureCorsHeaders(req, res);
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
