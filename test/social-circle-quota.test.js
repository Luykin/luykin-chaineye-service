const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  checkSocialCircleQuota,
  buildSocialCircleAvailabilityResponse,
  commitSocialCircleQuotaIfSuccessful,
} = require("../src/xhunt/utils/social-circle-quota");

const context = {
  key: "xhunt:social-circle:daily:2026-11-04:test",
  target: "id:123",
  limit: 6,
  ttlSeconds: 3600,
};

test("quota precheck never consumes a handler", async () => {
  const calls = [];
  const redisClient = {
    eval: async (script, options) => {
      calls.push({ script, options });
      return [1, 2];
    },
  };

  const result = await checkSocialCircleQuota(redisClient, context);

  assert.deepEqual(result, { allowed: true, used: 2 });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].script, /SADD/);
});

test("404 or empty social-circle data does not consume quota", async () => {
  let evalCalls = 0;
  const redisClient = {
    eval: async () => {
      evalCalls += 1;
      return [1, 1];
    },
  };

  const notFound = await commitSocialCircleQuotaIfSuccessful(
    redisClient,
    context,
    { code: 404 },
  );
  const empty = await commitSocialCircleQuotaIfSuccessful(
    redisClient,
    context,
    { code: 200, data: { items: [] } },
  );

  assert.deepEqual(notFound, { charged: false });
  assert.deepEqual(empty, { charged: false });
  assert.equal(evalCalls, 0);
});

test("availability response reports data without touching quota", () => {
  assert.deepEqual(
    buildSocialCircleAvailabilityResponse({
      code: 200,
      data: { items: [{ kol: { user_id: "456" } }] },
    }),
    { code: 200, message: "success", data: { available: true } },
  );
  assert.deepEqual(
    buildSocialCircleAvailabilityResponse({ code: 200, data: { items: [] } }),
    { code: 200, message: "success", data: { available: false } },
  );
  assert.deepEqual(
    buildSocialCircleAvailabilityResponse({ code: 404 }),
    { code: 200, message: "success", data: { available: false } },
  );
});

test("only the social-circle detail route uses the quota middleware", () => {
  process.env.PG_HOST ||= "127.0.0.1";
  process.env.PG_DATABASE ||= "test";
  process.env.PG_USERNAME ||= "test";
  process.env.PG_PASSWORD ||= "test";

  const router = require("../src/xhunt/api/proxy");
  const routeLayers = router.stack.filter((layer) =>
    String(layer.route?.path || "").includes("kol_interactions"),
  );
  const availabilityRoute = routeLayers.find((layer) =>
    String(layer.route.path).endsWith("/availability"),
  );
  const detailRoute = routeLayers.find(
    (layer) => layer.route.path === "/public/fetch/twitter/kol_interactions",
  );

  assert.deepEqual(availabilityRoute?.route.methods, { get: true });
  assert.equal(
    availabilityRoute?.route.stack.some(
      (layer) => layer.name === "socialCircleDailyLimit",
    ),
    false,
  );
  assert.deepEqual(detailRoute?.route.methods, { get: true });
  assert.equal(
    detailRoute?.route.stack.some(
      (layer) => layer.name === "socialCircleDailyLimit",
    ),
    true,
  );
});

test("availability converts an upstream 404 into an empty successful response", async () => {
  process.env.PG_HOST ||= "127.0.0.1";
  process.env.PG_DATABASE ||= "test";
  process.env.PG_USERNAME ||= "test";
  process.env.PG_PASSWORD ||= "test";

  const router = require("../src/xhunt/api/proxy");
  const availabilityRoute = router.stack.find(
    (layer) =>
      layer.route?.path ===
      "/public/fetch/twitter/kol_interactions/availability",
  );
  const routeHandler = availabilityRoute.route.stack.at(-1).handle;
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  let statusCode;
  let responseBody;
  const responseHeaders = new Map();

  global.fetch = async () =>
    new Response(JSON.stringify({ code: 404, message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  console.error = () => {};

  try {
    await routeHandler(
      {
        method: "GET",
        path: "/public/fetch/twitter/kol_interactions/availability",
        query: { username: "no_data" },
        headers: {},
      },
      {
        setHeader(name, value) {
          responseHeaders.set(String(name).toLowerCase(), value);
        },
        hasHeader(name) {
          return responseHeaders.has(String(name).toLowerCase());
        },
        status(value) {
          statusCode = value;
          return this;
        },
        json(value) {
          responseBody = value;
          return this;
        },
      },
    );
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
  }

  assert.equal(statusCode, 200);
  assert.deepEqual(responseBody, {
    code: 200,
    message: "success",
    data: { available: false },
  });
});

test("valid social-circle data atomically consumes one handler", async () => {
  const calls = [];
  const redisClient = {
    eval: async (script, options) => {
      calls.push({ script, options });
      return [1, 3, 1];
    },
  };

  const result = await commitSocialCircleQuotaIfSuccessful(
    redisClient,
    context,
    { code: 200, data: { items: [{ kol: { user_id: "456" } }] } },
  );

  assert.deepEqual(result, { charged: true, allowed: true, used: 3 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].script, /SADD/);
  assert.deepEqual(calls[0].options, {
    keys: [context.key],
    arguments: [context.target, "6", "3600"],
  });
});

test("commit rejects a successful response when another request filled the last slot", async () => {
  const redisClient = {
    eval: async () => [0, 6, 0],
  };

  const result = await commitSocialCircleQuotaIfSuccessful(
    redisClient,
    context,
    { code: 200, data: { items: [{ kol: { user_id: "456" } }] } },
  );

  assert.deepEqual(result, { charged: false, allowed: false, used: 6 });
});
