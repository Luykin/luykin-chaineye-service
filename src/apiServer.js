// This line must come before importing any instrumented module.
const tracer = require("dd-trace").init({
  logInjection: true,
});

require("dotenv").config({
  path: `${process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro"}`,
});
console.log(process.env.NODE_ENV, "process.env.NODE_ENV运行环境");
const express = require("express");
const helmet = require("helmet");
const path = require("path");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const redis = require("redis");
const { setupSqlite } = require("./models/sqlite-start");
const { setupPostgres } = require("./models/postgres-start");
const { setupPostgresFundraising } = require("./models/postgres-fundraising");
const fundraisingRoutes = require("./routes/fundraising");
const cryptoRoutes = require("./routes/cryptohunt-tg");
const proxyRoutes = require("./routes/proxy");
const newsRoutes = require("./routes/ex-news");
const xHuntAuthRoutes = require("./xhunt/api/auth");
const xHuntProxyRoutes = require("./xhunt/api/proxy");
const xHuntReviewsRoutes = require("./xhunt/api/reviews");
const xHuntNotesRoutes = require("./xhunt/api/notes");
const xHuntReportRoutes = require("./xhunt/api/report");
const xHuntStatsRoutes = require("./xhunt/api/stats");
const xHuntMantleRoutes = require("./xhunt/api/mantle");
const xHuntCampaignRoutes = require("./xhunt/api/campaign");
const xHuntPrivateMessageRoutes = require("./xhunt/api/private-messages");
const xHuntRootdataRoutes = require("./xhunt/api/rootdata");
const adminRoutes = require("./admin/api/admin");
const xHuntSSERoutes = require("./xhunt/api/sse");
const xHuntUserEntryRoutes = require("./xhunt/api/user-entry");
const internalQueryRoutes = require("./api/internal-query");
const {
  securityMiddleware,
  fingerprintLimiter,
  rateLimiter,
  browserOnlyMiddleware,
  sseSecurityMiddleware,
} = require("./xhunt/middleware/security");
const StatsD = require("hot-shots");
const dataDog = new StatsD();

const app = express();
const PORT = process.env.PORT || 8090;

// 初始化 Redis 客户端
const redisClient = redis.createClient({
  socket: {
    host: "127.0.0.1", // Redis 地址
    port: 6379, // Redis 端口
  },
  // password: process.env.REDIS_PASSWORD // 如果有密码
});

// 连接 Redis
(async () => {
  try {
    await redisClient.connect();
    console.log("Redis 连接成功");
  } catch (error) {
    console.error("Redis 连接失败:", error);
  }
})();

app.use((req, res, next) => {
  req.redisClient = redisClient;
  req.dataDog = dataDog;
  next();
});

//将指定请求头注入到 Datadog APM Span 中
function injectHeadersToSpan(req, res, next) {
  const span = tracer.scope().active();
  if (span) {
    // 要记录的请求头列表（全部使用小写形式匹配 req.headers）
    const headersToCapture = [
      "x-request-id",
      "x-request-timestamp",
      "x-device-fingerprint",
      "x-request-signature",
      "x-extension-version",
      "x-user-id",
      "x-window-location-href",
    ];

    // 遍历并写入 Span Tags
    headersToCapture.forEach((header) => {
      const value = req.headers[header];
      // value['my-env'] = process.env.ENV;
      if (value) {
        // 建议命名格式：http.request_header.<header_name>
        span.setTag(`http.request_header.${header}`, String(value));
      }
    });
  }
  next();
}

// 使用中间件
app.use(injectHeadersToSpan);

// CORS 配置
const corsOptions = {
  origin: (origin, callback) => {
    // 白名单列表
    const allowedOrigins = [
      "https://chaineye.tools",
      "https://minibridge.chaineye.tools",
      "https://www.cryptohunt.ai",
      "https://cryptohunt.ai",
      "https://dev.cryptohunt.ai",
      "http://cryptohunt.ai",
      "http://www.cryptohunt.ai",
      "http://dev.cryptohunt.ai",
      "http://chaineye.tools",
      "http://minibridge.chaineye.tools",
      "http://localhost",
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://127.0.0.1:3000",
      "https://x.com",
      "https://kb.cryptohunt.ai",
      "http://kb.cryptohunt.ai",
      "https://kb.xhunt.ai",
      "http://kb.xhunt.ai",
      "https://xhunt.ai",
      "http://xhunt.ai",
    ];

    // 允许 chrome-extension:// 来源（任何插件）
    if (origin && origin.startsWith("chrome-extension://")) {
      return callback(null, true);
    }

    // 白名单中的域名也放行
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // 否则拒绝
    callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Request-Timestamp",
    "x-request-id",
    "x-request-timestamp",
    "x-device-fingerprint",
    "x-request-signature",
    "x-extension-version",
    "x-user-id",
    "x-window-location-href",
  ],
  credentials: true,
};

