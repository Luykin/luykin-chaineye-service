const axios = require("axios");

const DEFAULT_TWITTER_CRAWLER_URL =
  "http://xhuntapi.internal.biteye.info/external/crawler";
const DEFAULT_TIMEOUT_MS = 18000;

function getTwitterCrawlerUrl() {
  const fullUrl = String(
    process.env.TWITTER_CRAWLER_URL ||
      process.env.SOCIAL_LISTENING_CRAWLER_URL ||
      process.env.TWITTER_CLIENT_URL ||
      ""
  ).trim();
  if (fullUrl) return fullUrl;

  const baseUrl = String(
    process.env.TWITTER_CRAWLER_BASE_URL ||
      process.env.SOCIAL_LISTENING_CRAWLER_BASE_URL ||
      process.env.CRYPTOHUNT_CRAWLER_BASE_URL ||
      process.env.CRAWLER_TWITTER_BASE_URL ||
      ""
  )
    .trim()
    .replace(/\/+$/, "");

  return baseUrl ? `${baseUrl}/crawler` : DEFAULT_TWITTER_CRAWLER_URL;
}

function getTwitterCrawlerApiKey() {
  const apiKey = String(process.env.BITEY_INTERNAL_PRO_API_KEY || "").trim();
  if (!apiKey) {
    const error = new Error("BITEY_INTERNAL_PRO_API_KEY is required for Twitter crawler requests");
    error.code = "BITEY_INTERNAL_PRO_API_KEY_REQUIRED";
    throw error;
  }
  return apiKey;
}

function getTwitterCrawlerTimeoutMs(override) {
  const value = Number(
    override ||
      process.env.TWITTER_CRAWLER_TIMEOUT_MS ||
      process.env.SOCIAL_LISTENING_CRAWLER_TIMEOUT_MS ||
      DEFAULT_TIMEOUT_MS
  );
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

async function requestTwitterCrawler(endpoint, params = {}, options = {}) {
  const cleanEndpoint = String(endpoint || "").trim();
  if (!cleanEndpoint) {
    const error = new Error("Twitter crawler endpoint is required");
    error.code = "TWITTER_CRAWLER_ENDPOINT_REQUIRED";
    throw error;
  }

  const apiKey = getTwitterCrawlerApiKey();
  return axios.post(
    getTwitterCrawlerUrl(),
    {
      endpoint: cleanEndpoint,
      ...params,
    },
    {
      timeout: getTwitterCrawlerTimeoutMs(options.timeoutMs),
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
      },
    }
  );
}

module.exports = {
  getTwitterCrawlerUrl,
  requestTwitterCrawler,
};
