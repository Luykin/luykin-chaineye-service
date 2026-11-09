const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PROXY_PATH_ALLOWLIST,
  PROXY_PATH_DENYLIST,
  PUBLIC_STREAM_PATH_ALLOWLIST,
  extractProxyPathInfo,
  isProxyPathAllowed,
} = require("../src/xhunt/constants/proxyPathAllowlist");

test("maintains separate coarse-grained allowlists for proxy and public-stream", () => {
  assert.deepEqual(PUBLIC_STREAM_PATH_ALLOWLIST, [
    "fetch/twitter/feed/*",
    "fetch/twitter/top_tweet/*",
  ]);
  assert.deepEqual(PROXY_PATH_ALLOWLIST, [
    "fetch/*",
    "api/*",
    "pro/api/*",
    "analysis/*",
  ]);
  assert.deepEqual(PROXY_PATH_DENYLIST, ["fetch/tweet/deleted_all"]);
});

test("normal proxy accepts observed path families without requiring exact entries", () => {
  const allowedPaths = [
    "/public/fetch/twitter/unfollow_relation",
    "/public/fetch/twitter/a-future-endpoint",
    "/public/fetch/tweet/deleted",
    "/public/fetch/ai/rank",
    "/public/fetch/token/analysis",
    "/public/pro/api/e2es",
    "/public/api/rootdata/search",
    "/public/analysis/twitter/top_influencer_vibe",
    "/public/api/matrix/latest-full",
    "/public/api/fundraising/search/legacy",
    "/auth/fetch/twitter/user",
  ];

  for (const path of allowedPaths) {
    assert.equal(isProxyPathAllowed(path), true, path);
  }
});

test("public-stream only accepts its own path families", () => {
  assert.equal(isProxyPathAllowed("/public-stream/fetch/twitter/feed"), true);
  assert.equal(
    isProxyPathAllowed("/public-stream/fetch/twitter/feed/by-user"),
    true
  );
  assert.equal(
    isProxyPathAllowed("/public-stream/fetch/twitter/top_tweet"),
    true
  );

  assert.equal(
    isProxyPathAllowed("/public-stream/fetch/twitter/unfollow_relation"),
    false
  );
  assert.equal(
    isProxyPathAllowed("/public-stream/fetch/ai/rank"),
    false
  );
});

test("extracts the entry type and logical target path", () => {
  assert.deepEqual(
    extractProxyPathInfo("/public/fetch/twitter/unfollow_relation"),
    { entryType: "proxy", targetPath: "fetch/twitter/unfollow_relation" }
  );
  assert.deepEqual(
    extractProxyPathInfo("/public-stream/fetch/twitter/feed"),
    { entryType: "public-stream", targetPath: "fetch/twitter/feed" }
  );
  assert.deepEqual(extractProxyPathInfo("/auth/fetch/twitter/user"), {
    entryType: "proxy",
    targetPath: "fetch/twitter/user",
  });
});

test("rejects non-allowlisted and non-canonical paths", () => {
  const rejectedPaths = [
    "/public/fetch/tweet/deleted_all",
    "/public/internal/not-allowed",
    "/public-stream/internal/not-allowed",
    "/public//fetch/twitter/rank",
    "/public/fetch/twitter/../rank",
    "/public/fetch/twitter/%72ank",
    "/unknown/fetch/twitter/rank",
  ];

  for (const path of rejectedPaths) {
    assert.equal(isProxyPathAllowed(path), false, path);
  }
});
