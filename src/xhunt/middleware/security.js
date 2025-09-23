const rateLimit = require("express-rate-limit");
const crypto = require("crypto");

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
  max: 400, // 限制请求次数
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "请求过于频繁，请稍后再试",
    });
  },
});

// 基于设备指纹的速率限制
const fingerprintLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers["x-device-fingerprint"] || req.ip,
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
  const payload = [
    method.toUpperCase(),
    path.endsWith("/") ? path.slice(0, -1) : path,
    timestamp,
    fingerprint,
    JSON.stringify(body || {}),
  ].join("|");
  return crypto
    .createHmac("sha256", process.env.XHUNT_API_SECRET)
    .update(payload)
    .digest("hex");
};

// 浏览器环境检测中间件
const browserOnlyMiddleware = (req, res, next) => {
  try {
    const userAgent = req.headers["user-agent"];
    const windowLocationHref = req.headers["x-window-location-href"];
    const version = req.headers["x-extension-version"];

    // 检查是否需要跳过浏览器环境检测
    const currentPath = req.baseUrl + req.path;
    const shouldSkipBrowserCheck =
      windowLocationHref === "background-script" &&
      SKIP_SIGNATURE_PATHS.includes(currentPath) &&
      version === "0.0.0";

    // 如果是后台脚本且满足跳过条件，则跳过浏览器环境检测
    if (shouldSkipBrowserCheck) {
      return next();
    }

    if (!isBrowserEnvironment(userAgent, windowLocationHref)) {
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
    // 检查必要的请求头
    const requestId = req.headers["x-request-id"];
    const timestamp = parseInt(req.headers["x-request-timestamp"]);
    const fingerprint = req.headers["x-device-fingerprint"];
    const signature = req.headers["x-request-signature"];
    const version = req.headers["x-extension-version"];

    // 验证请求头是否存在
    if (!requestId || !timestamp || !fingerprint || !signature || !version) {
      return res.status(400).json({ error: "400" });
    }

    // 验证指纹格式
    if (!isValidFingerprint(fingerprint)) {
      return res.status(400).json({ error: "400-1" });
    }

    // 验证请求ID格式
    if (!isValidRequestId(requestId)) {
      return res.status(400).json({ error: "400-2" });
    }

    // 验证时间戳
    if (!isTimestampValid(timestamp)) {
      return res.status(400).json({ error: "400-3" });
    }

    // 检查是否需要跳过签名验证
    const windowLocationHref = req.headers["x-window-location-href"];
    const currentPath = req.baseUrl + req.path;
    const shouldSkipSignature =
      windowLocationHref === "background-script" &&
      SKIP_SIGNATURE_PATHS.includes(currentPath) &&
      version === "0.0.0";

    // 验证签名（除非满足跳过条件）
    if (!shouldSkipSignature) {
      const expectedSignature = generateSignature(
        req.method,
        req.baseUrl + req.path,
        timestamp,
        req.body,
        fingerprint
      );
      if (signature !== expectedSignature) {
        return res.status(411).json({ error: "411" });
      }
    }

    // 🔥 智能日活统计 - 使用缓存管理器
    const xUserId = req.headers["x-user-id"];

    if (dauCacheManager.shouldWriteToRedis(fingerprint, xUserId)) {
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

      // 异步写入 Redis（非阻塞）
      setImmediate(async () => {
        try {
          const dauKey = `dau:${today}`;
          // 使用 fingerprint,x-user-id 组合作为唯一标识，提高统计精确性
          const uniqueIdentifier = `${fingerprint},${xUserId}`;
          await req.redisClient.sAdd(dauKey, uniqueIdentifier);
          // 设置过期时间（保留8天，确保7天数据完整）
          await req.redisClient.expire(dauKey, 8 * 24 * 60 * 60);
        } catch (redisError) {
          // Redis 错误不影响主流程，只记录日志
          console.error("DAU tracking error:", redisError);
          // Redis 失败时从缓存中移除，允许下次重试
          dauCacheManager.removeFromCache(fingerprint, xUserId);
        }
      });
    }
    // 如果在缓存期内，直接跳过（避免重复写入）

    // 将验证后的信息添加到请求对象中
    req.securityContext = {
      requestId,
      timestamp,
      fingerprint,
      version,
    };
    next();
  } catch (error) {
    console.error("Security middleware error:", error);
    res.status(500).json({ error: "securityMiddleware 500" });
  }
};

module.exports = {
  rateLimiter,
  fingerprintLimiter,
  securityMiddleware,
  browserOnlyMiddleware,
  generateSignature, // 导出用于测试
  dauCacheManager, // 导出缓存管理器（用于测试和监控）
};
