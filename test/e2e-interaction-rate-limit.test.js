const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const {
  DEFAULT_INTERACTION_SUBMIT_COOLDOWN_MS,
  enforceE2eInteractionSubmitCooldown,
} = require("../src/echohunt/e2e/services/e2eInteractionRateLimit");

const previousCooldown = process.env.E2E_INTERACTION_SUBMIT_COOLDOWN_MS;

afterEach(() => {
  if (previousCooldown === undefined) delete process.env.E2E_INTERACTION_SUBMIT_COOLDOWN_MS;
  else process.env.E2E_INTERACTION_SUBMIT_COOLDOWN_MS = previousCooldown;
});

test("reserves a six-second cooldown per Twitter user", async () => {
  delete process.env.E2E_INTERACTION_SUBMIT_COOLDOWN_MS;
  let captured = null;
  const redisClient = {
    set: async (...args) => {
      captured = args;
      return "OK";
    },
  };

  await enforceE2eInteractionSubmitCooldown(redisClient, "user-1");

  assert.deepEqual(captured, [
    "echohunt:e2e:interaction-submit:v1:user-1",
    "1",
    { NX: true, PX: DEFAULT_INTERACTION_SUBMIT_COOLDOWN_MS },
  ]);
});

test("rejects another submission from the same user during the cooldown", async () => {
  const redisClient = {
    set: async () => null,
    pTTL: async () => 4200,
  };

  await assert.rejects(
    enforceE2eInteractionSubmitCooldown(redisClient, "user-1"),
    (error) => error.code === "E2E_INTERACTION_RATE_LIMITED"
      && error.status === 429
      && error.retryAfterSeconds === 5
  );
});

test("keeps cooldowns independent between users", async () => {
  const reserved = new Set();
  const redisClient = {
    set: async (key) => {
      if (reserved.has(key)) return null;
      reserved.add(key);
      return "OK";
    },
    pTTL: async () => 6000,
  };

  await enforceE2eInteractionSubmitCooldown(redisClient, "user-1");
  await enforceE2eInteractionSubmitCooldown(redisClient, "user-2");
  await assert.rejects(
    enforceE2eInteractionSubmitCooldown(redisClient, "user-1"),
    { code: "E2E_INTERACTION_RATE_LIMITED", status: 429 }
  );
});

test("fails closed when Redis is unavailable", async () => {
  await assert.rejects(
    enforceE2eInteractionSubmitCooldown(null, "user-1"),
    { code: "E2E_INTERACTION_RATE_LIMIT_UNAVAILABLE", status: 503 }
  );
});
