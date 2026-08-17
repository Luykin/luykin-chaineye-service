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
const { handleUserCreateGiftCredits } = require("../services/giftCreditsService");

const router = express.Router();

// URL映射配置
const URL_MAPPINGS = {
  kota: "https://kota.chaineye.tools",
  kb: "http://127.0.0.1:8087",
  kota_temporary: "http://172.31.0.8:16531",
  k8s_kota: "https://data.cryptohunt.ai",
  github_moo: "https://github-daily.moo.kim",
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
    // 需要保留的 header 列表（忽略大小写，支持部分匹配）
    const HEADERS_TO_PRESERVE = [
      // 认证相关
      "admin",
    ];

    // 构建请求选项
    const headers = {
      "Content-Type": "application/json",
    };

    // 保留原始请求头中匹配的字段（忽略大小写）
    for (const [key, value] of Object.entries(req.headers || {})) {
      const lowerKey = key.toLowerCase();
      const shouldPreserve = HEADERS_TO_PRESERVE.some((pattern) =>
        lowerKey.includes(pattern.toLowerCase())
      );
      if (shouldPreserve) {
        headers[key] = value;
      }
    }

    const options = {
      method: req.method,
      headers,
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

    // 处理成功响应（200-299）
    // 设置 CORS 头
    ensureCorsHeaders(req, res);

    // 设置浏览器缓存策略
    setBrowserCacheHeaders(res, req);

    // 处理用户创建后的积分赠送（同步等待完成）
    await handleUserCreateGiftCredits(req, targetUrl, isSuccess);

    if (isJson) {
      // JSON 响应：解析并返回
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (jsonError) {
        console.error("JSON parse error:", {
          url: targetUrl,
          method: req.method,
          error: jsonError.message,
          rawResponse: responseText.substring(0, 1000), // 打印前 1000 字符
        });
        return res.status(502).json({
          error: "目标服务器返回了无效的JSON数据",
          details: "服务器响应格式错误",
        });
      }

      // Pro 用户数据裁切逻辑（统一管理）
      // 针对非 Pro 用户进行数据过滤
      try {
        data = applyProDataFiltering(req, data);
      } catch (filterErr) {
        console.warn("Pro data filtering warning:", filterErr);
      }

      // 返回 JSON 响应
      return res.status(statusCode).json(data);
    } else {
      // 非JSON响应，但状态码正常：原样返回
      // 记录日志但不报错
      console.log("Non-JSON response (status OK):", {
        url: targetUrl,
        method: req.method,
        status: statusCode,
        contentType: contentType,
        responseLength: responseText.length,
      });

      // 设置原始响应头
      if (contentType) {
        res.setHeader("Content-Type", contentType);
      }

      // 原样返回响应文本
      return res.status(statusCode).send(responseText);
    }
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

const CACHE_POLICIES = {
  DEFAULT: "default",
  SHORT: "short",
  NO_CACHE: "no-cache",
  PRIVATE_USER: "private-user",
};

// 默认缓存分组：public 缓存 10 分钟
const DEFAULT_CACHE_PATHS = [/.*/];

// 短缓存分组：public 缓存 5 分钟
const SHORT_CACHE_PATHS = ["twitter/trending_tweets"];

// 完全不缓存分组：需要实时返回或不允许缓存的接口放这里
const NO_CACHE_PATHS = [];

// 私有人信息分组：private 缓存 5 分钟，避免共享缓存复用用户态响应
const PRIVATE_USER_CACHE_PATHS = [
  /\/me$/,
  /^\/auth(?:\/|$)/
];

const CACHE_PATH_GROUPS = {
  [CACHE_POLICIES.DEFAULT]: DEFAULT_CACHE_PATHS,
  [CACHE_POLICIES.SHORT]: SHORT_CACHE_PATHS,
  [CACHE_POLICIES.NO_CACHE]: NO_CACHE_PATHS,
  [CACHE_POLICIES.PRIVATE_USER]: PRIVATE_USER_CACHE_PATHS,
};

function normalizeCachePath(path = "") {
  return path.toLowerCase().replace(/\/+$/, "") || "/";
}

function getTargetCachePath(req) {
  return normalizeCachePath((req.path || "").replace(/^\/(auth|public)\//, "/"));
}

function isCachePathMatched(path, pattern) {
  if (!path || !pattern) {
    return false;
  }

  const normalizedPath = normalizeCachePath(path);

  // 字符串规则：包含匹配，适合 twitter/trending_tweets 这类稳定路径片段
  if (typeof pattern === "string") {
    return normalizedPath.includes(pattern.toLowerCase());
  }

  // 正则规则：适合 /me 结尾、边界匹配、避免 /user 误匹配 /users 等场景
  if (pattern instanceof RegExp) {
    return pattern.test(normalizedPath);
  }

  return false;
}

function isCacheGroupMatched(paths, path, targetPath) {
  return paths.some(
    (pattern) =>
      isCachePathMatched(path, pattern) || isCachePathMatched(targetPath, pattern)
  );
}

function getBrowserCachePolicy(req) {
  if (req.method !== "GET") {
    return CACHE_POLICIES.NO_CACHE;
  }

  const path = normalizeCachePath(req.path || "");
  const targetPath = getTargetCachePath(req);

  if (
    isCacheGroupMatched(
      CACHE_PATH_GROUPS[CACHE_POLICIES.NO_CACHE],
      path,
      targetPath
    )
  ) {
    return CACHE_POLICIES.NO_CACHE;
  }

  if (
    isCacheGroupMatched(
      CACHE_PATH_GROUPS[CACHE_POLICIES.PRIVATE_USER],
      path,
      targetPath
    )
  ) {
    return CACHE_POLICIES.PRIVATE_USER;
  }

  if (
    isCacheGroupMatched(CACHE_PATH_GROUPS[CACHE_POLICIES.SHORT], path, targetPath)
  ) {
    return CACHE_POLICIES.SHORT;
  }

  if (
    isCacheGroupMatched(
      CACHE_PATH_GROUPS[CACHE_POLICIES.DEFAULT],
      path,
      targetPath
    )
  ) {
    return CACHE_POLICIES.DEFAULT;
  }

  return CACHE_POLICIES.NO_CACHE;
}

function setNoCacheHeaders(res) {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function setTimedCacheHeaders(res, maxAgeSeconds, visibility = "public") {
  res.setHeader("Cache-Control", `${visibility}, max-age=${maxAgeSeconds}`);
  res.setHeader(
    "Expires",
    new Date(Date.now() + maxAgeSeconds * 1000).toUTCString()
  );
}

// 设置浏览器缓存头
function setBrowserCacheHeaders(res, req) {
  const cachePolicy = getBrowserCachePolicy(req);

  if (cachePolicy === CACHE_POLICIES.NO_CACHE) {
    setNoCacheHeaders(res);
    return;
  }

  if (cachePolicy === CACHE_POLICIES.PRIVATE_USER) {
    setTimedCacheHeaders(res, 5 * 60, "private");
    res.setHeader("Vary", "Authorization, X-User-ID, X-Device-Fingerprint");
    return;
  }

  if (cachePolicy === CACHE_POLICIES.SHORT) {
    setTimedCacheHeaders(res, 5 * 60);
    return;
  }

  setTimedCacheHeaders(res, 10 * 60);
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
      const ret = isRequestInternalTestUser(req);
      if (!ret) {
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
