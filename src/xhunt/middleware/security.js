const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
// 延迟导入以避免循环依赖
let DailyActiveUser = null;

// 🚀 智能日活统计缓存管理器
class DAUCacheManager {
  constructor() {
    this.recentFingerprints = new Map(); // key: date_fingerprint, value: timestamp
    this.CACHE_DURATION = 10 * 60 * 1000; // 10分钟缓存
    this.cleanupTimer = null;
    this.isInitialized = false;
  }

  // 初始化定时器（只执行一次）
  init() {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60 * 1000); // 每分钟清理一次

    console.log("🚀 DAU缓存管理器已初始化");
  }

  // 清理过期缓存
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    for (let [key, timestamp] of this.recentFingerprints) {
      if (now - timestamp > this.CACHE_DURATION) {
        this.recentFingerprints.delete(key);
        cleanedCount++;
      }
    }

    // 只在有清理时才输出日志，避免日志污染
    if (cleanedCount > 0) {
      console.log(
        `🧹 DAU缓存清理: 移除 ${cleanedCount} 个过期条目，当前缓存大小: ${this.recentFingerprints.size}`
      );
    }
  }

  // 检查是否需要写入Redis
  shouldWriteToRedis(fingerprint, xUserId) {
    // 如果没有 x-user-id，不进行统计
    if (!xUserId) {
      return false;
    }

    // 使用UTC方法计算北京时间（UTC+8）
    const now = new Date();
    const utcHours = now.getUTCHours();
    const beijingHours = utcHours + 8;

    // 如果北京时间超过24小时，说明是下一天
    let beijingDate = new Date(now);
    if (beijingHours >= 24) {
      beijingDate.setUTCDate(beijingDate.getUTCDate() + 1);
      beijingDate.setUTCHours(beijingHours - 24);
    } else {
      beijingDate.setUTCHours(beijingHours);
    }

    const today = beijingDate.toISOString().split("T")[0];
    // 使用 fingerprint,x-user-id 组合作为缓存键，提高唯一性
    const cacheKey = `${today}_${fingerprint}_${xUserId}`;

    if (!this.recentFingerprints.has(cacheKey)) {
      // 未缓存，标记为已处理
      this.recentFingerprints.set(cacheKey, Date.now());
      return true;
    }

    return false; // 已缓存，跳过
  }

  // 从缓存中移除（用于Redis失败时的重试机制）
  removeFromCache(fingerprint, xUserId) {
    if (!xUserId) {
      return;
    }

    // 使用UTC方法计算北京时间（UTC+8）
    const now = new Date();
    const utcHours = now.getUTCHours();
    const beijingHours = utcHours + 8;

    // 如果北京时间超过24小时，说明是下一天
    let beijingDate = new Date(now);
    if (beijingHours >= 24) {
      beijingDate.setUTCDate(beijingDate.getUTCDate() + 1);
      beijingDate.setUTCHours(beijingHours - 24);
    } else {
      beijingDate.setUTCHours(beijingHours);
    }

    const today = beijingDate.toISOString().split("T")[0];
    const cacheKey = `${today}_${fingerprint}_${xUserId}`;
    this.recentFingerprints.delete(cacheKey);
  }

  // 销毁定时器（用于测试或服务关闭）
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      this.isInitialized = false;
      console.log("🛑 DAU缓存管理器已销毁");
    }
  }

  // 获取缓存状态（用于调试）
  getStatus() {
    return {
      cacheSize: this.recentFingerprints.size,
      isInitialized: this.isInitialized,
      cacheDuration: this.CACHE_DURATION,
    };
  }
}

// 创建单例实例
const dauCacheManager = new DAUCacheManager();

// 定义跳过签名验证的路径列表
const SKIP_SIGNATURE_PATHS = [
  "/api/xhunt/proxy/public/fetch/twitter/feed",
  "/api/xhunt/proxy/public/fetch/twitter/top_tweet",
];

// 速率限制中间件
const rateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10分钟窗口
  max: 1500, // 限制请求次数
  standardHeaders: true,
  legacyHeaders: false,
  // 跳过内部监控路由
  skip: (req) => {
    return req.path.startsWith("/api/xhunt/stats");
  },
  handler: (req, res) => {
    res.status(429).json({
      error: "请求过于频繁，请稍后再试",
    });
  },
});

