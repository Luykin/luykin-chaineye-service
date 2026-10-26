const assert = require("node:assert/strict");
const path = require("node:path");
const { after, test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");
const servicePath = path.join(rootDir, "src/echohunt/e2e/services/e2eService.js");
const mockedModules = new Map();

function mockModule(relativePath, exports) {
  const filename = path.join(rootDir, relativePath);
  mockedModules.set(filename, require.cache[filename]);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const state = {
  activeCampaign: null,
  created: [],
  destroyed: [],
  paymentCalls: [],
  paymentError: null,
  campaignByPk: null,
};

const E2eList = {
  findOne: async () => state.activeCampaign,
  max: async () => 1,
  count: async () => 1,
  destroy: async (options) => {
    state.destroyed.push(options);
    return 1;
  },
  create: async (values, options) => {
    state.created.push({ values, options });
    return values;
  },
  findByPk: async () => state.campaignByPk,
  update: async (values) => {
    if (!state.campaignByPk) return [0];
    Object.assign(state.campaignByPk, values);
    return [1];
  },
};

mockModule("src/models/postgres-start.js", {
  E2eList,
  E2eRecord: {},
  E2eTweet: {},
  pgInstance: {
    transaction: async (callback) => callback({ id: "transaction" }),
  },
});
mockModule("src/echohunt/e2e/services/e2ePaymentService.js", {
  calculateDepositAmounts: (rewards) => ({
    rewards,
    fees: rewards * 0.1,
    depositRewards: rewards * 1.1,
    feePercentage: 10,
  }),
  createExternalPaymentOrder: async (options) => {
    state.paymentCalls.push(options);
    if (state.paymentError) throw state.paymentError;
    return { address: `0x${"a".repeat(40)}` };
  },
  verifyExternalPayment: async () => ({ verified: true }),
});
mockModule("src/echohunt/e2e/services/e2eExamineService.js", {
  parseTweetInput: () => ({ tweetId: "123", handle: "author" }),
  examineE2eTweet: async () => ({
    status: true,
    data: { owner_user_id: "999", owner_handle: "author" },
  }),
});
mockModule("src/xhunt/services/twitter-echohunt.js", {
  getEchohuntTweetDetail: async () => null,
  verifyEchohuntTwitterFollowTask: async () => false,
});
mockModule("src/xhunt/services/campaignRegistrationService.js", {
  fetchCampaignRankByDomain: async () => null,
  rankResultMeetsThreshold: () => false,
});

const { activateE2eCampaign, createE2eCampaign } = require(servicePath);

after(() => {
  delete require.cache[servicePath];
  for (const [filename, previous] of mockedModules) {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  }
});

test("replaces the creator's pending campaign with the next payment sequence", async () => {
  const result = await createE2eCampaign(
    { tweet_id: "123", rewards: 500 },
    { fallbackOwner: { twitterId: "111" } }
  );

  assert.equal(result.status, true);
  assert.equal(result.campaign_sequence, 2);
  assert.equal(state.paymentCalls[0].campaignSequence, 2);
  assert.deepEqual(state.destroyed[0].where, {
    tweet_id: "123",
    user_id: "111",
    status: "pending",
  });
  assert.equal(state.created[0].values.campaign_sequence, 2);
  assert.equal(state.created[0].values.status, "pending");
});

test("persists every create option and ignores a client-supplied creator id", async () => {
  state.activeCampaign = null;
  const createdBefore = state.created.length;

  await createE2eCampaign(
    {
      tweet_id: "123",
      user_id: "attacker-controlled-id",
      rewards: 500,
      days: 2,
      target: 50000,
      winners: 35,
      type: "equal",
      lang: "en",
      retro: false,
    },
    { fallbackOwner: { twitterId: "trusted-user-id" } }
  );

  const saved = state.created[createdBefore].values;
  assert.equal(saved.user_id, "trusted-user-id");
  assert.equal(saved.target, 50000);
  assert.equal(saved.winners, 35);
  assert.equal(saved.type, "equal");
  assert.equal(saved.lang, "en");
  assert.equal(saved.retro, false);
});

test("uses safe defaults for malformed create options", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-26T02:00:00.000Z"),
  });
  state.activeCampaign = null;
  const createdBefore = state.created.length;

  await createE2eCampaign(
    {
      tweet_id: "123",
      rewards: 500,
      days: "2junk",
      target: "not-a-rank",
      winners: "20people",
      type: "unsupported",
      lang: "unsupported",
      retro: "false",
    },
    { fallbackOwner: { twitterId: "111" } }
  );

  const saved = state.created[createdBefore].values;
  assert.equal(saved.end_time.toISOString(), "2026-10-27T15:59:59.999Z");
  assert.equal(saved.target, 200000);
  assert.equal(saved.winners, 20);
  assert.equal(saved.type, "mindshare");
  assert.equal(saved.lang, "all");
  assert.equal(saved.retro, true);
});

