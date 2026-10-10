/**
 * Google Docs 草稿链接工具：链接规范化与匿名可读性预检。
 * 仅接受 docs.google.com/document/d/:id 或 /document/u/:n/d/:id 形式的链接；
 * 导出请求仅允许跟随至 Google 官方导出域名（*.googleusercontent.com 及 docs.google.com），防范 SSRF。
 */
const axios = require("axios");

const GOOGLE_DOC_HOST = "docs.google.com";
const GOOGLE_DOC_PATH_PATTERN = /^\/document(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]{20,})(?:\/|$)/;
const EXPORT_MAX_CONTENT_LENGTH = 2 * 1024 * 1024;
const EXPORT_TEXT_MAX_LENGTH = 50000;
const MAX_REDIRECT_HOPS = 3;

function isAllowedGoogleDocHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "docs.google.com" || host.endsWith(".google.com") || host.endsWith(".googleusercontent.com");
}

function invalidGoogleDocUrlError() {
  const error = new Error("请提供有效的 Google Docs 文档链接");
  error.status = 400;
  error.code = "INVALID_GOOGLE_DOC_URL";
  error.publicMessage = error.message;
  return error;
}

function normalizeGoogleDocUrl(input) {
  const raw = String(input || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw invalidGoogleDocUrlError();
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== GOOGLE_DOC_HOST) {
    throw invalidGoogleDocUrlError();
  }
  const match = parsed.pathname.match(GOOGLE_DOC_PATH_PATTERN);
  if (!match) throw invalidGoogleDocUrlError();
  const documentId = match[1];
  return { documentId, url: `https://docs.google.com/document/d/${documentId}/` };
}

async function fetchGoogleDocText(documentId, { timeoutMs = 8000 } = {}) {
  const exportUrl = `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/export?format=txt`;
  try {
    let currentUrl = exportUrl;
    let redirects = 0;

    while (redirects <= MAX_REDIRECT_HOPS) {
      const response = await axios.get(currentUrl, {
        timeout: timeoutMs,
        maxRedirects: 0,
        responseType: "text",
        maxContentLength: EXPORT_MAX_CONTENT_LENGTH,
        validateStatus: () => true,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Accept: "text/plain, text/*;q=0.9, */*;q=0.1",
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        redirects++;
        const location = response.headers?.location;
        if (!location) return { accessible: false, reason: "redirect_missing_location" };
        const nextUrl = new URL(location, currentUrl);
        if (nextUrl.protocol !== "https:" || !isAllowedGoogleDocHost(nextUrl.hostname)) {
          return { accessible: false, reason: "redirect_disallowed_host" };
        }
        currentUrl = nextUrl.toString();
        continue;
      }

      const contentType = String(response.headers?.["content-type"] || "").toLowerCase();
      if (response.status === 200 && contentType.includes("text/plain")) {
        const text = String(response.data || "").slice(0, EXPORT_TEXT_MAX_LENGTH);
        return { accessible: true, text };
      }
      return { accessible: false, reason: `http_${response.status}` };
    }
    return { accessible: false, reason: "too_many_redirects" };
  } catch (_) {
    return { accessible: false, reason: "network_error" };
  }
}

module.exports = {
  normalizeGoogleDocUrl,
  fetchGoogleDocText,
};
