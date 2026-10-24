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

const { createE2eCampaign } = require(servicePath);

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
