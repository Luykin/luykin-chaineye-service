const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EditedTweetServiceError,
  buildEditedTweetUrl,
  requestEditedTweetData,
} = require("../src/xhunt/services/edited-tweet-service");

function response(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

test("buildEditedTweetUrl only forwards endpoint-specific parameters", () => {
  const url = buildEditedTweetUrl(
    "details",
    {
      user_id: "123",
      limit: 20,
      offset: 0,
      target: "unexpected",
      url: "https://example.com",
    },
    "https://data.example"
  );

  assert.equal(url.origin, "https://data.example");
  assert.equal(url.pathname, "/fetch/tweet/edited");
  assert.equal(url.searchParams.get("user_id"), "123");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("offset"), "0");
  assert.equal(url.searchParams.has("target"), false);
  assert.equal(url.searchParams.has("url"), false);
});

test("requestEditedTweetData parses a successful response", async () => {
  let requestedUrl;
  const data = await requestEditedTweetData(
    "counts",
    { user_ids: "123,456" },
    {
      baseUrl: "https://data.example",
      fetchImpl: async (url) => {
        requestedUrl = url;
        return response(
          JSON.stringify({ code: 200, data: { counts: { "123": 1, "456": 0 } } })
        );
      },
    }
  );

  assert.equal(requestedUrl.pathname, "/fetch/tweet/edited_counts");
  assert.equal(requestedUrl.searchParams.get("user_ids"), "123,456");
  assert.equal(data.data.counts["123"], 1);
});

test("requestEditedTweetData maps invalid JSON to a safe upstream error", async () => {
  await assert.rejects(
    requestEditedTweetData("counts", { user_ids: "123" }, {
      fetchImpl: async () => response("not json"),
    }),
    (error) =>
      error instanceof EditedTweetServiceError &&
      error.code === "EDITED_TWEET_INVALID_UPSTREAM_RESPONSE" &&
      error.statusCode === 502
  );
});

test("requestEditedTweetData maps upstream business validation errors", async () => {
  await assert.rejects(
    requestEditedTweetData("details", { user_id: "123" }, {
      fetchImpl: async () =>
        response(JSON.stringify({ code: 400, message: "invalid limit" })),
    }),
    (error) =>
      error instanceof EditedTweetServiceError &&
      error.code === "EDITED_TWEET_INVALID_REQUEST" &&
      error.statusCode === 400
  );
});

test("requestEditedTweetData normalizes an HTTP 400 text response", async () => {
  await assert.rejects(
    requestEditedTweetData("details", { user_id: "123" }, {
      fetchImpl: async () => response("invalid query", { status: 400 }),
    }),
    (error) =>
      error instanceof EditedTweetServiceError &&
      error.code === "EDITED_TWEET_INVALID_REQUEST" &&
      error.statusCode === 400
  );
});