// 基于设备指纹的速率限制
const fingerprintLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const fingerprint = req.headers["x-device-fingerprint"];
    // 如果指纹是特定值，使用IP进行限速；否则使用指纹限速
    if (fingerprint === "0fa18b367456abdea6060e931e4902b4") {
      return req.ip;
    }
    return fingerprint || req.ip;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: "设备请求过于频繁，请稍后再试",
    });
  },
});

// 验证时间戳是否在有效期内（5分钟）
const isTimestampValid = (timestamp) => {
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  return Math.abs(now - timestamp) <= fiveMinutes;
};

// 验证指纹格式
const isValidFingerprint = (fingerprint) => {
  // FingerprintJS 生成的指纹是一个32位的十六进制字符串
  const fingerprintRegex = /^[a-f0-9]{32}$/i;
  return fingerprintRegex.test(fingerprint);
};

// 验证请求ID格式
const isValidRequestId = (requestId) => {
  // UUID v4 格式
  const uuidV4Regex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Regex.test(requestId);
};

// 检测是否为浏览器环境
const isBrowserEnvironment = (userAgent, windowLocationHref) => {
  if (!userAgent || !windowLocationHref) {
    return false;
  }

  // 检查 User-Agent 是否包含常见浏览器标识
  const browserPatterns = [
    // 主流桌面浏览器
    /Chrome\/\d+/i,
    /Firefox\/\d+/i,
    /Safari\/\d+/i,
    /Edge\/\d+/i,
    /Opera\/\d+/i,
    /Chromium\/\d+/i,

    // 移动端浏览器
    /Mobile.*Safari/i,
    /Android.*Chrome/i,
    /iPhone.*Safari/i,
    /iPad.*Safari/i,
    /Mobile.*Firefox/i,
    /SamsungBrowser\/\d+/i,
    /UCBrowser\/\d+/i,
    /MiuiBrowser\/\d+/i,
    /QQBrowser\/\d+/i,
    /BaiduBrowser\/\d+/i,
    /SogouMobileBrowser\/\d+/i,

    // 其他常见浏览器
    /Vivaldi\/\d+/i,
    /Brave\/\d+/i,
    /DuckDuckGo\/\d+/i,
    /Yandex\/\d+/i,
    /OPR\/\d+/i, // Opera 的另一种标识
    /Edg\/\d+/i, // Edge 的另一种标识
    /EdgA\/\d+/i, // Edge Android
    /EdgiOS\/\d+/i, // Edge iOS
    /CriOS\/\d+/i, // Chrome iOS
    /FxiOS\/\d+/i, // Firefox iOS
    /Version\/.*Safari/i, // Safari 的标准格式

    // WebView 和嵌入式浏览器
    /WebView/i,
    /wv\)/i, // Android WebView
    /Version\/.*Mobile.*Safari/i, // 移动端 Safari WebView

    // 国产浏览器
    /360SE/i, // 360安全浏览器
    /360EE/i, // 360极速浏览器
    /Maxthon/i, // 傲游浏览器
    /TencentTraveler/i, // 腾讯TT浏览器
    /TheWorld/i, // 世界之窗浏览器
    /LBBROWSER/i, // 猎豹浏览器
    /2345Explorer/i, // 2345浏览器
    /115Browser/i, // 115浏览器

    // 其他可能的浏览器标识
    /Mozilla\/\d+.*Gecko/i, // 基于 Gecko 的浏览器
    /AppleWebKit\/\d+/i, // 基于 WebKit 的浏览器
    /KHTML.*like.*Gecko/i, // 类似 Gecko 的浏览器
  ];

  const hasBrowserUA = browserPatterns.some((pattern) =>
    pattern.test(userAgent)
  );

  // 检查是否包含脚本特征（常见的脚本 User-Agent）
  const scriptPatterns = [
    /curl/i,
    /wget/i,
    /python/i,
    /node/i,
    /axios/i,
    /fetch/i,
    /postman/i,
    /insomnia/i,
    /httpie/i,
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,
    /automation/i,
    /headless/i,
    /phantom/i,
    /selenium/i,
    /webdriver/i,
    /puppeteer/i,
    /playwright/i,
  ];

  const hasScriptUA = scriptPatterns.some((pattern) => pattern.test(userAgent));

  // 检查 window.location.href 格式是否合理
  const isValidUrl = /^https?:\/\/.+/.test(windowLocationHref);

  // 必须有浏览器特征，没有脚本特征，且有有效的 URL
  return hasBrowserUA && !hasScriptUA && isValidUrl;
};

