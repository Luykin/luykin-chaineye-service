const HANDLE_RE = /^[a-zA-Z0-9_]{1,30}$/;
const TWEET_ID_RE = /^\d{5,32}$/;

function normalizeTwitterHandle(value) {
  if (Array.isArray(value)) return normalizeTwitterHandle(value[0]);
  const raw = String(value || "").trim();
  if (!raw) return "";

  let handle = raw;
  const urlMatch = raw.match(/(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([a-zA-Z0-9_]{1,30})(?:\b|\/)/i);
  if (urlMatch?.[1]) {
    handle = urlMatch[1];
  }

  handle = handle
    .replace(/^@+/, "")
    .replace(/\?.*$/, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();

  return HANDLE_RE.test(handle) ? handle : "";
}

function assertTwitterHandle(value) {
  const handle = normalizeTwitterHandle(value);
  if (!handle) {
    const error = new Error("INVALID_TWITTER_HANDLE");
    error.status = 400;
    error.publicMessage = "请输入合法的 X handle。";
    throw error;
  }
  return handle;
}

function parseTweetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const statusMatch = raw.match(/(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([a-zA-Z0-9_]{1,30})\/status(?:es)?\/(\d{5,32})/i);
  if (statusMatch) {
    return {
      handle: normalizeTwitterHandle(statusMatch[1]),
      tweetId: statusMatch[2],
      url: raw,
    };
  }

  if (TWEET_ID_RE.test(raw)) {
    return { handle: null, tweetId: raw, url: `https://x.com/i/web/status/${raw}` };
  }

  return null;
}

function buildTweetUrl(handle, tweetId) {
  const normalized = normalizeTwitterHandle(handle);
  if (normalized) return `https://x.com/${normalized}/status/${tweetId}`;
  return `https://x.com/i/web/status/${tweetId}`;
}

module.exports = {
  normalizeTwitterHandle,
  assertTwitterHandle,
  parseTweetUrl,
  buildTweetUrl,
};
