const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const axios = require("axios");
const {
  fetchCreatorVerification,
  normalizeCreatorVerificationFromRankRecords,
  submitCreatorVerification,
} = require("../src/xhunt/services/creatorVerificationService");

const originalAxiosGet = axios.get;
const originalAxiosPost = axios.post;
const originalCooldownDays = process.env.CREATOR_VERIFICATION_COOLDOWN_DAYS;

afterEach(() => {
  axios.get = originalAxiosGet;
  axios.post = originalAxiosPost;
  if (originalCooldownDays === undefined) delete process.env.CREATOR_VERIFICATION_COOLDOWN_DAYS;
  else process.env.CREATOR_VERIFICATION_COOLDOWN_DAYS = originalCooldownDays;
});

test("normalizes every legacy creator status without losing action eligibility", () => {
  process.env.CREATOR_VERIFICATION_COOLDOWN_DAYS = "30";
  const now = new Date("2026-10-27T00:00:00.000Z");
  const cases = [
    { legacyStatus: 0, status: "NOT_APPLIED", canApply: true },
    { legacyStatus: 1, status: "PENDING", canApply: false },
    { legacyStatus: 2, status: "APPROVED", canApply: false },
    { legacyStatus: 3, status: "REJECTED", canApply: false },
    { legacyStatus: 4, status: "REVOKED", canApply: false },
  ];

  for (const item of cases) {
    const result = normalizeCreatorVerificationFromRankRecords(
      [{
        domain: "web3",
        record: {
          kolRank: 300000,
          auth_creator: {
            status: item.legacyStatus,
            record_time: "2026-10-20T00:00:00.000Z",
            twitter_id: "123",
          },
        },
      }],
      { now, twitterId: "123" }
    );
    assert.equal(result.status, item.status);
    assert.equal(result.canApply, item.canApply);
  }
});

test("treats the special authored rank as approved", () => {
  const result = normalizeCreatorVerificationFromRankRecords(
    [{ domain: "web3", record: { kolRank: 9999999, auth_creator: null } }],
    { twitterId: "123" }
  );
  assert.equal(result.status, "APPROVED");
  assert.equal(result.canApply, false);
});

test("allows a rejected creator to apply after the configured cooldown", () => {
  process.env.CREATOR_VERIFICATION_COOLDOWN_DAYS = "30";
  const result = normalizeCreatorVerificationFromRankRecords(
    [{
      domain: "web3",
      record: {
        kolRank: 300000,
        auth_creator: { status: 3, record_time: "2026-09-01T00:00:00.000Z" },
      },
    }],
    { now: new Date("2026-10-27T00:00:00.000Z"), twitterId: "123" }
  );
  assert.equal(result.status, "REJECTED");
  assert.equal(result.canApply, true);
  assert.equal(result.nextEligibleAt, "2026-10-01T00:00:00.000Z");
});

test("fails closed when any creator status domain is unavailable", async () => {
  axios.get = async (url) => {
    if (url.includes("/fetch/ai/rank")) throw new Error("AI rank unavailable");
    return { data: { data: { data: [] } } };
  };

  await assert.rejects(
    fetchCreatorVerification("123"),
    { message: "CREATOR_VERIFICATION_STATUS_UNAVAILABLE", status: 502 }
  );
});

function createRedis() {
  const values = new Map();
  const counters = new Map();
  return {
    get: async (key) => values.get(key) || null,
    set: async (key, value, options) => {
      if (options?.NX && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    setEx: async (key, _ttl, value) => {
      values.set(key, value);
      return "OK";
    },
    del: async (key) => values.delete(key),
    incr: async (key) => {
      const next = (counters.get(key) || 0) + 1;
      counters.set(key, next);
      return next;
    },
    expire: async () => true,
    ttl: async () => 60,
  };
}

test("submits once and replays the cached result for the same idempotency key", async () => {
  let postCalls = 0;
  axios.get = async () => ({ data: { data: { data: [] } } });
  axios.post = async () => {
    postCalls += 1;
    return { data: { data: { action: "认证中" } } };
  };
  const redisClient = createRedis();
  const input = {
    twitterId: "123",
    authCenterUserId: "auth-user-1",
    idempotencyKey: "request-1",
    redisClient,
  };

  const first = await submitCreatorVerification(input);
  const replay = await submitCreatorVerification(input);

  assert.equal(first.status, "PENDING");
  assert.deepEqual(replay, first);
  assert.equal(postCalls, 1);
});

test("returns the successful upstream result when the idempotency cache write fails", async () => {
  axios.get = async () => ({ data: { data: { data: [] } } });
  axios.post = async () => ({ data: { data: { action: "认证中" } } });
  const redisClient = createRedis();
  redisClient.setEx = async () => {
    throw new Error("Redis write failed");
  };

  const result = await submitCreatorVerification({
    twitterId: "123",
    authCenterUserId: "auth-user-1",
    idempotencyKey: "request-1",
    redisClient,
  });

  assert.equal(result.status, "PENDING");
  assert.equal(result.canApply, false);
});

test("rejects an unknown non-empty upstream action", async () => {
  axios.get = async () => ({ data: { data: { data: [] } } });
  axios.post = async () => ({ data: { data: { action: "unexpected-status" } } });

  await assert.rejects(
    submitCreatorVerification({
      twitterId: "123",
      authCenterUserId: "auth-user-1",
      idempotencyKey: "request-1",
      redisClient: createRedis(),
    }),
    { message: "CREATOR_VERIFICATION_UPSTREAM_INVALID_RESPONSE", status: 502 }
  );
});

test("fails closed when submission Redis is unavailable", async () => {
  await assert.rejects(
    submitCreatorVerification({
      twitterId: "123",
      authCenterUserId: "auth-user-1",
      idempotencyKey: "request-1",
      redisClient: null,
    }),
    { message: "CREATOR_VERIFICATION_SUBMISSION_UNAVAILABLE", status: 503 }
  );
});