// 生成签名
const generateSignature = (method, path, timestamp, body, fingerprint) => {
  // 处理 path：去掉末尾的斜杠
  const normalizedPath = path.endsWith("/") ? path.slice(0, -1) : path;

  // 处理 body：如果是 null 或 undefined，使用空字符串（与前端保持一致）
  // 如果有 body，使用 JSON.stringify
  const bodyString =
    body === null || body === undefined ? "" : JSON.stringify(body);

  const payload = [
    method.toUpperCase(),
    normalizedPath,
    timestamp,
    fingerprint,
    bodyString,
  ].join("|");

  return crypto
    .createHmac("sha256", process.env.XHUNT_API_SECRET)
    .update(payload)
    .digest("hex");
};

/**
 * FNV-1a哈希算法（32位版本）
 * @param {string} input - 输入字符串
 * @returns {number} 32位无符号整数哈希值
 */
const fnv1aHash = (input) => {
  const FNV_OFFSET_BASIS = 2166136261;
  const FNV_PRIME = 16777619;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * FNV_PRIME) >>> 0; // 无符号32位整数
  }

  return hash >>> 0;
};

/**
 * 简单的Base64编码（用于签名输出）
 * @param {number[]} bytes - 字节数组
 * @returns {string} Base64编码字符串
 */
const simpleBase64Encode = (bytes) => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const byte1 = bytes[i];
    const byte2 = bytes[i + 1] || 0;
    const byte3 = bytes[i + 2] || 0;

    const bitmap = (byte1 << 16) | (byte2 << 8) | byte3;

    result += chars.charAt((bitmap >> 18) & 63);
    result += chars.charAt((bitmap >> 12) & 63);
    result += i + 1 < bytes.length ? chars.charAt((bitmap >> 6) & 63) : "=";
    result += i + 2 < bytes.length ? chars.charAt(bitmap & 63) : "=";
  }

  return result;
};

/**
 * 生成基于请求参数的真实签名（用于 SSE）
 * 使用FNV-1a哈希算法生成确定性签名
 * @param {string} requestId - 请求ID
 * @param {string} timestamp - 时间戳
 * @param {string} fingerprint - 设备指纹
 * @param {string} method - HTTP 方法
 * @param {string} path - 请求路径（包含查询参数，如 x_language）
 * @returns {string} Base64编码的签名
 */
const generateSSESignature = (
  requestId,
  timestamp,
  fingerprint,
  method,
  path
) => {
  // 按照固定顺序组合参数：timestamp|fingerprint|method|path|requestId
  const input = `${timestamp}|${fingerprint}|${method}|${path}|${requestId}`;

  // 使用FNV-1a哈希算法生成主哈希值
  const hash1 = fnv1aHash(input);

  // 对输入进行反转后再哈希，增加复杂性
  const reversedInput = input.split("").reverse().join("");
  const hash2 = fnv1aHash(reversedInput);

  // 组合两个哈希值（64位）
  const combined = ((BigInt(hash1) << 32n) | BigInt(hash2))
    .toString(16)
    .padStart(16, "0");

  // 将16进制字符串转换为字节数组
  const bytes = [];
  for (let i = 0; i < combined.length; i += 2) {
    bytes.push(parseInt(combined.slice(i, i + 2), 16));
  }

  // 使用Base64编码输出签名
  return simpleBase64Encode(bytes);
};

/**
 * 从请求中读取参数（支持从 header 或 query 读取，优先使用 header）
 * @param {express.Request} req - Express 请求对象
 * @param {string} paramName - 参数名称（不包含 x- 前缀）
 * @param {boolean} allowQueryParams - 是否允许从查询参数读取（默认 true）
 * @returns {string|undefined} 参数值
 */
const getRequestParam = (req, paramName, allowQueryParams = true) => {
  const headerName = `x-${paramName}`;
  // 同时支持 x- 和 x_ 格式（query 参数中可能使用下划线）
  const queryNameWithDash = `x-${paramName}`;
  const queryNameWithUnderscore = `x_${paramName}`;

  if (allowQueryParams) {
    return (
      req.headers[headerName] ||
      req.query[queryNameWithDash] ||
      req.query[queryNameWithUnderscore]
    );
  }
  return req.headers[headerName];
};

