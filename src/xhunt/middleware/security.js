const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const {
  isDeadFingerprint,
  getRateLimitIdentity,
  attachIdentityToSecurityContext,
} = require("../utils/request-identity");
// 延迟导入以避免循环依赖
let DailyActiveUser = null;
let SecurityViolationLog = null;

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
  shouldWriteToRedis(identityKey) {
    if (!identityKey) {
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
    const cacheKey = `${today}_${identityKey}`;

    if (!this.recentFingerprints.has(cacheKey)) {
      // 未缓存，标记为已处理
      this.recentFingerprints.set(cacheKey, Date.now());
      return true;
    }

    return false; // 已缓存，跳过
  }

  // 从缓存中移除（用于Redis失败时的重试机制）
  removeFromCache(identityKey) {
    if (!identityKey) {
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
    const cacheKey = `${today}_${identityKey}`;
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

// 🚀 请求统计管理器（版本统计 + URL统计）
class RequestStatsManager {
  constructor() {
    this.versionMemoryCounter = {}; // 版本内存计数器：{ timeWindow: { version: count } }
    this.urlMemoryCounter = {}; // URL内存计数器：{ timeWindow: { urlPath: count } }
    this.lastTimeWindow = null; // 上一个时间窗口
    this.requestCount = 0; // 当前窗口的请求计数（用于每100个请求flush）
    this.isInitialized = false;
    this.MAX_MEMORY_WINDOWS = 3; // 最多在内存中保留的时间窗口数量（当前窗口 + 前2个窗口）
    this.REDIS_STATS_TTL_SECONDS = parseInt(process.env.REQUEST_STATS_REDIS_TTL_SECONDS || "1200", 10);
    this.MAX_VERSION_FIELDS_PER_WINDOW = parseInt(process.env.REQUEST_STATS_MAX_VERSION_FIELDS_PER_WINDOW || "100", 10);
    this.MAX_URL_FIELDS_PER_WINDOW = parseInt(process.env.REQUEST_STATS_MAX_URL_FIELDS_PER_WINDOW || "300", 10);
    this.VERSION_OVERFLOW_FIELD = "__other_versions__";
    this.URL_OVERFLOW_FIELD = "__other_urls__";
  }

  // 初始化
  init() {
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;
    console.log("🚀 请求统计管理器已初始化（版本统计 + URL统计）");
  }

  // 获取5分钟时间窗口（向下取整到5分钟）
  get5MinWindow() {
    const now = new Date();
    const minutes = now.getUTCMinutes();
    const roundedMinutes = Math.floor(minutes / 5) * 5;
    const window = new Date(now);
    window.setUTCMinutes(roundedMinutes);
    window.setUTCSeconds(0);
    window.setUTCMilliseconds(0);
    return window.toISOString();
  }

  // 清理旧的时间窗口数据（防止内存无限增长）
  cleanupOldWindows(currentTimeWindow) {
    // 合并两个计数器的所有窗口（去重）
    const allWindows = new Set([
      ...Object.keys(this.versionMemoryCounter),
      ...Object.keys(this.urlMemoryCounter),
    ]);

    // 如果窗口数量超过限制，清理最旧的窗口
    if (allWindows.size > this.MAX_MEMORY_WINDOWS) {
      // 按时间排序，保留最新的几个窗口
      const sortedWindows = Array.from(allWindows).sort();
      const windowsToKeep = sortedWindows.slice(-this.MAX_MEMORY_WINDOWS);
      const windowsToRemove = sortedWindows.slice(0, -this.MAX_MEMORY_WINDOWS);

      for (const window of windowsToRemove) {
        // 如果窗口不是当前窗口，可以安全删除
        if (window !== currentTimeWindow) {
          delete this.versionMemoryCounter[window];
          delete this.urlMemoryCounter[window];
        }
      }

      if (windowsToRemove.length > 0) {
        console.warn(
          `[请求统计] ⚠️ 清理了 ${windowsToRemove.length} 个旧时间窗口的内存数据（防止内存增长，保留 ${windowsToKeep.length} 个窗口）`
        );
      }
    }
  }

  // 归一化URL路径（将带参数的路径归一化到基础路径）
  normalizeUrlPath(pathname) {
    // 定义需要归一化的路径模式
    // 格式：{ 正则表达式: 替换为的路径 }
    const normalizationRules = [
      // /api/xhunt/notes/:handle -> /api/xhunt/notes/*
      {
        pattern: /^\/api\/xhunt\/notes\/([^\/]+)$/,
        replacement: "/api/xhunt/notes/*",
      },
      // /api/xhunt/reviews/:handle -> /api/xhunt/reviews/*
      {
        pattern: /^\/api\/xhunt\/reviews\/([^\/]+)$/,
        replacement: "/api/xhunt/reviews/*",
      },
      // /api/xhunt/reviews/:handle/comments -> /api/xhunt/reviews/*/comments
      {
        pattern: /^\/api\/xhunt\/reviews\/([^\/]+)\/comments$/,
        replacement: "/api/xhunt/reviews/*/comments",
      },
      // /api/xhunt/rootdata/relationship/:id -> /api/xhunt/rootdata/relationship/*
      {
        pattern: /^\/api\/xhunt\/rootdata\/relationship\/([^\/]+)$/,
        replacement: "/api/xhunt/rootdata/relationship/*",
      },
    ];

    // 应用归一化规则
    for (const rule of normalizationRules) {
      if (rule.pattern.test(pathname)) {
        return rule.replacement;
      }
    }

    // 如果没有匹配的规则，返回原始路径
    return pathname;
  }

  // 提取URL路径（去掉查询参数并归一化）
  extractUrlPath(req) {
    try {
      // 优先使用 baseUrl + path（这是 Express 的标准方式）
      let pathname = (req.baseUrl || "") + (req.path || "");

      // 如果没有 path，尝试使用 originalUrl 或 url
      if (!pathname || pathname === "/") {
        const fullUrl = req.originalUrl || req.url || "";

        // 如果包含协议，使用URL对象解析
        if (fullUrl.startsWith("http://") || fullUrl.startsWith("https://")) {
          const url = new URL(fullUrl);
          pathname = url.pathname;
        } else {
          // 否则直接提取路径部分（去掉查询参数）
          pathname = fullUrl.split("?")[0];
        }
      } else {
        // 去掉查询参数（如果有）
        pathname = pathname.split("?")[0];
      }

      // 确保返回的路径不为空
      pathname = pathname || "/";

      // 应用路径归一化
      pathname = this.normalizeUrlPath(pathname);

      return pathname;
    } catch (error) {
      // 如果解析失败，使用最简单的 fallback
      const path = (req.baseUrl || "") + (req.path || "/");
      const pathname = path.split("?")[0] || "/";
      return this.normalizeUrlPath(pathname);
    }
  }

  incrementBoundedCounter(counter, field, maxFields, overflowField) {
    if (!field) return;
    if (!Object.prototype.hasOwnProperty.call(counter, field)) {
      const currentFieldCount = Object.keys(counter).length;
      if (currentFieldCount >= maxFields) {
        counter[overflowField] = (counter[overflowField] || 0) + 1;
        return;
      }
    }
    counter[field] = (counter[field] || 0) + 1;
  }

  // 将版本统计内存数据flush到Redis
  async flushVersionMemoryToRedis(timeWindow, redisClient) {
    if (!this.versionMemoryCounter[timeWindow] || !redisClient) {
      return;
    }

    const versions = this.versionMemoryCounter[timeWindow];
    const pipeline = redisClient.multi();
    const key = `version_stats:${timeWindow}`;
    let hasData = false;

    for (const [version, count] of Object.entries(versions)) {
      if (count > 0) {
        pipeline.hIncrBy(key, version, count);
        hasData = true;
      }
    }
    if (hasData) {
      pipeline.expire(key, this.REDIS_STATS_TTL_SECONDS);
    }

    try {
      await pipeline.exec();
      // 清空该时间窗口的内存数据
      delete this.versionMemoryCounter[timeWindow];
    } catch (error) {
      console.error(`[版本统计] Flush内存到Redis失败 (${timeWindow}):`, error);
    }
  }

  // 将URL统计内存数据flush到Redis
  async flushUrlMemoryToRedis(timeWindow, redisClient) {
    if (!this.urlMemoryCounter[timeWindow] || !redisClient) {
      return;
    }

    const urls = this.urlMemoryCounter[timeWindow];
    const pipeline = redisClient.multi();
    const key = `url_stats:${timeWindow}`;
    let hasData = false;

    for (const [urlPath, count] of Object.entries(urls)) {
      if (count > 0) {
        pipeline.hIncrBy(key, urlPath, count);
        hasData = true;
      }
    }
    if (hasData) {
      pipeline.expire(key, this.REDIS_STATS_TTL_SECONDS);
    }

    try {
      await pipeline.exec();
      // 清空该时间窗口的内存数据
      delete this.urlMemoryCounter[timeWindow];
    } catch (error) {
      console.error(`[URL统计] Flush内存到Redis失败 (${timeWindow}):`, error);
    }
  }

  // 处理请求统计（版本 + URL）
  async handleRequestStats(req) {
    if (!req.redisClient) {
      return;
    }

    // 检查 windowLocationHref 是否为 background-script
    // 注意：版本统计会跳过 background-script，但 URL 统计需要统计所有请求
    const windowLocationHref = getRequestParam(
      req,
      "window-location-href",
      false
    );
    const isBackgroundScript = windowLocationHref === "background-script";

    const currentTimeWindow = this.get5MinWindow();

    // 如果时间窗口变化了，先flush上一个窗口的数据
    if (this.lastTimeWindow && this.lastTimeWindow !== currentTimeWindow) {
      await Promise.all([
        this.flushVersionMemoryToRedis(this.lastTimeWindow, req.redisClient),
        this.flushUrlMemoryToRedis(this.lastTimeWindow, req.redisClient),
      ]);
    }

    // 更新当前窗口
    this.lastTimeWindow = currentTimeWindow;

    // 清理旧窗口（防止内存无限增长）
    this.cleanupOldWindows(currentTimeWindow);

    // 处理版本统计（跳过 background-script）
    if (!isBackgroundScript) {
      const version = getRequestParam(req, "extension-version", true);
      if (version && version.trim() !== "") {
        // 初始化当前窗口的版本计数器
        if (!this.versionMemoryCounter[currentTimeWindow]) {
          this.versionMemoryCounter[currentTimeWindow] = {};
        }
        this.incrementBoundedCounter(
          this.versionMemoryCounter[currentTimeWindow],
          version,
          this.MAX_VERSION_FIELDS_PER_WINDOW,
          this.VERSION_OVERFLOW_FIELD
        );
      }
    }

    // 处理URL统计（所有请求都统计，包括 background-script）
    const urlPath = this.extractUrlPath(req);
    if (urlPath) {
      // 初始化当前窗口的URL计数器
      if (!this.urlMemoryCounter[currentTimeWindow]) {
        this.urlMemoryCounter[currentTimeWindow] = {};
      }
      this.incrementBoundedCounter(
        this.urlMemoryCounter[currentTimeWindow],
        urlPath,
        this.MAX_URL_FIELDS_PER_WINDOW,
        this.URL_OVERFLOW_FIELD
      );
    }

    this.requestCount++;

    // 每100个请求flush当前窗口（版本和URL一起flush）
    if (this.requestCount >= 100) {
      await Promise.all([
        this.flushVersionMemoryToRedis(currentTimeWindow, req.redisClient),
        this.flushUrlMemoryToRedis(currentTimeWindow, req.redisClient),
      ]);
      this.requestCount = 0;
    }
  }

  // 获取内存状态（用于调试）
  getStatus() {
    return {
      versionMemoryCounter: this.versionMemoryCounter,
      urlMemoryCounter: this.urlMemoryCounter,
      lastTimeWindow: this.lastTimeWindow,
      requestCount: this.requestCount,
      isInitialized: this.isInitialized,
    };
  }
}

// 创建单例实例
const requestStatsManager = new RequestStatsManager();
// 保持向后兼容的别名
const versionStatsManager = requestStatsManager;

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
  keyGenerator: (req) => getRateLimitIdentity(req, { allowQueryParams: false }),
  handler: (req, res) => {
    res.status(429).json({
      error: "设备请求过于频繁，请稍后再试",
    });
  },
});

const SECURITY_TIME_WINDOW_MS = 30 * 60 * 1000; // 30分钟窗口，需与 requestId 去重保持一致
const V2_SIGNATURE_VERSION = "v2";
const V2_SECURITY_TIME_WINDOW_MS = 5 * 60 * 1000;
const V2_REQUEST_ID_DEDUP_TTL_MS = 10 * 60 * 1000;
const V2_REQUEST_ID_DEDUP_TTL_SECONDS = Math.floor(
  V2_REQUEST_ID_DEDUP_TTL_MS / 1000
);

// 验证时间戳是否在有效期内（30分钟）
const isTimestampValid = (timestamp) => {
  const now = Date.now();
  return Math.abs(now - timestamp) <= SECURITY_TIME_WINDOW_MS;
};

// 验证 v2 时间戳是否在有效期内（5分钟）
const isV2TimestampValid = (timestamp) => {
  const now = Date.now();
  return Number.isFinite(timestamp) && Math.abs(now - timestamp) <= V2_SECURITY_TIME_WINDOW_MS;
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
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:-.+)?$/i;
  return uuidV4Regex.test(requestId);
};