app.set("trust proxy", 1); // 仅信任最靠近 Express 的一层代理
app.use(cors(corsOptions));
// 安全和速率限制
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
      },
    },
  })
);
// 全局速率限制
app.use(rateLimiter);
// 条件性压缩：排除流式路由和 SSE 路由
app.use((req, res, next) => {
  if (
    req.path.includes("/api/xhunt/proxy/public-stream/") ||
    req.path.includes("/api/xhunt/sse")
  ) {
    // 流式路由和 SSE 路由跳过压缩中间件
    return next();
  }
  // 非流式路由应用压缩
  compression()(req, res, next);
});
// 自定义 morgan 日志格式
morgan.token("custom-info", function (req, res) {
  const userAgent = req.get("User-Agent") || "";
  const isChromeExtension = userAgent.includes("chrome-extension://");

  // 获取需要的用户相关信息
  const userId = req.headers["x-user-id"] || "anonymous";
  const fingerprint = req.headers["x-device-fingerprint"] || "no-fingerprint";
  const version = req.headers["x-extension-version"] || "no-version";
  const windowLocationHref =
    req.headers["x-window-location-href"] || "no-location";
  const requestId = req.headers["x-request-id"] || "no-request-id";

  // 获取IP信息
  const realIp = req.headers["x-real-ip"] || "no-real-ip";
  const forwardedFor = req.headers["x-forwarded-for"] || "no-forwarded-for";

  return `pm2_app=luykin-chaineye-api custom_info=xhunt-service request_id=${requestId} user_id=${userId} fingerprint=${fingerprint} version=${version} location=${windowLocationHref} real_ip=${realIp} forwarded_for=${forwardedFor} is_extension=${isChromeExtension}`;
});

// 打印入口日志（请求刚到达时）
app.use(
  morgan(
    'in request_id=:req[x-request-id] method=:method url=:url ua=":user-agent"',
    { immediate: true }
  )
);

// 打印出口日志（响应返回时），包含状态与耗时；如有错误状态，额外标注
app.use(
  morgan(
    'out request_id=:req[x-request-id] status=:status method=:method url=:url origin=":req[origin]" allow_origin=":res[Access-Control-Allow-Origin]" cost_ms=:response-time[3] len=:res[content-length] ref=":referrer" ua=":user-agent"'
  )
);
app.use(helmet.hidePoweredBy());
app.use(helmet.xssFilter());
app.use(helmet.noSniff());

// 🆕 针对不同路由设置不同的请求体大小限制
// 普通接口：20KB 限制
app.use(express.json({ limit: "20kb" }));

// 🆕 为上报接口设置更大的限制（但仍然合理）
app.use(
  "/api/xhunt/report",
  express.json({
    limit: "100kb", // 上报接口允许更大的请求体
  })
);

// 🆕 添加静态文件服务支持
app.use("/static", express.static(path.join(__dirname, "../public/static")));

// API 路由
app.use("/api/fundraising", fundraisingRoutes);
app.use("/api/crypto", cryptoRoutes);
app.use("/api/proxy", proxyRoutes);
app.use("/api/news", newsRoutes);

app.use(
  "/api/xhunt/auth",
  fingerprintLimiter,
  browserOnlyMiddleware,
  securityMiddleware,
  xHuntAuthRoutes
);

app.use(
  "/api/xhunt/proxy",
  fingerprintLimiter,
  browserOnlyMiddleware,
  securityMiddleware,
  xHuntProxyRoutes
);

app.use(
  "/api/xhunt/reviews",
  fingerprintLimiter,
  browserOnlyMiddleware,
  securityMiddleware,
  xHuntReviewsRoutes
);

app.use(
  "/api/xhunt/notes",
  fingerprintLimiter,
  browserOnlyMiddleware,
  securityMiddleware,
  xHuntNotesRoutes
);

app.use(
  "/api/xhunt/report",
  fingerprintLimiter,
  browserOnlyMiddleware,
  xHuntReportRoutes
);

