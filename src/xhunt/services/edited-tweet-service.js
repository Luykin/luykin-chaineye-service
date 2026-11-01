const { DATA_SERVICE_BASE_URL } = require("../constants/dataService");

const EDITED_TWEET_UPSTREAM_TIMEOUT_MS = 10_000;
const EDITED_TWEET_PATHS = {
  counts: "/tweet/edited_counts",
  details: "/tweet/edited",
};

class EditedTweetServiceError extends Error {
  constructor(message, { code, statusCode = 502, cause } = {}) {
    super(message, { cause });
    this.name = "EditedTweetServiceError";
    this.code = code || "EDITED_TWEET_UPSTREAM_ERROR";
    this.statusCode = statusCode;
  }
}

function buildEditedTweetUrl(endpoint, params, baseUrl = DATA_SERVICE_BASE_URL) {
  const path = EDITED_TWEET_PATHS[endpoint];
  if (!path) {
    throw new TypeError("Unknown edited tweet endpoint");
  }

  const url = new URL(path, `${String(baseUrl).replace(/\/+$/, "")}/`);
  const allowedParams =
    endpoint === "counts"
      ? ["user_ids"]
      : ["user_id", "limit", "offset"];

  for (const key of allowedParams) {
    const value = params?.[key];
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

async function requestEditedTweetData(
  endpoint,
  params,
  {
    fetchImpl = globalThis.fetch,
    baseUrl = DATA_SERVICE_BASE_URL,
    timeoutMs = EDITED_TWEET_UPSTREAM_TIMEOUT_MS,
  } = {}
) {
  if (typeof fetchImpl !== "function") {
    throw new EditedTweetServiceError("Fetch is unavailable", {
      code: "EDITED_TWEET_FETCH_UNAVAILABLE",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = buildEditedTweetUrl(endpoint, params, baseUrl);
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const responseText = await response.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (error) {
      if (!response.ok) {
        throw new EditedTweetServiceError("Upstream request failed", {
          code:
            response.status === 400
              ? "EDITED_TWEET_INVALID_REQUEST"
              : "EDITED_TWEET_UPSTREAM_ERROR",
          statusCode: response.status === 400 ? 400 : 502,
          cause: error,
        });
      }
      throw new EditedTweetServiceError("Invalid upstream response", {
        code: "EDITED_TWEET_INVALID_UPSTREAM_RESPONSE",
        cause: error,
      });
    }

    if (!response.ok) {
      throw new EditedTweetServiceError("Upstream request failed", {
        code:
          response.status === 400
            ? "EDITED_TWEET_INVALID_REQUEST"
            : "EDITED_TWEET_UPSTREAM_ERROR",
        statusCode: response.status === 400 ? 400 : 502,
      });
    }

    if (data?.code !== 200) {
      throw new EditedTweetServiceError(
        typeof data?.message === "string" && data.message
          ? data.message
          : "Upstream business error",
        {
          code:
            data?.code === 400
              ? "EDITED_TWEET_INVALID_REQUEST"
              : "EDITED_TWEET_UPSTREAM_ERROR",
          statusCode: data?.code === 400 ? 400 : 502,
        }
      );
    }

    return data;
  } catch (error) {
    if (error instanceof EditedTweetServiceError) {
      throw error;
    }
    if (error?.name === "AbortError") {
      throw new EditedTweetServiceError("Upstream request timed out", {
        code: "EDITED_TWEET_UPSTREAM_TIMEOUT",
        statusCode: 504,
        cause: error,
      });
    }
    throw new EditedTweetServiceError("Upstream request failed", {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  EDITED_TWEET_UPSTREAM_TIMEOUT_MS,
  EditedTweetServiceError,
  buildEditedTweetUrl,
  requestEditedTweetData,
};