/**
 * 处理 DAU 统计（异步写入 Redis 和 PostgreSQL）
 * @param {express.Request} req - Express 请求对象
 * @param {string} fingerprint - 设备指纹
 * @param {string} xUserId - 用户ID
 */
const handleDAUTracking = (req, fingerprint, xUserId) => {
  if (!dauCacheManager.shouldWriteToRedis(fingerprint, xUserId)) {
    return; // 缓存期内，跳过
  }

  // 使用UTC方法计算北京时间（UTC+8）
  const now = new Date();
  const utcHours = now.getUTCHours();
  const beijingHours = utcHours + 8;

  // 如果北京时间超过24小时，说明是下一天
  let beijingDate = new Date(now);
  if (beijingHours >= 24) {
    beijingDate.setUTCDate(beijingDate.getUTCDate() + 1);
    beijingDate.setUTCHours(beijingHours - 24);
  } else {
    beijingDate.setUTCHours(beijingHours);
  }

  const today = beijingDate.toISOString().split("T")[0];

  // 异步写入 Redis 和 PostgreSQL（非阻塞）
  setImmediate(async () => {
    try {
      // 写入 Redis
      const dauKey = `dau:${today}`;
      // 使用 fingerprint,x-user-id 组合作为唯一标识，提高统计精确性
      const uniqueIdentifier = `${fingerprint},${xUserId}`;
      await req.redisClient.sAdd(dauKey, uniqueIdentifier);
      // 设置过期时间（保留8天，确保7天数据完整）
      await req.redisClient.expire(dauKey, 8 * 24 * 60 * 60);

      // 写入 PostgreSQL（延迟加载模型避免循环依赖）
      if (!DailyActiveUser) {
        const postgresModels = require("../../models/postgres-start");
        DailyActiveUser = postgresModels.DailyActiveUser;
      }

      // 注意：此方法只在 shouldWriteToRedis 返回 true 时才调用
      // 而 shouldWriteToRedis 会确保 xUserId 存在
      // 使用 xUserId 作为用户标识（只记录登录用户）
      const [record, created] = await DailyActiveUser.findOrCreate({
        where: {
          userId: xUserId, // 只使用 xUserId，不fallback到fingerprint
          date: today,
        },
        defaults: {
          userId: xUserId,
          date: today,
        },
      });

      // 记录数据库写入日志
      if (created) {
        console.log(`📊 DAU数据库记录已创建: userId=${xUserId}, date=${today}`);
      }
    } catch (error) {
      // 错误不影响主流程，只记录日志
      console.error("DAU tracking error:", error);
      // 失败时从缓存中移除，允许下次重试
      dauCacheManager.removeFromCache(fingerprint, xUserId);
    }
  });
};

/**
 * 验证浏览器环境（核心逻辑）
 * @param {express.Request} req - Express 请求对象
 * @param {boolean} allowQueryParams - 是否允许从查询参数读取
 * @returns {boolean} 是否通过验证
 */
const validateBrowserEnvironment = (req, allowQueryParams = false) => {
  const userAgent = req.headers["user-agent"];
  const windowLocationHref = getRequestParam(
    req,
    "window-location-href",
    allowQueryParams
  );
  const version = getRequestParam(req, "extension-version", allowQueryParams);

  if (!isBrowserEnvironment(userAgent, windowLocationHref)) {
    const currentPath = req.baseUrl + req.path;
    const shouldSkipBrowserCheck =
      windowLocationHref === "background-script" &&
      SKIP_SIGNATURE_PATHS.includes(currentPath) &&
      version === "0.0.0";
    return shouldSkipBrowserCheck;
  }

  return true;
};

/**
 * 验证安全参数（核心逻辑）
 * @param {express.Request} req - Express 请求对象
 * @param {boolean} allowQueryParams - 是否允许从查询参数读取
 * @returns {{isValid: boolean, error?: string, securityContext?: object}} 验证结果
 */