const isValidTwitterId = (twitterId) => {
  const normalized = normalizeOptionalSignedValue(twitterId);
  return /^[1-9]\d{4,24}$/.test(normalized);
};

const REQUEST_ID_DEDUP_TTL_MS = SECURITY_TIME_WINDOW_MS;
const REQUEST_ID_DEDUP_TTL_SECONDS = Math.floor(REQUEST_ID_DEDUP_TTL_MS / 1000);
const REQUEST_ID_DEDUP_REDIS_PREFIX = "security:reqid:";
const REQUEST_ID_LOCAL_CACHE_MAX_SIZE = 2_000_000;
const requestIdLocalCache = new Map();
let lastRequestIdLocalPrune = 0;
const SECURITY_MIDDLEWARE_FLAG = Symbol.for("xhunt.securityMiddlewareExecuted");
const SSE_SECURITY_MIDDLEWARE_FLAG = Symbol.for(
  "xhunt.sseSecurityMiddlewareExecuted"
);
const BROWSER_ONLY_MIDDLEWARE_FLAG = Symbol.for(
  "xhunt.browserOnlyMiddlewareExecuted"
);

const buildRequestIdDedupKey = (securityContext = {}, options = {}) => {
  if (securityContext.signatureVersion === V2_SIGNATURE_VERSION) {
    if (options.isSSE) {
      // SSE 允许 EventSource 在时间窗口内使用同一个 URL 自动重连，不做阻断式去重。
      return null;
    }
    if (!securityContext.requestId) {
      return null;
    }
    return `v2:api:${String(securityContext.requestId)}`;
  }

  const { requestId, timestamp, signature, fingerprint } = securityContext;
  if (!requestId || !timestamp || !signature || !fingerprint) {
    return null;
  }
  const raw = [
    String(requestId),
    String(timestamp),
    String(signature),
    String(fingerprint),
  ].join("|");
  return crypto.createHash("sha1").update(raw).digest("hex");
};

