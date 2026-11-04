// 真正允许使用流式代理的 path 族。`/*` 同时匹配目录本身及其子路径。
const PUBLIC_STREAM_PATH_ALLOWLIST = [
  "fetch/twitter/feed/*",
  "fetch/twitter/top_tweet/*",
];

// 普通代理允许访问的上游 path 族，按线上请求的大类维护，无需细化到单个接口。
const PROXY_PATH_ALLOWLIST = [
  "fetch/*",
  "api/*",
  "pro/api/*",
  "analysis/*",
];

function extractProxyPathInfo(requestPath) {
  if (typeof requestPath !== "string" || !requestPath) {
    return null;
  }

  // 只接受规范 path，避免编码斜杠、反斜杠、重复斜杠或目录跳转绕过匹配。
  if (
    requestPath.includes("%") ||
    requestPath.includes("\\") ||
    requestPath.includes("\0") ||
    requestPath.includes("//")
  ) {
    return null;
  }

  const match = requestPath.match(/^\/(auth|public|public-stream)\/(.+)$/);
  if (!match) {
    return null;
  }

  const targetPath = match[2];
  const segments = targetPath.split("/");
  if (
    !targetPath ||
    targetPath.endsWith("/") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }

  return {
    entryType: match[1] === "public-stream" ? "public-stream" : "proxy",
    targetPath,
  };
}

function matchesPathPattern(targetPath, pattern) {
  if (!pattern.endsWith("/*")) {
    return targetPath === pattern;
  }

  const prefix = pattern.slice(0, -2);
  return targetPath === prefix || targetPath.startsWith(`${prefix}/`);
}

function isProxyPathAllowed(requestPath) {
  const pathInfo = extractProxyPathInfo(requestPath);
  if (!pathInfo) {
    return false;
  }

  const allowlist =
    pathInfo.entryType === "public-stream"
      ? PUBLIC_STREAM_PATH_ALLOWLIST
      : PROXY_PATH_ALLOWLIST;
  return allowlist.some((pattern) =>
    matchesPathPattern(pathInfo.targetPath, pattern)
  );
}

module.exports = {
  PROXY_PATH_ALLOWLIST,
  PUBLIC_STREAM_PATH_ALLOWLIST,
  extractProxyPathInfo,
  isProxyPathAllowed,
  matchesPathPattern,
};
