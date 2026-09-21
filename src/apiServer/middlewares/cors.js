const cors = require("cors");

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
  "http://localhost:5173",
  "http://localhost:8000",
  "http://localhost:3000",
  "http://127.0.0.1",
  "http://127.0.0.1:3000",
  "https://x.com",
  "https://kb.cryptohunt.ai",
  "http://kb.cryptohunt.ai",
  "https://dev.kb.cryptohunt.ai",
  "http://dev.kb.cryptohunt.ai",
  "https://kb.xhunt.ai",
  "http://kb.xhunt.ai",
  "https://xhunt.ai",
  "http://xhunt.ai",
  "https://app.echohunt.ai",
  "http://localhost:3002",
];

const corsOptions = {
  origin: (origin, callback) => {
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
    "x-signature-version",
    "x-extension-version",
    "x-user-id",
    "x-tw-id",
    "x-language",
    "x-window-location-href",
    "x-xhunt-web-sign-version",
    "x-xhunt-web-client-key",
    "x-xhunt-web-request-id",
    "x-xhunt-web-timestamp",
    "x-xhunt-web-body-sha256",
    "x-xhunt-web-signature",
    "x-xhunt-web-sdk-version",
    "x-xhunt-web-page-url",
    "x-xhunt-web-origin",
    "x-collector-client-token",
    "x-admin",
    "admin",
    "Admin",
  ],
  credentials: true,
};

const corsMiddleware = cors(corsOptions);

module.exports = {
  allowedOrigins,
  corsOptions,
  corsMiddleware,
};
