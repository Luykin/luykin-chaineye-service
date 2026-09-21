const helmet = require("helmet");

/**
 * 配置 Helmet 内容安全策略 (CSP)
 */
const helmetCspMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "https://static.cloudflareinsights.com"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": [
        "'self'",
        "data:",
        "blob:",
        "https://oaewcvliegq6wyvp.public.blob.vercel-storage.com",
        "https://*.vercel-storage.com",
        "https://*.blob.vercel-storage.com",
        "https://*.public.blob.vercel-storage.com",
        "https://x.com",
        "https://*.x.com",
        "https://pbs.twimg.com",
        "https://*.twimg.com",
      ],
      "connect-src": [
        "'self'",
        "ws:",
        "wss:",
        "https://kb.cryptohunt.ai",
        "https://kb.xhunt.ai",
        "https://app.echohunt.ai",
        "https://vercel.com",
        "https://*.vercel-storage.com",
        "https://*.blob.vercel-storage.com",
        "https://cloudflareinsights.com",
      ],
    },
  },
});

/**
 * 应用常规 HTTP 头防护
 */
function setupAdditionalSecurityHeaders(app) {
  app.use(helmet.hidePoweredBy());
  app.use(helmet.xssFilter());
  app.use(helmet.noSniff());
}

module.exports = {
  helmetCspMiddleware,
  setupAdditionalSecurityHeaders,
};
