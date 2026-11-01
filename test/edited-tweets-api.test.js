const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.PG_HOST ||= "127.0.0.1";
process.env.PG_DATABASE ||= "xhunt_test";
process.env.PG_USERNAME ||= "xhunt_test";
process.env.PG_PASSWORD ||= "xhunt_test";
process.env.JWT_SECRET ||= "test";

const express = require("express");
const editedTweetRoutes = require("../src/xhunt/api/edited-tweets");

function requestJson(server, path) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port: address.port,
        path,
        headers: {
          "x-request-id": "edited-tweets-api-test",
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: JSON.parse(body),
          });
        });
      }
    );
    request.on("error", reject);
  });
}

async function withServer(run) {
  const app = express();
  app.use("/api/xhunt/twitter", editedTweetRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(server);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test("edited counts forwards only the fixed upstream query and returns access", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return new Response(
      JSON.stringify({
        code: 200,
        message: "get data success",
        data: {
          counts: { "123": 2 },
          window_start: 1,
          window_end: 2,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    await withServer(async (server) => {
      const response = await requestJson(
        server,
        "/api/xhunt/twitter/edited-counts?user_ids=123"
      );
      assert.equal(response.status, 200);
      assert.equal(response.body.data.counts["123"], 2);
      assert.equal(response.body.data.xhunt_access.detail_scope, "count_only");
      assert.match(response.headers["cache-control"], /no-store/);
      assert.equal(requestedUrl.pathname, "/fetch/tweet/edited_counts");
      assert.equal(requestedUrl.searchParams.get("user_ids"), "123");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-VIP edited details return no item or future sensitive fields", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: 200,
        message: "get data success",
        data: {
          items: [
            {
              edit: {
                root_id: "secret",
                first_created_at: Math.floor(Date.now() / 1000),
              },
            },
          ],
          window_start: 1,
          window_end: 2,
          future_sensitive_field: { text: "secret" },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  try {
    await withServer(async (server) => {
      const response = await requestJson(
        server,
        "/api/xhunt/twitter/edited?user_id=123&limit=20&offset=0"
      );
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.data.items, []);
      assert.equal(response.body.data.future_sensitive_field, undefined);
      assert.equal(response.body.data.xhunt_access.detail_scope, "count_only");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dedicated endpoints reject target selection before calling upstream", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("should not be called");
  };

  try {
    await withServer(async (server) => {
      const response = await requestJson(
        server,
        "/api/xhunt/twitter/edited?user_id=123&target=k8s_kota"
      );
      assert.equal(response.status, 400);
      assert.equal(response.body.error, "EDITED_TWEET_UNSUPPORTED_TARGET");
      assert.equal(called, false);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
