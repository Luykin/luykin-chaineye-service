const morgan = require("morgan");

function sanitizeUrlForLog(url = "") {
  if (!url || typeof url !== "string") {
    return url || "";
  }
  try {
    const queryStart = url.indexOf("?");
    const pathOnly = queryStart >= 0 ? url.slice(0, queryStart) : url;
    const queryString = queryStart >= 0 ? url.slice(queryStart + 1) : "";
    if (!queryString) return url;
    const params = new URLSearchParams(queryString);
    for (const key of Array.from(params.keys())) {
      const normalizedKey = String(key).toLowerCase();
      if (
        normalizedKey === "token" ||
        normalizedKey === "x-request-signature" ||
        normalizedKey === "x_request_signature"
      ) {
        params.set(key, "[REDACTED]");
      }
    }
    const sanitized = params.toString();
    return sanitized ? `${pathOnly}?${sanitized}` : pathOnly;
  } catch (_) {
    return url
      .replace(/((?:^|[?&])token=)[^&]*/gi, "$1[REDACTED]")
      .replace(/((?:^|[?&])x[-_]request[-_]signature=)[^&]*/gi, "$1[REDACTED]");
  }
}

// 注册常用 morgan tokens
morgan.token("xhunt-identity", (req) => {
  const requestId = req.headers["x-request-id"] || "no-request-id";
  const userId = req.headers["x-user-id"] || "anonymous";
  const twId = req.headers["x-tw-id"] || "no-tw-id";
  const version = req.headers["x-extension-version"] || "no-version";
  return `request_id=${requestId} user_id=${userId} tw_id=${twId} version=${version}`;
});

morgan.token("xhunt-web", (req) => {
  const web = req.xhuntWeb;
  const clientKey = web?.clientKey || req.headers["x-xhunt-web-client-key"] || "-";
  const requestId = web?.requestId || req.headers["x-xhunt-web-request-id"] || "-";
  const signResult = web?.signResult || (req.headers["x-xhunt-web-signature"] ? "pending" : "-");
  const reason = web?.signFailReason ? ` reason=${web.signFailReason}` : "";
  const authCenterUserId = web?.authCenterUserId ? ` acu=${web.authCenterUserId}` : "";
  const xhuntUserId = web?.xhuntUserId ? ` xu=${web.xhuntUserId}` : "";
  return `web_client=${clientKey} web_rid=${requestId} web_sign=${signResult}${reason}${authCenterUserId}${xhuntUserId}`;
});

// 错误信息 token（仅在错误处理中设置，默认 "-"）
morgan.token("error-info", (req, res) => res.locals.errorMessage || "-");
morgan.token("safe-url", (req) => sanitizeUrlForLog(req.originalUrl || req.url || ""));

/**
 * 挂载请求访问日志中间件（入口与出口）
 */
function setupLoggingMiddlewares(app) {
  // 打印入口日志（请求刚到达时）
  app.use(
    morgan('in :xhunt-identity :xhunt-web method=:method url=:safe-url ua=":user-agent"', {
      immediate: true,
      skip: (req) =>
        req.path === "/api/xhunt/stats/log-search" ||
        req.path?.includes("/api/stats/perf"),
    })
  );

  // 打印出口日志（响应返回时），包含状态与耗时；如有错误状态，额外标注
  app.use(
    morgan(
      'out cost_ms=:response-time[3] status=:status :xhunt-identity :xhunt-web method=:method url=:safe-url err=":error-info"',
      {
        skip: (req) =>
          req.path === "/api/xhunt/stats/log-search" ||
          req.path?.includes("/api/stats/perf"),
      }
    )
  );
}

module.exports = {
  sanitizeUrlForLog,
  setupLoggingMiddlewares,
};