const reserveRequestId = async (req, securityContext = {}, options = {}) => {
  if (securityContext.signatureVersion === V2_SIGNATURE_VERSION && options.isSSE) {
    return { allowed: true, source: "sse-v2-reconnect-allowed" };
  }

  const dedupKey = buildRequestIdDedupKey(securityContext, options);
  if (!dedupKey) {
    return { allowed: true, source: "skipped" };
  }

  const ttlMs =
    securityContext.signatureVersion === V2_SIGNATURE_VERSION
      ? V2_REQUEST_ID_DEDUP_TTL_MS
      : REQUEST_ID_DEDUP_TTL_MS;
  const ttlSeconds =
    securityContext.signatureVersion === V2_SIGNATURE_VERSION
      ? V2_REQUEST_ID_DEDUP_TTL_SECONDS
      : REQUEST_ID_DEDUP_TTL_SECONDS;

  const redisClient = req.redisClient;
  if (redisClient && typeof redisClient.set === "function") {
    const redisKey = `${REQUEST_ID_DEDUP_REDIS_PREFIX}${dedupKey}`;
    try {
      const result = await redisClient.set(redisKey, "1", {
        NX: true,
        EX: ttlSeconds,
      });
      if (result !== null) {
        return { allowed: true, source: "redis" };
      }
      return { allowed: false, source: "redis" };
    } catch (error) {
      console.error("[RequestIdDedup] Redis SET failed:", error);
    }
  }
  return reserveRequestIdInMemory(dedupKey, ttlMs);
};

const reserveRequestIdInMemory = (dedupKey, ttlMs = REQUEST_ID_DEDUP_TTL_MS) => {
  const now = Date.now();
  pruneLocalRequestIdCache(now);
  const lastUsedAt = requestIdLocalCache.get(dedupKey);
  if (lastUsedAt && now - lastUsedAt < ttlMs) {
    return { allowed: false, source: "memory" };
  }
  requestIdLocalCache.set(dedupKey, now);
  return { allowed: true, source: "memory" };
};