const validateSecurityParams = (req, allowQueryParams = false) => {
  // 使用统一的参数读取函数
  const requestId = getRequestParam(req, "request-id", allowQueryParams);
  const timestamp = parseInt(
    getRequestParam(req, "request-timestamp", allowQueryParams)
  );
  const fingerprint = getRequestParam(
    req,
    "device-fingerprint",
    allowQueryParams
  );
  const signature = getRequestParam(req, "request-signature", allowQueryParams);
  const version = getRequestParam(req, "extension-version", allowQueryParams);

  // 验证请求头是否存在
  if (!requestId || !timestamp || !fingerprint || !signature || !version) {
    return { isValid: false, error: "400" };
  }

  // 验证指纹格式
  if (!isValidFingerprint(fingerprint)) {
    return { isValid: false, error: "400-1" };
  }

  // 验证请求ID格式
  if (!isValidRequestId(requestId)) {
    return { isValid: false, error: "400-2" };
  }

  // 验证时间戳
  if (!isTimestampValid(timestamp)) {
    return { isValid: false, error: "400-3" };
  }

  // 检查是否需要跳过签名验证
  const windowLocationHref = getRequestParam(
    req,
    "window-location-href",
    allowQueryParams
  );
  const currentPath = req.baseUrl + req.path;
  const shouldSkipSignature =
    windowLocationHref === "background-script" &&
    SKIP_SIGNATURE_PATHS.includes(currentPath) &&
    version === "0.0.0";

  // 验证签名（除非满足跳过条件）
  if (!shouldSkipSignature) {
    if (allowQueryParams) {
      // SSE 请求：使用 FNV-1a 哈希算法
      const path = req.baseUrl + req.path;

      const expectedSignature = generateSSESignature(
        requestId,
        timestamp.toString(),
        fingerprint,
        req.method.toUpperCase(),
        path
      );

      console.log(
        "[sse签名new2] 验证签名 - 期望签名:",
        expectedSignature,
        "接收签名:",
        signature,
        "接收到的参数:",
        {
          requestId,
          timestamp: timestamp.toString(),
          fingerprint,
          method: req.method.toUpperCase(),
          path,
          receivedSignature: signature,
        }
      );

      if (signature !== expectedSignature) {
        return { isValid: false, error: "411" };
      }
    } else {
      // 普通请求：使用 HMAC SHA256 算法
      const path = req.baseUrl + req.path;
      const body = req.body;
      const expectedSignature = generateSignature(
        req.method,
        path,
        timestamp,
        body,
        fingerprint
      );
      if (signature !== expectedSignature) {
        return { isValid: false, error: "411" };
      }
    }
  }

  return {
    isValid: true,
    securityContext: {
      requestId,
      timestamp,
      fingerprint,
      version,
    },
  };
};

// 浏览器环境检测中间件
const browserOnlyMiddleware = (req, res, next) => {
  try {
    if (!validateBrowserEnvironment(req, false)) {
      return res.status(403).json({ error: "403" });
    }
    next();
  } catch (error) {
    console.error("Browser detection middleware error:", error);
    res.status(500).json({ error: "browserOnlyMiddleware 500" });
  }
};

// 安全中间件
const securityMiddleware = (req, res, next) => {
  // 确保缓存管理器已初始化
  dauCacheManager.init();

  try {
    // 使用统一的安全验证逻辑
    const validation = validateSecurityParams(req, false);

    if (!validation.isValid) {
      return res.status(400).json({ error: validation.error });
    }

    // 将验证后的信息添加到请求对象中
    req.securityContext = validation.securityContext;

    // 🔥 智能日活统计 - 使用统一的 DAU 处理函数
    const xUserId = req.headers["x-user-id"];
    handleDAUTracking(req, validation.securityContext.fingerprint, xUserId);

    next();
  } catch (error) {
    console.error("Security middleware error:", error);
    res.status(500).json({ error: "securityMiddleware 500" });
  }
};

// SSE 专用的安全中间件（从查询参数读取，因为 EventSource 不支持自定义 headers）
const sseSecurityMiddleware = (req, res, next) => {
  // 确保缓存管理器已初始化
  dauCacheManager.init();

  try {
    // 使用统一的安全验证逻辑（允许从查询参数读取）
    const validation = validateSecurityParams(req, true);

    if (!validation.isValid) {
      return res.status(400).json({ error: validation.error });
    }

    next();
  } catch (error) {
    console.error("SSE Security middleware error:", error);
    res.status(500).json({ error: "sseSecurityMiddleware 500" });
  }
};

module.exports = {
  rateLimiter,
  fingerprintLimiter,
  securityMiddleware,
  sseSecurityMiddleware,
  browserOnlyMiddleware,
  generateSignature, // 导出用于测试（HMAC SHA256，普通 API）
  generateSSESignature, // 导出用于测试（FNV-1a，SSE）
  dauCacheManager, // 导出缓存管理器（用于测试和监控）
};
