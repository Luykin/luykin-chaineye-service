const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  checkSocialCircleQuota,
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
