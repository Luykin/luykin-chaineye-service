const EDITED_TWEET_WINDOW_SECONDS = 24 * 60 * 60;

function getEditedTweetAccess(req) {
  const {
    isRequestXHuntVip,
    isRequestInternalTestUser,
  } = require("../constants/xhuntVip");

  if (isRequestInternalTestUser(req)) {
    return {
      detail_scope: "internal_source_window",
      detail_window_seconds: null,
      count_semantics: "edited_threads",
    };
  }

  if (isRequestXHuntVip(req)) {
    return {
      detail_scope: "vip_24h",
      detail_window_seconds: EDITED_TWEET_WINDOW_SECONDS,
      count_semantics: "edited_threads",
    };
  }

  return {
    detail_scope: "count_only",
    detail_window_seconds: 0,
    count_semantics: "edited_threads",
  };
}

function assertSuccessfulResponse(data, endpoint) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError(`Invalid ${endpoint} response`);
  }

  if (!data.data || typeof data.data !== "object" || Array.isArray(data.data)) {
    throw new TypeError(`Invalid ${endpoint} response data`);
  }
}

function applyEditedTweetAccess(
  req,
  data,
  { endpoint, nowSeconds = Math.floor(Date.now() / 1000) } = {}
) {
  return applyEditedTweetScope(data, {
    endpoint,
    nowSeconds,
    access: getEditedTweetAccess(req),
  });
}

function applyEditedTweetScope(
  data,
  { endpoint, access, nowSeconds = Math.floor(Date.now() / 1000) } = {}
) {
  if (endpoint !== "counts" && endpoint !== "details") {
    throw new TypeError("Unknown edited tweet endpoint");
  }

  assertSuccessfulResponse(data, endpoint);

  const validScopes = ["internal_source_window", "vip_24h", "count_only"];
  if (!access || !validScopes.includes(access.detail_scope)) {
    throw new TypeError("Invalid edited tweet access scope");
  }

  const filtered = {
    ...data,
    data: {
      ...data.data,
      xhunt_access: access,
    },
  };

  if (endpoint === "counts") {
    if (
      !filtered.data.counts ||
      typeof filtered.data.counts !== "object" ||
      Array.isArray(filtered.data.counts)
    ) {
      throw new TypeError("Invalid edited tweet counts");
    }
    return filtered;
  }

  if (!Array.isArray(filtered.data.items)) {
    throw new TypeError("Invalid edited tweet items");
  }

  if (access.detail_scope === "internal_source_window") {
    return filtered;
  }

  if (access.detail_scope === "count_only") {
    filtered.data = {
      items: [],
      ...(data.data.window_start !== undefined
        ? { window_start: data.data.window_start }
        : {}),
      ...(data.data.window_end !== undefined
        ? { window_end: data.data.window_end }
        : {}),
      xhunt_access: access,
    };
    return filtered;
  }

  const cutoff = nowSeconds - EDITED_TWEET_WINDOW_SECONDS;
  filtered.data.items = filtered.data.items.filter((item) => {
    const firstCreatedAt = Number(item?.edit?.first_created_at);
    return (
      Number.isFinite(firstCreatedAt) &&
      firstCreatedAt >= cutoff &&
      firstCreatedAt <= nowSeconds
    );
  });

  return filtered;
}

module.exports = {
  EDITED_TWEET_WINDOW_SECONDS,
  applyEditedTweetAccess,
  applyEditedTweetScope,
  getEditedTweetAccess,
};
