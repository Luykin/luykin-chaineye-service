const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");

function stubModule(modulePath, exports) {
  const id = require.resolve(modulePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const pass = (_req, _res, next) => next();
let vipChecks = 0;

stubModule("../src/xhunt/middleware/security", { securityMiddleware: pass });
stubModule("../src/xhunt/middleware/auth", {
  authenticateToken: pass,
  authenticateTokenOptional: pass,
});
stubModule("../src/xhunt/middleware/aiContentRateLimit", {
  aiContentRateLimit: pass,
});
stubModule("../src/xhunt/middleware/pro-status", { checkProStatus: pass });
stubModule("../src/xhunt/constants/xhuntVip", {
  isRequestXHuntVip: () => {
    vipChecks += 1;
    return false;
  },
  isRequestInternalTestUser: () => false,
});
stubModule("../src/xhunt/services/giftCreditsService", {
  handleUserCreateGiftCredits: async () => {},
});
stubModule("../src/xhunt/services/nacosConfigClient", {
  getNacosConfigContent: async () => "{}",
});

const realFetch = global.fetch;
const upstreamPayload = {
  data: {
    data: {
      unfollowed_action: [
        {
          id: "recent-hidden",
          created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          follower_id: "1",
          following_id: "2",
        },
      ],
      unfollowing_action: [],
      twitter_users: { 1: { id: "1" }, 2: { id: "2" } },
    },
  },
};

test("public-stream uses its own allowlist while normal proxy keeps unfollow filtering", async (t) => {
  const upstreamUrls = [];
  global.fetch = async (url, options) => {
    if (String(url).startsWith("http://127.0.0.1:")) {
      return realFetch(url, options);
    }
    upstreamUrls.push(String(url));
    return new Response(JSON.stringify(upstreamPayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const router = require("../src/xhunt/api/proxy");
  const app = express();
  app.use(router);
  const server = app.listen(0, "127.0.0.1");

  t.after(() => {
    global.fetch = realFetch;
    server.close();
  });

  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { "x-extension-version": "0.4.6" };

  const beforeVipChecks = vipChecks;
  const normalResponse = await realFetch(
    `${base}/public/fetch/twitter/unfollow_relation?target=k8s_kota`,
    { headers }
  );
  const normal = await normalResponse.json();
  const rejectedStreamResponse = await realFetch(
    `${base}/public-stream/fetch/twitter/unfollow_relation?target=k8s_kota`,
    { headers }
  );
  const allowedStreamResponse = await realFetch(
    `${base}/public-stream/fetch/twitter/feed?target=k8s_kota`,
    { headers }
  );
  const rejectedPublicResponse = await realFetch(
    `${base}/public/internal/not-allowed?target=k8s_kota`,
    { headers }
  );

  assert.equal(normalResponse.status, 200);
  assert.deepEqual(normal.data.data.unfollowed_action, []);
  assert.equal(vipChecks - beforeVipChecks, 1);
  assert.equal(rejectedStreamResponse.status, 403);
  assert.deepEqual(await rejectedStreamResponse.json(), {
    error: "PROXY_PATH_NOT_ALLOWED",
  });
  assert.equal(allowedStreamResponse.status, 200);
  assert.deepEqual(await allowedStreamResponse.json(), upstreamPayload);
  assert.equal(rejectedPublicResponse.status, 403);
  assert.deepEqual(await rejectedPublicResponse.json(), {
    error: "PROXY_PATH_NOT_ALLOWED",
  });
  assert.equal(upstreamUrls.length, 2);
  assert.equal(
    new URL(upstreamUrls[0]).pathname,
    "/fetch/twitter/unfollow_relation"
  );
  assert.equal(new URL(upstreamUrls[1]).pathname, "/fetch/twitter/feed");
});
