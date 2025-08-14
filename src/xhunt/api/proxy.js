const express = require("express");
const { securityMiddleware } = require("../middleware/security");
const {
  authenticateToken,
  authenticateTokenOptional,
} = require("../middleware/auth");

const router = express.Router();

// 需要可选认证的路径列表（只有这些路径需要尝试获取用户信息）
const OPTIONAL_AUTH_PATHS = [
  "/pro/api/ai/content", // AI内容生成接口需要用户信息做频率限制
];

// 条件可选认证中间件
function conditionalOptionalAuth(req, res, next) {
  // 检查当前请求路径是否需要可选认证
  const needsOptionalAuth = OPTIONAL_AUTH_PATHS.some((path) =>
    req.path.includes(path)
  );

  if (needsOptionalAuth) {
    // 对于需要的路径，应用可选认证
    return authenticateTokenOptional(req, res, next);
  } else {
    // 对于其他路径，直接跳过认证
    return next();
  }
}

// AI 内容生成频率限制中间件
async function aiContentRateLimit(req, res, next) {
  try {
    // const windowLocationHref = String(
    //   req.headers["x-window-location-href"]
    // ).toLocaleLowerCase();

    // //给alpha_gege 加个白名单，没有限制的测试ai 检测功能
    // if (windowLocationHref.includes("/alpha_gege/")) {
    //   return next();
    // }
    // 只对 /pro/api/ai/content 的 POST 请求进行限制
    if (req.method !== "POST" || !req.path.includes("/pro/api/ai/content")) {
      return next();
    }

    // 获取用户标识
    let userKey;
    if (req.user && req.user.id) {
      // 已登录用户：使用用户ID作为key
      userKey = `ai_content_limit:user:${req.user.id}`;
    } else if (req.securityContext && req.securityContext.fingerprint) {
      // 未登录用户：使用指纹作为key
      userKey = `ai_content_limit:fingerprint:${req.securityContext.fingerprint}`;
    } else {
      // 无法识别用户，拒绝请求
      return res.status(400).json({
        error: "无法识别用户身份，请刷新页面重试",
      });
    }

    // 获取今天的日期作为过期时间计算基准
    const now = new Date();
    const beijingTime = new Date(
      now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
    );
    const today = beijingTime.toISOString().split("T")[0];
    const dailyKey = `${userKey}:${today}`;

    // 检查今日调用次数
    const currentCount = (await req.redisClient.get(dailyKey)) || 0;
    const maxCalls = 5; // 每日最大调用次数

    if (parseInt(currentCount) >= maxCalls) {
      return res.status(429).json({
        error: "今日AI内容生成次数已用完",
        message: `您今日已使用${currentCount}/${maxCalls}次，请明天再试`,
        resetTime: getNextDayResetTime(beijingTime),
      });
    }

    // 增加调用次数
    const newCount = await req.redisClient.incr(dailyKey);

    // 设置过期时间到明天00:00（北京时间）
    if (newCount === 1) {
      const secondsUntilMidnight = getSecondsUntilMidnight(beijingTime);
      await req.redisClient.expire(dailyKey, secondsUntilMidnight);
    }

    // 在响应头中添加使用情况信息
    res.setHeader("X-RateLimit-Limit", maxCalls);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxCalls - newCount));
    res.setHeader("X-RateLimit-Reset", getNextDayResetTime(beijingTime));

    next();
  } catch (error) {
    console.error("AI content rate limit error:", error);
    // 发生错误时不阻止请求，但记录日志
    next();
  }
}

// 获取到明天00:00的秒数
function getSecondsUntilMidnight(beijingTime) {
  const tomorrow = new Date(beijingTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return Math.ceil((tomorrow - beijingTime) / 1000);
}

// 获取明天00:00的时间戳
function getNextDayResetTime(beijingTime) {
  const tomorrow = new Date(beijingTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.getTime();
}

// URL映射配置
const URL_MAPPINGS = {
  kota: "https://kota.chaineye.tools",
  kb: "http://150.5.158.179:8087",
  kota_temporary: "http://172.31.0.8:16531",
  k8s_kota: "https://data.cryptohunt.ai",
};

// 默认目标服务器
const DEFAULT_TARGET = "kota";
const TEMPORARY_TARGET = "kota_temporary";

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
    const data = await response.json();

    // 设置浏览器缓存策略
    setBrowserCacheHeaders(res, req.method);

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

// 代理路由 - 无需认证（但特定路径可选择性识别用户）
router.all(
  "/public/*",
  conditionalOptionalAuth,
  securityMiddleware,
  aiContentRateLimit,
  async (req, res) => {
    const targetUrl = getTargetUrl(req);
    await proxyRequest(req, res, targetUrl);
  }
);

module.exports = router;
