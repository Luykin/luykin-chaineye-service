const assert = require("node:assert/strict");
const test = require("node:test");

process.env.PG_HOST ||= "127.0.0.1";
process.env.PG_DATABASE ||= "xhunt_test";
process.env.PG_USERNAME ||= "xhunt_test";
process.env.PG_PASSWORD ||= "xhunt_test";

const { createVipMembershipService } = require("../src/xhunt/services/vipMembershipService");

const NOW = new Date("2026-11-12T08:00:00.000Z");

function createHarness(initialMembership = null) {
  let membership = initialMembership ? makeMembership(initialMembership) : null;
  const operations = [];
  let refreshCount = 0;
  const transaction = { LOCK: { UPDATE: "UPDATE" } };
  const sequelize = {
    query: async () => {},
    transaction: async (callback) => callback(transaction),
  };
  const VipUser = {
    findOne: async ({ where }) => membership && membership.twitterId === where.twitterId ? membership : null,
    create: async (values) => {
      membership = makeMembership({ id: 1, createdAt: NOW, ...values });
      return membership;
    },
    findAll: async ({ where }) => {
      const ids = where.twitterId[Object.getOwnPropertySymbols(where.twitterId)[0]];
      return membership && ids.includes(membership.twitterId) ? [membership] : [];
    },
    findAndCountAll: async () => ({ count: membership ? 1 : 0, rows: membership ? [membership] : [] }),
  };
  const VipOperation = {
    findOne: async ({ where }) => operations.find((row) => row.clientKey === where.clientKey && row.orderNo === where.orderNo) || null,
    create: async (values) => {
      operations.push({ ...values });
      return values;
    },
  };
  const service = createVipMembershipService({
    sequelize,
    VipUser,
    VipOperation,
    clock: () => new Date(NOW),
    refresh: async () => { refreshCount += 1; },
  });
  return {
    service,
    operations,
    getMembership: () => membership,
    getRefreshCount: () => refreshCount,
  };
}

function makeMembership(values) {
  return {
    username: null,
    listType: "vip",
    vipOrigin: "membership_api",
    ...values,
    async update(changes) {
      Object.assign(this, changes);
      return this;
    },
  };
}

function grantInput(overrides = {}) {
  return {
    clientKey: "membership-service",
    requestId: "request-1",
    orderNo: "order-1",
    twitterId: "1368827101575516161",
    expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

test("grant accepts the exact 12-hour and 5-calendar-year boundaries", async () => {
  const exactMinimum = createHarness();
  await exactMinimum.service.grant(grantInput({
    expiresAt: new Date(NOW.getTime() + 12 * 60 * 60 * 1000).toISOString(),
  }));

  const exactMaximum = createHarness();
  const fiveYears = new Date(NOW);
  fiveYears.setUTCFullYear(fiveYears.getUTCFullYear() + 5);
  await exactMaximum.service.grant(grantInput({ expiresAt: fiveYears.toISOString() }));
});

test("grant rejects unsafe time boundaries and timestamps without timezone", async () => {
  const { service } = createHarness();
  await assert.rejects(
    service.grant(grantInput({ expiresAt: new Date(NOW.getTime() + 12 * 60 * 60 * 1000 - 1).toISOString() })),
    (error) => error.code === "EXPIRES_AT_TOO_EARLY"
  );
  await assert.rejects(
    service.grant(grantInput({ expiresAt: "2027-05-12T08:00:00" })),
    (error) => error.code === "INVALID_EXPIRES_AT"
  );
  const beyondFiveYears = new Date(NOW);
  beyondFiveYears.setUTCFullYear(beyondFiveYears.getUTCFullYear() + 5);
  beyondFiveYears.setUTCMilliseconds(1);
  await assert.rejects(
    service.grant(grantInput({ expiresAt: beyondFiveYears.toISOString() })),
    (error) => error.code === "EXPIRES_AT_TOO_LATE"
  );
});

test("different orders overwrite absolute expiry while identical orders replay once", async () => {
  const harness = createHarness();
  const later = new Date(NOW.getTime() + 72 * 60 * 60 * 1000).toISOString();
  const earlier = new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const first = await harness.service.grant(grantInput({ expiresAt: later }));
  const replay = await harness.service.grant(grantInput({ expiresAt: later, requestId: "request-2" }));
  await harness.service.grant(grantInput({ orderNo: "order-2", requestId: "request-3", expiresAt: earlier }));

  assert.equal(first.data.replayed, false);
  assert.equal(replay.data.replayed, true);
  assert.equal(harness.operations.length, 2);
  assert.equal(harness.getMembership().vipExpiresAt.toISOString(), earlier);
  assert.equal(harness.getRefreshCount(), 2);

  await assert.rejects(
    harness.service.grant(grantInput({ expiresAt: earlier })),
    (error) => error.code === "IDEMPOTENCY_CONFLICT" && error.status === 409
  );
});

test("batch query checks raw size, deduplicates in first-seen order, and treats equality as expired", async () => {
  const harness = createHarness({
    id: 1,
    twitterId: "2",
    vipExpiresAt: new Date(NOW),
    createdAt: NOW,
  });
  const hundred = Array.from({ length: 100 }, (_, index) => String(index + 1));
  assert.equal((await harness.service.batchGet(hundred)).length, 100);
  await assert.rejects(
    harness.service.batchGet([...hundred, "101"]),
    (error) => error.code === "BATCH_TOO_LARGE"
  );
  const result = await harness.service.batchGet(["2", "1", "2"]);
  assert.deepEqual(result.map((item) => item.twitterId), ["2", "1"]);
  assert.deepEqual(result.map((item) => item.status), ["expired", "not_found"]);
});

test("force expire is idempotent and a later grant restores membership", async () => {
  const harness = createHarness({
    id: 1,
    twitterId: "1368827101575516161",
    vipExpiresAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000),
    createdAt: NOW,
  });
  const command = {
    clientKey: "risk-service",
    requestId: "force-http-1",
    requestNo: "force-1",
    twitterId: "1368827101575516161",
    reason: "risk_control",
  };
  const first = await harness.service.forceExpire(command);
  const replay = await harness.service.forceExpire({ ...command, requestId: "force-http-2" });
  assert.equal(first.data.changed, true);
  assert.equal(replay.data.replayed, true);
  assert.equal(harness.getMembership().vipExpiresAt.toISOString(), NOW.toISOString());

  await harness.service.grant(grantInput({ clientKey: "risk-service", orderNo: "restore-1" }));
  assert.ok(harness.getMembership().vipExpiresAt.getTime() > NOW.getTime());
});