// 私信接口
app.use(
  "/api/xhunt/private-messages",
  fingerprintLimiter,
  browserOnlyMiddleware,
  xHuntPrivateMessageRoutes
);

// Mantle 活动接口 内部有安全中间件
app.use("/api/xhunt/mantle", xHuntMantleRoutes);
// 通用活动报名接口
app.use("/api/xhunt/campaigns", xHuntCampaignRoutes);

// 未注册用户登记接口
app.use("/api/xhunt/user-entry", xHuntUserEntryRoutes);

// SSE 接口 - 实时推送数据（包含 feeds 等）有安全中间件
app.use("/api/xhunt/sse", rateLimiter, sseSecurityMiddleware, xHuntSSERoutes);

// 新增统计路由 - 无需安全中间件，方便内部监控。管理后台使用，有basicAuth前端认证机制
app.use("/api/xhunt/stats", xHuntStatsRoutes);

// Rootdata 搜索接口 - 基于 PostgreSQL 的 Fundraising 数据 内部使用
app.use("/api/rootdata", xHuntRootdataRoutes);

// 管理后台（登录、会话、管理员基础配置）
app.use("/admin", adminRoutes);

// 内部查询API - 使用随机字符前缀，无需安全中间件
const INTERNAL_QUERY_EXPIRATION = new Date("2025-12-20T00:00:00Z");
app.use("/api/internal-x9k2m7p4q8", (req, res, next) => {
  if (new Date() >= INTERNAL_QUERY_EXPIRATION) {
    return res.status(403).json({
      success: false,
      error: "FORBIDDEN",
      message: "请联系管理员开通权限",
    });
  }
  next();
}, internalQueryRoutes);

// 404 Catch-all: 所有未匹配到的路由
app.use((req, res) => {
  res.set('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma','no-cache');
  res.set('Expires','0');
  res.status(404).type('html').send(`<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>404 · XHunt Node</title>
      <style>
        body{margin:0;background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial}
        .wrap{max-width:720px;margin:10vh auto;padding:24px}
        .card{background:#0b1220;border:1px solid #1f2a44;border-radius:12px;padding:24px;box-shadow:0 6px 24px rgba(0,0,0,.3)}
        h1{margin:0 0 8px;font-size:22px}
        .sub{color:#94a3b8;font-size:13px;margin-bottom:16px}
        .kv{display:grid;grid-template-columns:120px 1fr;gap:8px;font-size:13px}
        .k{color:#94a3b8}
        .v{color:#e5e7eb;word-break:break-all}
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card">
          <h1>未找到页面</h1>
          <div class="kv">
            <div class="k">Method</div><div class="v">${req.method}</div>
            <div class="k">URL</div><div class="v">${req.originalUrl || req.url}</div>
            <div class="k">Host</div><div class="v">${req.headers.host || ''}</div>
            <div class="k">CF-Cache-Status</div><div class="v">${req.headers['cf-cache-status'] || '-'}</div>
            <div class="k">X-Forwarded-For</div><div class="v">${req.headers['x-forwarded-for'] || '-'}</div>
            <div class="k">User-Agent</div><div class="v">${req.headers['user-agent'] || ''}</div>
          </div>
        </div>
      </div>
    </body>
  </html>`);
});

// 🆕 专门处理请求体过大的错误
app.use((error, req, res, next) => {
  if (error.type === "entity.too.large") {
    return res.status(413).json({
      error: "请求数据过大，请减少上报数据量",
      code: "PAYLOAD_TOO_LARGE",
      maxSize: "300KB",
    });
  }
  next(error);
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error("❌ 服务器错误:", err.message);
  console.error("❌ 错误堆栈:", err.stack);

  // 如果是CORS错误，返回更友好的错误信息
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      error: "CORS错误：请求被阻止",
      message: "请检查域名是否在白名单中",
      origin: req.headers.origin,
    });
  }

  res.status(500).json({
    error: "服务器内部错误！",
    message: err.message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

// 启动 API 服务
async function startAPIServer() {
  await setupSqlite();
  await setupPostgres();
  await setupPostgresFundraising();
  // 超级管理员初始化不在业务进程中进行，改为独立脚本执行
  // 不在 API 进程中启动备份服务，避免多实例重复备份
  
  app.listen(PORT, () => console.log(`API 服务器运行在端口 ${PORT}`));
}

startAPIServer().then((r) => r);