const pruneLocalRequestIdCache = (now) => {
  if (
    requestIdLocalCache.size === 0 ||
    (now - lastRequestIdLocalPrune < 60 * 1000 &&
      requestIdLocalCache.size < REQUEST_ID_LOCAL_CACHE_MAX_SIZE)
  ) {
    return;
  }
  lastRequestIdLocalPrune = now;
  for (const [key, timestamp] of requestIdLocalCache) {
    if (now - timestamp > REQUEST_ID_DEDUP_TTL_MS) {
      requestIdLocalCache.delete(key);
    } else {
      break;
    }
  }
  while (requestIdLocalCache.size > REQUEST_ID_LOCAL_CACHE_MAX_SIZE) {
    const oldestKey = requestIdLocalCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    requestIdLocalCache.delete(oldestKey);
  }
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

function normalizeOptionalSignedValue(value) {
  if (Array.isArray(value)) return normalizeOptionalSignedValue(value[0]);
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

// 生成签名
const generateSignature = (method, path, timestamp, body, fingerprint, twId = "") => {
  // 处理 path：去掉末尾的斜杠
  const normalizedPath = path.endsWith("/") ? path.slice(0, -1) : path;

  // 处理 body：如果是 null 或 undefined，使用空字符串（与前端保持一致）
  // 如果有 body，使用 JSON.stringify
  const bodyString =
    body === null || body === undefined ? "" : JSON.stringify(body);

  const payloadParts = [
    method.toUpperCase(),
    normalizedPath,
    timestamp,
    fingerprint,
    bodyString,
  ];

  const normalizedTwId = normalizeOptionalSignedValue(twId);
  // 老版本兼容：没有 x-tw-id 时保持原签名串；有 x-tw-id 时纳入签名。
  if (normalizedTwId) {
    payloadParts.push(normalizedTwId);
  }

  const payload = payloadParts.join("|");

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
  path,
  twId = ""
) => {
  // 按照固定顺序组合参数：timestamp|fingerprint|method|path|requestId
  // 老版本兼容：没有 x-tw-id 时保持原签名串；有 x-tw-id 时追加。
  const normalizedTwId = normalizeOptionalSignedValue(twId);
  const input = normalizedTwId
    ? `${timestamp}|${fingerprint}|${method}|${path}|${requestId}|${normalizedTwId}`
    : `${timestamp}|${fingerprint}|${method}|${path}|${requestId}`;

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
  const queryNameAllUnderscore = `x_${paramName.replace(/-/g, "_")}`;

  if (allowQueryParams) {
    return (
      req.headers[headerName] ||
      req.query[queryNameWithDash] ||
      req.query[queryNameWithUnderscore] ||
      req.query[queryNameAllUnderscore]
    );
  }
  return req.headers[headerName];
};

const V2_SSE_TRANSPORT_QUERY_KEYS = new Set([
  "x-signature-version",
  "x_signature_version",
  "x-request-id",
  "x_request_id",
  "x-request-timestamp",
  "x_request_timestamp",
  "x-device-fingerprint",
  "x_device_fingerprint",
  "x-request-signature",
  "x_request_signature",
  "x-tw-id",
  "x_tw_id",
  "x-extension-version",
  "x_extension_version",
  "x-user-id",
  "x_user_id",
  "x-window-location-href",
  "x_window_location_href",
  "token",
]);

const sanitizeQueryStringForLog = (queryString = "") => {
  if (!queryString) return "";
  try {
    const params = new URLSearchParams(queryString);
    for (const key of Array.from(params.keys())) {
      const normalizedKey = String(key).toLowerCase();
      if (
        normalizedKey === "token" ||
        normalizedKey === "x-request-signature" ||
        normalizedKey === "x_request_signature" ||
        normalizedKey === "x-device-fingerprint" ||
        normalizedKey === "x_device_fingerprint" ||
        normalizedKey === "x-window-location-href" ||
        normalizedKey === "x_window_location_href"
      ) {
        params.set(key, "[REDACTED]");
      }
    }
    return params.toString();
  } catch (_) {
    return queryString
      .replace(/((?:^|[?&])token=)[^&]*/gi, "$1[REDACTED]")
      .replace(/((?:^|[?&])x[-_]request[-_]signature=)[^&]*/gi, "$1[REDACTED]")
      .replace(/((?:^|[?&])x[-_]device[-_]fingerprint=)[^&]*/gi, "$1[REDACTED]")
      .replace(/((?:^|[?&])x[-_]window[-_]location[-_]href=)[^&]*/gi, "$1[REDACTED]");
  }
};

const appendQueryValue = (params, key, value) => {
  if (value === null || value === undefined) {
    params.append(key, "");
    return;
  }
  if (typeof value === "object") {
    throw new Error(`Unsupported nested query parameter: ${key}`);
  }
  params.append(key, String(value));
};

const buildV2PathWithQuery = (req, { isSSE = false, language = "" } = {}) => {
  const originalUrl = req.originalUrl || req.url || "";
  const queryStart = originalUrl.indexOf("?");
  const rawPath = queryStart >= 0 ? originalUrl.slice(0, queryStart) : originalUrl;
  const rawSearch = queryStart >= 0 ? originalUrl.slice(queryStart + 1) : "";
  const pathname =
    rawPath ||
    `${req.baseUrl || ""}${req.path || ""}` ||
    req.path ||
    "/";

  const params = new URLSearchParams(rawSearch || "");

  if (isSSE) {
    for (const key of Array.from(params.keys())) {
      if (V2_SSE_TRANSPORT_QUERY_KEYS.has(String(key).toLowerCase())) {
        params.delete(key);
      }
    }
  }

  const hasLanguage = Array.from(params.keys()).some(
    (key) => String(key).toLowerCase() === "x-language"
  );
  if (!hasLanguage && language !== null && language !== undefined && String(language).trim()) {
    params.append("x-language", String(language));
  }

  const sortedEntries = Array.from(params.entries()).sort(([ak, av], [bk, bv]) => {
    if (ak !== bk) return ak < bk ? -1 : 1;
    if (av !== bv) return av < bv ? -1 : 1;
    return 0;
  });

  const sortedParams = new URLSearchParams();
  for (const [key, value] of sortedEntries) {
    appendQueryValue(sortedParams, key, value);
  }

  const search = sortedParams.toString();
  return search ? `${pathname}?${search}` : pathname;
};

const hashBodySha512 = (bodyText = "") =>
  crypto.createHash("sha512").update(bodyText).digest("hex");

const generateV2Signature = (canonicalPayload, signingKey = process.env.XHUNT_V2_SIGNING_KEY) =>
  crypto.createHmac("sha512", signingKey).update(canonicalPayload).digest("hex");

const safeCompareHex = (actual, expected) => {
  if (typeof actual !== "string" || typeof expected !== "string") {
    return false;
  }
  const normalizedActual = actual.trim().toLowerCase();
  const normalizedExpected = expected.trim().toLowerCase();
  if (!/^[a-f0-9]+$/.test(normalizedActual)) {
    return false;
  }
  if (normalizedActual.length !== normalizedExpected.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(
      Buffer.from(normalizedActual, "hex"),
      Buffer.from(normalizedExpected, "hex")
    );
  } catch (_) {
    return false;
  }
};

function normalizeDauMetaValue(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function getDauUserMeta(req, identity) {
  const headerUserId = normalizeDauMetaValue(req.headers?.["x-user-id"]);
  const username = normalizeDauMetaValue(req.user?.username || headerUserId);
  const displayName = normalizeDauMetaValue(req.user?.displayName || username);
  const twitterId = normalizeDauMetaValue(req.user?.twitterId || (identity?.type === "twitterId" ? identity.value : ""));

  if (!username && !displayName && !twitterId) {
    return null;
  }

  return {
    userId: username || displayName || twitterId,
    username: username || null,
    displayName: displayName || null,
    twitterId: twitterId || null,
    updatedAt: new Date().toISOString(),
  };
}

async function writeDauUserMeta(redisClient, date, identityKey, meta) {
  if (!redisClient || !date || !identityKey || !meta?.userId) return;
  const metaKey = `dau:meta:${date}`;
  await redisClient.hSet(metaKey, identityKey, JSON.stringify(meta));
  await redisClient.expire(metaKey, 8 * 24 * 60 * 60);
}

const SECURITY_ERROR_REASON_MAP = {
  400: {
    reasonCode: "missing_headers",
    message: "缺少必需的安全请求参数",
  },
  "400-1": {
    reasonCode: "invalid_fingerprint",
    message: "设备指纹格式不合法",
  },
  "400-2": {
    reasonCode: "invalid_request_id",
    message: "请求ID格式不合法",
  },
  "400-3": {
    reasonCode: "invalid_timestamp",
    message: "请求时间戳超出允许范围",
  },
  409: {
    reasonCode: "duplicate_request",
    message: "30分钟内重复的请求ID",
  },
  411: {
    reasonCode: "invalid_signature",
    message: "请求签名不匹配",
  },
  MISSING_SIGNATURE_HEADERS: {
    reasonCode: "missing_signature_headers",
    message: "缺少 v2 必需的签名请求参数",
  },
  MISSING_TWITTER_ID: {
    reasonCode: "missing_twitter_id",
    message: "缺少 x-tw-id",
  },
  INVALID_TWITTER_ID: {
    reasonCode: "invalid_twitter_id",
    message: "x-tw-id 格式不合法",
  },
  INVALID_REQUEST_ID: {
    reasonCode: "invalid_request_id",
    message: "请求ID格式不合法",
  },
  SIGNATURE_EXPIRED: {
    reasonCode: "signature_expired",
    message: "请求时间戳超出允许范围",
  },
  REPLAY_REQUEST: {
    reasonCode: "replay_request",
    message: "重复的请求ID",
  },
  INVALID_SIGNATURE: {
    reasonCode: "invalid_signature",
    message: "请求签名不匹配",
  },
  SIGNING_KEY_NOT_CONFIGURED: {
    reasonCode: "signing_key_not_configured",
    message: "v2 签名密钥未配置",
  },
  default: {
    reasonCode: "unknown",
    message: "安全校验失败",
  },
};

const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "cookie",
  "x-api-key",
  "x-access-token",
  "x-device-fingerprint",
  "x-request-signature",
  "x-window-location-href",
  "proxy-authorization",
  "cf-access-token",
  "x-forwarded-authorization",
]);

const SKIP_SSE_SECURITY_LOG_PATHS = [
  "fetch/twitter/feed",
  "fetch/twitter/top_tweet",
];

const shouldSkipSecurityViolationLog = (req) => {
  const base = typeof req.baseUrl === "string" ? req.baseUrl : "";
  const path = typeof req.path === "string" ? req.path : "";
  const fullPath = `${base}${path}` || req.url || "";
  return SKIP_SSE_SECURITY_LOG_PATHS.some(
    (skipPath) => typeof skipPath === "string" && fullPath.includes(skipPath)
  );
};

class SecurityViolationLogger {
  constructor() {
    this.windowDuration = 10 * 60 * 1000; // 10分钟
    this.windowLimit = 20; // 单窗口最多写入20条
    this.currentWindowStart = Date.now();
    this.windowCount = 0;
    this.droppedCount = 0;
    this.invalidTimestampWindow = 2 * 60 * 60 * 1000; // 2小时
    this.invalidTimestampLogTracker = new Map();
  }

  rotateWindow(now = Date.now()) {
    if (now - this.currentWindowStart >= this.windowDuration) {
      this.currentWindowStart = now;
      this.windowCount = 0;
      this.droppedCount = 0;
    }
  }

  canWrite(now) {
    this.rotateWindow(now);
    return this.windowCount < this.windowLimit;
  }

  logViolation(req, options = {}) {
    try {
      const now = Date.now();
      const { errorCode, allowQueryParams = false } = options;
      // duplicate_request(409) 类型不写入数据库；
      // MISSING_SIGNATURE_HEADERS 仅在 x-user-id 为空时不写入数据库。
      if (errorCode === "409") {
        return;
      }
      if (
        errorCode === "MISSING_SIGNATURE_HEADERS" &&
        !this.normalizeIdentifier(req.headers?.["x-user-id"])
      ) {
        return;
      }
      let invalidTimestampIdentifiers = null;
      if (errorCode === "400-3") {
        const throttleCheck = this.shouldThrottleInvalidTimestampLog(
          req,
          allowQueryParams,
          now
        );
        if (throttleCheck.shouldThrottle) {
          return;
        }
        invalidTimestampIdentifiers = throttleCheck.identifiers;
      }

      if (!this.canWrite(now)) {
        this.droppedCount++;
        if (this.droppedCount === 1 || this.droppedCount % 10 === 0) {
          console.warn(
            `[SecurityViolation] 日志写入被限流：10分钟内已写入 ${this.windowLimit} 条，已丢弃 ${this.droppedCount} 条`
          );
        }
        return;
      }

      const payload = this.buildRecord(req, options);
      if (!payload) {
        return;
      }
      if (errorCode === "400-3" && invalidTimestampIdentifiers?.length) {
        this.updateInvalidTimestampTracker(invalidTimestampIdentifiers, now);
      }

      this.windowCount++;
      setImmediate(async () => {
        try {
          if (!SecurityViolationLog) {
            const postgresModels = require("../../models/postgres-start");
            SecurityViolationLog = postgresModels.SecurityViolationLog;
          }
          await SecurityViolationLog.create(payload);
        } catch (error) {
          console.error("记录安全校验失败日志失败:", error);
          this.windowCount = Math.max(this.windowCount - 1, 0);
        }
      });
    } catch (error) {
      console.error("安全校验失败日志处理异常:", error);
    }
  }

  shouldThrottleInvalidTimestampLog(req, allowQueryParams, now) {
    const identifiers = this.extractInvalidTimestampIdentifiers(
      req,
      allowQueryParams
    );
    if (!identifiers.length) {
      return { shouldThrottle: false, identifiers };
    }
    let shouldThrottle = false;
    for (const key of identifiers) {
      const lastLoggedAt = this.invalidTimestampLogTracker.get(key);
      if (lastLoggedAt && now - lastLoggedAt < this.invalidTimestampWindow) {
        shouldThrottle = true;
        break;
      }
      if (lastLoggedAt && now - lastLoggedAt >= this.invalidTimestampWindow) {
        this.invalidTimestampLogTracker.delete(key);
      }
    }
    return { shouldThrottle, identifiers };
  }

  extractInvalidTimestampIdentifiers(req, allowQueryParams) {
    const identifiers = [];
    const xUserId = this.normalizeIdentifier(req.headers?.["x-user-id"]);
    if (xUserId) {
      identifiers.push(`user:${xUserId}`);
    }
    const fingerprint = this.normalizeIdentifier(
      getRequestParam(req, "device-fingerprint", allowQueryParams)
    );
    if (fingerprint && !isDeadFingerprint(fingerprint)) {
      identifiers.push(`fp:${fingerprint}`);
    }
    return identifiers;
  }

  updateInvalidTimestampTracker(identifiers, timestamp) {
    for (const key of identifiers) {
      this.invalidTimestampLogTracker.set(key, timestamp);
    }
  }

  normalizeIdentifier(value) {
    if (typeof value !== "string") {
      return "";
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : "";
  }

  buildRecord(req, options = {}) {
    const {
      errorCode,
      errorDetail,
      allowQueryParams = false,
      context,
    } = options;

    const reasonMeta =
      SECURITY_ERROR_REASON_MAP[errorCode] || SECURITY_ERROR_REASON_MAP.default;

    const detailParts = [
      errorDetail || reasonMeta.message,
      context,
      errorCode ? `code=${errorCode}` : null,
    ].filter(Boolean);
    const fullDetail = detailParts.join(" | ");

    const originalUrl = req.originalUrl || "";
    const [pathOnly, queryString] = originalUrl.split("?");
    const requestPath =
      pathOnly ||
      [req.baseUrl, req.path].filter(Boolean).join("") ||
      req.path ||
      req.url ||
      "/";

    const clientIp = this.getClientIp(req);
    const sanitizedHeaders = this.sanitizeHeaders(req.headers);
    const requestBody = this.extractRequestBody(req.body);

    const requestId = getRequestParam(req, "request-id", allowQueryParams);
    const fingerprint = getRequestParam(
      req,
      "device-fingerprint",
      allowQueryParams
    );
    const extensionVersion = getRequestParam(
      req,
      "extension-version",
      allowQueryParams
    );
    const windowLocationHref = getRequestParam(
      req,
      "window-location-href",
      allowQueryParams
    );
    const requestTimestamp = getRequestParam(
      req,
      "request-timestamp",
      allowQueryParams
    );

    return {
      reasonCode: reasonMeta.reasonCode,
      errorDetail: this.truncate(fullDetail, 2000),
      requestMethod: (req.method || "GET").substring(0, 10),
      requestPath: this.truncate(requestPath, 2000),
      queryString: queryString
        ? this.truncate(sanitizeQueryStringForLog(queryString), 2000)
        : null,
      clientIp: clientIp ? this.truncate(clientIp, 64) : null,
      headers: sanitizedHeaders,
      requestBody,
      fingerprint: fingerprint ? "[REDACTED]" : null,
      extensionVersion: extensionVersion
        ? this.truncate(extensionVersion, 32)
        : null,
      requestTimestamp: requestTimestamp
        ? Number(requestTimestamp) || null
        : null,
      requestId: requestId ? this.truncate(requestId, 128) : null,
      windowLocationHref: windowLocationHref ? "[REDACTED]" : null,
      userAgent: req.headers["user-agent"]
        ? this.truncate(req.headers["user-agent"], 1024)
        : null,
    };
  }

  sanitizeHeaders(headers = {}) {
    const sanitized = {};
    for (const [key, value] of Object.entries(headers || {})) {
      if (!key) continue;
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_HEADER_KEYS.has(lowerKey)) {
        sanitized[key] = "[REDACTED]";
        continue;
      }
      sanitized[key] = this.normalizeHeaderValue(value);
    }
    return Object.keys(sanitized).length > 0 ? sanitized : null;
  }

  normalizeHeaderValue(value) {
    if (Array.isArray(value)) {
      return value.slice(0, 5).map((item) => this.truncate(String(item), 512));
    }
    if (typeof value === "string") {
      return this.truncate(value, 512);
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (value === null || value === undefined) {
      return value;
    }
    try {
      return this.truncate(JSON.stringify(value), 512);
    } catch (error) {
      return "[unserializable]";
    }
  }

  extractRequestBody(body) {
    if (body === undefined || body === null) {
      return null;
    }
    if (typeof body === "string") {
      return this.truncate(body, 2000);
    }
    if (Buffer.isBuffer(body)) {
      return `[buffer length=${body.length}]`;
    }
    try {
      const serialized = JSON.stringify(body);
      return this.truncate(serialized, 2000);
    } catch (error) {
      return "[unserializable body]";
    }
  }

  getClientIp(req) {
    const headerIP = req.headers["x-forwarded-for"];
    if (typeof headerIP === "string" && headerIP.length > 0) {
      return headerIP.split(",")[0].trim();
    }
    return (
      req.headers["x-real-ip"] ||
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      req.ip ||
      null
    );
  }

  truncate(value, maxLength) {
    if (value === null || value === undefined) {
      return value;
    }
    const str = String(value);
    if (str.length <= maxLength) {
      return str;
    }
    return `${str.slice(0, maxLength - 15)}...[truncated]`;
  }
}

const securityViolationLogger = new SecurityViolationLogger();

/**
 * 处理 DAU 统计（异步写入 Redis 和 PostgreSQL）
 * @param {express.Request} req - Express 请求对象
 * @param {string} fingerprint - 设备指纹
 * @param {string} xUserId - 用户ID
 */
const handleDAUTracking = (req) => {
  const identity = req.securityContext?.effectiveIdentity;
  if (!identity?.key) {
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
  const userMeta = getDauUserMeta(req, identity);

  if (!dauCacheManager.shouldWriteToRedis(identity.key)) {
    if (userMeta?.userId) {
      setImmediate(async () => {
        try {
          await writeDauUserMeta(req.redisClient, today, identity.key, userMeta);
        } catch (error) {
          console.error("DAU user meta tracking error:", error);
        }
      });
    }
    return; // 缓存期内，跳过 DAU 去重写入，但允许补充用户名元信息
  }

  // 异步写入 Redis 和 PostgreSQL（非阻塞）
  setImmediate(async () => {
    try {
      // 写入 Redis
      const dauKey = `dau:${today}`;
      const uniqueIdentifier = identity.key;
      await req.redisClient.sAdd(dauKey, uniqueIdentifier);
      // 设置过期时间（保留8天，确保7天数据完整）
      await req.redisClient.expire(dauKey, 8 * 24 * 60 * 60);
      await writeDauUserMeta(req.redisClient, today, uniqueIdentifier, userMeta);

      // 写入 PostgreSQL（延迟加载模型避免循环依赖）
      if (!DailyActiveUser) {
        const postgresModels = require("../../models/postgres-start");
        DailyActiveUser = postgresModels.DailyActiveUser;
      }

      const dailyUserId = identity.key;
      const [record, created] = await DailyActiveUser.findOrCreate({
        where: {
          userId: dailyUserId,
          date: today,
        },
        defaults: {
          userId: dailyUserId,
          date: today,
        },
      });

      // 记录数据库写入日志
      if (created) {
        console.log(`📊 DAU数据库记录已创建: userId=${dailyUserId}, date=${today}`);
      }
    } catch (error) {
      // 错误不影响主流程，只记录日志
      console.error("DAU tracking error:", error);
      // 失败时从缓存中移除，允许下次重试
      dauCacheManager.removeFromCache(identity.key);
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
  const signatureVersion = normalizeOptionalSignedValue(
    getRequestParam(req, "signature-version", allowQueryParams)
  );

  // 插件 background-script 没有真实页面 URL，约定传固定值 background-script。
  // 保留 0.0.0 / 9.09.09 的历史特例；v2 background-script 也视为合法插件运行环境。
  // 注意：这里只放行 browserOnlyMiddleware，后续仍会经过 securityMiddleware 签名校验。
  const isLegacySpecialBackgroundScript =
    windowLocationHref === "background-script" &&
    (version === "0.0.0" || version === "9.09.09");
  const isV2BackgroundScript =
    windowLocationHref === "background-script" &&
    signatureVersion === V2_SIGNATURE_VERSION;

  if (isLegacySpecialBackgroundScript || isV2BackgroundScript) {
    return true;
  }

  if (signatureVersion === V2_SIGNATURE_VERSION) {
    // 新版插件不再发送 x-window-location-href；v2 请求先用 UA 做轻量浏览器校验，
    // 真正的安全性由后续 securityMiddleware 的签名校验保证。
    return isBrowserEnvironment(userAgent, windowLocationHref || "https://x.com");
  }

  if (!isBrowserEnvironment(userAgent, windowLocationHref)) {
    return false;
  }

  return true;
};

/**
 * 验证安全参数（核心逻辑）
 * @param {express.Request} req - Express 请求对象
 * @param {boolean} allowQueryParams - 是否允许从查询参数读取
 * @returns {{isValid: boolean, error?: string, securityContext?: object}} 验证结果
 */
const validateLegacySecurityParams = (req, allowQueryParams = false) => {
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
  const twId = normalizeOptionalSignedValue(
    getRequestParam(req, "tw-id", allowQueryParams)
  );

  // 验证请求头是否存在
  if (!requestId || !timestamp || !fingerprint || !signature || !version) {
    console.error("validateSecurityParams error:", {
      requestId,
      timestamp,
      hasFingerprint: Boolean(fingerprint),
      signaturePrefix: signature ? `${String(signature).slice(0, 8)}...${String(signature).slice(-8)}` : null,
      version,
    });
    return { isValid: false, error: "400" };
  }

  // 验证指纹格式
  if (!isValidFingerprint(fingerprint)) {
    console.error("validateSecurityParams fingerprint error:", {
      hasFingerprint: true,
    });
    return { isValid: false, error: "400-1" };
  }

  // 验证请求ID格式
  if (!isValidRequestId(requestId)) {
    console.error("validateSecurityParams requestId error:", {
      requestId,
    });
    return { isValid: false, error: "400-2" };
  }

  // 验证时间戳
  if (!isTimestampValid(timestamp)) {
    console.error("validateSecurityParams timestamp error:", {
      timestamp,
    });
    return { isValid: false, error: "400-3" };
  }

  // 检查是否需要跳过签名验证
  const windowLocationHref = getRequestParam(
    req,
    "window-location-href",
    allowQueryParams
  );
  // const currentPath = req.baseUrl + req.path;
  if (allowQueryParams || windowLocationHref === "background-script") {
    // backgroun请求 和 SSE 请求：使用 FNV-1a 哈希算法
    const path = req.baseUrl + req.path;

    const expectedSignature = generateSSESignature(
      requestId,
      timestamp.toString(),
      fingerprint,
      req.method.toUpperCase(),
      path,
      twId
    );

    if (signature !== expectedSignature) {
      console.error("sse validateSecurityParams signature error:", {
        signaturePrefix: signature ? `${String(signature).slice(0, 8)}...${String(signature).slice(-8)}` : null,
        expectedPrefix: `${expectedSignature.slice(0, 8)}...${expectedSignature.slice(-8)}`,
      });
      return { isValid: false, error: "411" };
    }
  } else {
    // 网页的普通请求：使用 HMAC SHA256 算法
    const path = req.baseUrl + req.path;
    const body = req.body;
    const expectedSignature = generateSignature(
      req.method,
      path,
      timestamp,
      body,
      fingerprint,
      twId
    );
    if (signature !== expectedSignature) {
      console.error("web validateSecurityParams signature error:", {
        signaturePrefix: signature ? `${String(signature).slice(0, 8)}...${String(signature).slice(-8)}` : null,
        expectedPrefix: `${expectedSignature.slice(0, 8)}...${expectedSignature.slice(-8)}`,
      });
      return { isValid: false, error: "411" };
    }
  }

  // 从 requestId 中解析 twid（例如: <uuid>-twid1570682472358346752），若存在则挂载到 req 上
  try {
    if (typeof requestId === "string") {
      const match = requestId.match(/-twid(\d{5,})$/);
      if (match) {
        req.twid = match[1];
      }
    }
  } catch (e) {
    // 忽略解析异常，不影响后续流程
  }

  return {
    isValid: true,
    securityContext: attachIdentityToSecurityContext(req, {
      requestId,
      timestamp,
      fingerprint,
      version,
      signature,
      twId: twId || null,
    }, { allowQueryParams }),
  };
};

const validateV2SecurityParams = (req, { allowQueryParams = false } = {}) => {
  const signingKey = process.env.XHUNT_V2_SIGNING_KEY;
  if (!signingKey) {
    console.error("validateV2SecurityParams signing key missing");
    return { isValid: false, error: "SIGNING_KEY_NOT_CONFIGURED" };
  }

  const signatureVersion = normalizeOptionalSignedValue(
    getRequestParam(req, "signature-version", allowQueryParams)
  );
  const requestId = normalizeOptionalSignedValue(
    getRequestParam(req, "request-id", allowQueryParams)
  );
  const timestampRaw = normalizeOptionalSignedValue(
    getRequestParam(req, "request-timestamp", allowQueryParams)
  );
  const timestamp = Number(timestampRaw);
  const fingerprint = normalizeOptionalSignedValue(
    getRequestParam(req, "device-fingerprint", allowQueryParams)
  );
  const signature = normalizeOptionalSignedValue(
    getRequestParam(req, "request-signature", allowQueryParams)
  );
  const version = normalizeOptionalSignedValue(
    getRequestParam(req, "extension-version", allowQueryParams)
  );
  const userId = normalizeOptionalSignedValue(
    getRequestParam(req, "user-id", allowQueryParams)
  );
  const language = normalizeOptionalSignedValue(
    getRequestParam(req, "language", allowQueryParams)
  );
  const twId = normalizeOptionalSignedValue(
    getRequestParam(req, "tw-id", allowQueryParams)
  );

  if (
    signatureVersion !== V2_SIGNATURE_VERSION ||
    !requestId ||
    !timestampRaw ||
    !signature ||
    !version ||
    !userId ||
    !language
  ) {
    return { isValid: false, error: "MISSING_SIGNATURE_HEADERS" };
  }

  if (!twId) {
    return { isValid: false, error: "MISSING_TWITTER_ID" };
  }

  if (!isValidTwitterId(twId)) {
    console.error("validateV2SecurityParams twId error:", { twId });
    return { isValid: false, error: "INVALID_TWITTER_ID" };
  }

  if (fingerprint && !isValidFingerprint(fingerprint)) {
    console.error("validateV2SecurityParams fingerprint error:", {
      hasFingerprint: true,
    });
    return { isValid: false, error: "400-1" };
  }

  if (!isValidRequestId(requestId)) {
    console.error("validateV2SecurityParams requestId error:", { requestId });
    return { isValid: false, error: "INVALID_REQUEST_ID" };
  }

  if (!isV2TimestampValid(timestamp)) {
    console.error("validateV2SecurityParams timestamp error:", {
      timestampRaw,
      timestamp,
      diffMs: Number.isFinite(timestamp) ? Date.now() - timestamp : null,
    });
    return { isValid: false, error: "SIGNATURE_EXPIRED" };
  }

  let pathWithQuery;
  try {
    pathWithQuery = buildV2PathWithQuery(req, {
      isSSE: allowQueryParams,
      language,
    });
  } catch (error) {
    console.error("validateV2SecurityParams query normalize error:", error);
    return { isValid: false, error: "INVALID_SIGNATURE" };
  }

  const bodyText = req.rawBody || "";
  const bodyHash = hashBodySha512(bodyText);
  const commonPayloadParts = [
    req.method.toUpperCase(),
    pathWithQuery,
    timestampRaw,
    requestId,
  ];
  const signatureCandidates = [];
  if (fingerprint) {
    signatureCandidates.push({
      payloadVersion: "v2-7line-fingerprint",
      canonicalPayload: [
        ...commonPayloadParts,
        fingerprint,
        bodyHash,
        twId,
      ].join("\n"),
    });
  }
  signatureCandidates.push({
    payloadVersion: "v2-6line-no-fingerprint",
    canonicalPayload: [
      ...commonPayloadParts,
      bodyHash,
      twId,
    ].join("\n"),
  });

  const matchedSignature = signatureCandidates
    .map((candidate) => ({
      ...candidate,
      expectedSignature: generateV2Signature(candidate.canonicalPayload, signingKey),
    }))
    .find((candidate) => safeCompareHex(signature, candidate.expectedSignature));

  if (!matchedSignature) {
    console.error("validateV2SecurityParams signature error:", {
      pathWithQuery,
      requestId,
      twId,
      timestamp,
      hasFingerprint: Boolean(fingerprint),
      triedPayloadVersions: signatureCandidates.map((item) => item.payloadVersion),
      signaturePrefix: signature ? `${signature.slice(0, 8)}...${signature.slice(-8)}` : null,
    });
    return { isValid: false, error: "INVALID_SIGNATURE" };
  }

  return {
    isValid: true,
    securityContext: attachIdentityToSecurityContext(
      req,
      {
        signatureVersion: V2_SIGNATURE_VERSION,
        signaturePayloadVersion: matchedSignature.payloadVersion,
        requestId,
        timestamp,
        fingerprint: fingerprint || null,
        rawFingerprint: fingerprint || null,
        version,
        signature,
        twId,
        userId,
        language,
        pathWithQuery,
      },
      { allowQueryParams }
    ),
  };
};

const validateSecurityParams = (req, allowQueryParams = false) => {
  const signatureVersion = normalizeOptionalSignedValue(
    getRequestParam(req, "signature-version", allowQueryParams)
  );

  if (signatureVersion === V2_SIGNATURE_VERSION) {
    return validateV2SecurityParams(req, { allowQueryParams });
  }

  if (process.env.XHUNT_LEGACY_SIGNATURE_ENABLED === "false") {
    return { isValid: false, error: "MISSING_SIGNATURE_HEADERS" };
  }

  return validateLegacySecurityParams(req, allowQueryParams);
};

const getSecurityErrorHttpStatus = (error) => {
  if (error === "INVALID_SIGNATURE" || error === "411") return 411;
  if (error === "REPLAY_REQUEST" || error === "409") return 409;
  if (error === "SIGNING_KEY_NOT_CONFIGURED") return 500;
  return 400;
};

// 浏览器环境检测中间件
const browserOnlyMiddleware = (req, res, next) => {
  try {
    if (req[BROWSER_ONLY_MIDDLEWARE_FLAG]) {
      return next();
    }
    req[BROWSER_ONLY_MIDDLEWARE_FLAG] = true;
    if (!validateBrowserEnvironment(req, false)) {
      const userAgent = req.headers["user-agent"];
      const windowLocationHref = getRequestParam(
        req,
        "window-location-href",
        false
      );
      const version = getRequestParam(req, "extension-version", false);
      const signatureVersion = getRequestParam(req, "signature-version", false);
      console.error("browserOnlyMiddleware validateBrowserEnvironment error:", {
        userAgent,
        hasWindowLocationHref: Boolean(windowLocationHref),
        version,
        signatureVersion,
      });
      return res.status(403).json({ error: "403" });
    }
    next();
  } catch (error) {
    console.error("Browser detection middleware error:", error);
    res.status(500).json({ error: "browserOnlyMiddleware 500" });
  }
};

// 安全中间件
const securityMiddleware = async (req, res, next) => {
  if (req[SECURITY_MIDDLEWARE_FLAG]) {
    return next();
  }
  req[SECURITY_MIDDLEWARE_FLAG] = true;
  // 确保缓存管理器已初始化
  dauCacheManager.init();

  try {
    // 使用统一的安全验证逻辑
    const validation = validateSecurityParams(req, false);

    if (!validation.isValid) {
      if (!shouldSkipSecurityViolationLog(req)) {
        securityViolationLogger.logViolation(req, {
          errorCode: validation.error,
          allowQueryParams: false,
          context: "standard request",
        });
      }
      console.error("securityMiddleware validateSecurityParams error:", {
        validation,
      });
      return res
        .status(getSecurityErrorHttpStatus(validation.error))
        .json({ error: validation.error });
    }

    const requestIdReservation = await reserveRequestId(
      req,
      validation.securityContext,
      { isSSE: false }
    );
    if (!requestIdReservation.allowed) {
      if (!shouldSkipSecurityViolationLog(req)) {
        securityViolationLogger.logViolation(req, {
          errorCode: "409",
          allowQueryParams: false,
          context: "standard request",
        });
      }
      console.error("securityMiddleware requestIdReservation error:", {
        requestIdReservation,
      });
      const replayError =
        validation.securityContext?.signatureVersion === V2_SIGNATURE_VERSION
          ? "REPLAY_REQUEST"
          : "409";
      return res.status(409).json({ error: replayError });
    }

    // 将验证后的信息添加到请求对象中
    req.securityContext = validation.securityContext;
    // 兼容历史业务代码：reviews/notes 等模块仍读取 req.twid。
    // v2 签名链路的 Twitter ID 存在 securityContext.twId/twitterId 中，需要同步挂载。
    req.twid =
      validation.securityContext?.twId ||
      validation.securityContext?.twitterId ||
      req.twid;

    // 🔥 智能日活统计 - 使用统一的 DAU 处理函数
    const windowLocationHref = getRequestParam(
      req,
      "window-location-href",
      false
    );
    if (windowLocationHref !== "background-script") {
      handleDAUTracking(req);
    }

    // 🔥 请求统计（版本 + URL）- 异步处理，不阻塞请求
    requestStatsManager.init();
    setImmediate(() => {
      requestStatsManager.handleRequestStats(req).catch((error) => {
        console.error("[请求统计] 处理失败:", error);
      });
    });

    next();
  } catch (error) {
    console.error("Security middleware error:", error);
    res.status(500).json({ error: "securityMiddleware 500" });
  }
};

// SSE 专用的安全中间件（从查询参数读取，因为 EventSource 不支持自定义 headers）
const sseSecurityMiddleware = async (req, res, next) => {
  if (req[SSE_SECURITY_MIDDLEWARE_FLAG]) {
    return next();
  }
  req[SSE_SECURITY_MIDDLEWARE_FLAG] = true;
  // 确保缓存管理器已初始化
  dauCacheManager.init();

  try {
    // 使用统一的安全验证逻辑（允许从查询参数读取）
    const validation = validateSecurityParams(req, true);

    if (!validation.isValid) {
      if (!shouldSkipSecurityViolationLog(req)) {
        securityViolationLogger.logViolation(req, {
          errorCode: validation.error,
          allowQueryParams: true,
          context: "sse request",
        });
      }
      console.error("sseSecurityMiddleware validateSecurityParams error:", {
        validation,
      });
      return res
        .status(getSecurityErrorHttpStatus(validation.error))
        .json({ error: validation.error });
    }

    const requestIdReservation = await reserveRequestId(
      req,
      validation.securityContext,
      { isSSE: true }
    );
    if (!requestIdReservation.allowed) {
      if (!shouldSkipSecurityViolationLog(req)) {
        securityViolationLogger.logViolation(req, {
          errorCode: "409",
          allowQueryParams: true,
          context: "sse request",
        });
      }
      console.error("sseSecurityMiddleware requestIdReservation error:", {
        requestIdReservation,
      });
      const replayError =
        validation.securityContext?.signatureVersion === V2_SIGNATURE_VERSION
          ? "REPLAY_REQUEST"
          : "409";
      return res.status(409).json({ error: replayError });
    }

    // 将验证后的信息添加到请求对象中，供 SSE auth 和后续业务使用。
    req.securityContext = validation.securityContext;
    req.twid =
      validation.securityContext?.twId ||
      validation.securityContext?.twitterId ||
      req.twid;

    // 🔥 请求统计（版本 + URL）- 异步处理，不阻塞请求
    requestStatsManager.init();
    setImmediate(() => {
      requestStatsManager.handleRequestStats(req).catch((error) => {
        console.error("[请求统计] 处理失败:", error);
      });
    });

    next();
  } catch (error) {
    console.error("SSE Security middleware error:", error);
    res.status(500).json({ error: "sseSecurityMiddleware 500" });
  }
};

// 通用：基于真实客户端 IP 的封禁中间件（可用于指定路由）
// 优先：CF-Connecting-IP，其次：X-Forwarded-For 第一个，再兜底 req.ip
const createIpBlocker = (blockedIps = [], options = {}) => {
  const blockedSet = new Set(blockedIps);
  // 默认使用自定义状态码，便于在日志/监控中“一眼识别”该类请求被策略拦截
  // 说明：4xx 里 451 语义接近（法律原因不可用），这里用 418 作为“策略拦截”专用码（不会与常见业务码冲突）
  const statusCode = options.statusCode || 418;

  return (req, res, next) => {
    const cfIp = req.headers["cf-connecting-ip"];
    const xff = String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      ?.trim();
    const clientIp = cfIp || xff || req.ip;

    if (clientIp && blockedSet.has(clientIp)) {
      return res.status(statusCode).json({
        success: false,
        error: "ACCESS_RESTRICTED",
        message:
          "This request is temporarily unavailable. Please try again later.",
      });
    }
    next();
  };
};

module.exports = {
  rateLimiter,
  fingerprintLimiter,
  securityMiddleware,
  sseSecurityMiddleware,
  browserOnlyMiddleware,
  createIpBlocker,
  generateSignature, // 导出用于测试（HMAC SHA256，普通 API）
  generateSSESignature, // 导出用于测试（FNV-1a，SSE）
  dauCacheManager, // 导出缓存管理器（用于测试和监控）
  requestStatsManager, // 导出请求统计管理器（用于测试和监控）
  versionStatsManager, // 保持向后兼容的别名
};