test("keeps the old pending campaign when payment order creation fails", async () => {
  const destroyedBefore = state.destroyed.length;
  state.paymentError = new Error("payment unavailable");

  await assert.rejects(
    createE2eCampaign(
      { tweet_id: "123", rewards: 500 },
      { fallbackOwner: { twitterId: "111" } }
    ),
    /payment unavailable/
  );

  assert.equal(state.destroyed.length, destroyedBefore);
  state.paymentError = null;
});

test("still blocks creation while the tweet has an active campaign", async () => {
  const paymentCallsBefore = state.paymentCalls.length;
  state.activeCampaign = { tweet_id: "123", status: "active" };

  const result = await createE2eCampaign(
    { tweet_id: "123", rewards: 500 },
    { fallbackOwner: { twitterId: "111" } }
  );

  assert.equal(result.status, false);
  assert.match(result.message, /进行中/);
  assert.equal(state.paymentCalls.length, paymentCallsBefore);
});

test("one-day campaigns end at 23:59:59 on the next Asia/Shanghai calendar day", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-26T02:00:00.000Z"), // 2026-10-26 10:00:00 Asia/Shanghai
  });
  state.activeCampaign = null;
  const createdBefore = state.created.length;

  await createE2eCampaign(
    { tweet_id: "123", rewards: 500, days: 1 },
    { fallbackOwner: { twitterId: "111" } }
  );

  assert.equal(
    state.created[createdBefore].values.end_time.toISOString(),
    "2026-10-27T15:59:59.999Z"
  );
});

test("one-day campaigns created in the afternoon use the same next-day deadline", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-26T09:00:00.000Z"), // 2026-10-26 17:00:00 Asia/Shanghai
  });
  state.activeCampaign = null;
  const createdBefore = state.created.length;

  await createE2eCampaign(
    { tweet_id: "123", rewards: 500, days: 1 },
    { fallbackOwner: { twitterId: "111" } }
  );

  assert.equal(
    state.created[createdBefore].values.end_time.toISOString(),
    "2026-10-27T15:59:59.999Z"
  );
});

test("two-day campaigns end at 23:59:59 two Asia/Shanghai calendar days later", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-26T09:00:00.000Z"),
  });
  state.activeCampaign = null;
  const createdBefore = state.created.length;

  await createE2eCampaign(
    { tweet_id: "123", rewards: 500, days: 2 },
    { fallbackOwner: { twitterId: "111" } }
  );

  assert.equal(
    state.created[createdBefore].values.end_time.toISOString(),
    "2026-10-28T15:59:59.999Z"
  );
});

test("missing duration defaults to one calendar day", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-26T02:00:00.000Z"),
  });
  state.activeCampaign = null;
  const createdBefore = state.created.length;

  await createE2eCampaign(
    { tweet_id: "123", rewards: 500 },
    { fallbackOwner: { twitterId: "111" } }
  );

  assert.equal(
    state.created[createdBefore].values.end_time.toISOString(),
    "2026-10-27T15:59:59.999Z"
  );
});

test("activation keeps the calendar-day deadline selected at creation", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-26T03:00:00.000Z"),
  });
  state.activeCampaign = null;
  state.campaignByPk = {
    address: "0x1111111111111111111111111111111111111111",
    status: "pending",
    rewards: 500,
    fees: 100,
    start_time: new Date("2026-10-26T02:00:00.000Z"),
    end_time: new Date("2026-10-27T15:59:59.999Z"),
    toJSON() { return { ...this }; },
  };

  const result = await activateE2eCampaign({ address: state.campaignByPk.address });

  assert.equal(result.status, true);
  assert.equal(state.campaignByPk.start_time.toISOString(), "2026-10-26T03:00:00.000Z");
  assert.equal(state.campaignByPk.end_time.toISOString(), "2026-10-27T15:59:59.999Z");
});
