const assert = require("node:assert/strict");
const path = require("node:path");
const { after, beforeEach, test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");
const servicePath = path.join(rootDir, "src/echohunt/e2e/services/e2eService.js");
const mockedModules = new Map();
const originalFeeRecipientAddress = process.env.E2E_FEE_RECIPIENT_ADDRESS;

function mockModule(relativePath, exports) {
  const filename = path.join(rootDir, relativePath);
  mockedModules.set(filename, require.cache[filename]);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const campaign = {
  address: `0x${"1".repeat(40)}`,
  tweet_id: "tweet-1",
  status: "active",
  target: 1000,
  owner_handle: "author",
};

const state = {
  existingRegistration: null,
  payoutAddressRegistration: null,
  createError: null,
  created: [],
};

const E2eRecord = {
  findOne: async ({ where }) => {
    if (where.user_id) return state.existingRegistration;
    state.lastPayoutAddressWhere = where;
    return state.payoutAddressRegistration;
  },
  create: async (values) => {
    if (state.createError) {
      const error = state.createError;
      state.createError = null;
      state.payoutAddressRegistration = { user_id: "participant-2" };
      throw error;
    }
    state.created.push(values);
    return {
      ...values,
      toJSON() { return { ...values }; },
    };
  },
};

mockModule("src/models/postgres-start.js", {
  E2eList: {
    findByPk: async () => campaign,
  },
  E2eRecord,
  E2eTweet: {},
  pgInstance: {},
});
mockModule("src/echohunt/e2e/services/e2ePaymentService.js", {
  calculateDepositAmounts: () => ({}),
  createExternalPaymentOrder: async () => ({}),
  verifyExternalPayment: async () => ({ verified: true }),
});
mockModule("src/echohunt/e2e/services/e2eExamineService.js", {
  parseTweetInput: () => ({}),
  examineE2eTweet: async () => ({ status: true }),
});
mockModule("src/xhunt/services/twitter-echohunt.js", {
  getEchohuntTweetDetail: async () => ({ authorId: "author-twitter-id" }),
  verifyEchohuntTwitterFollowTask: async () => ({ verified: true }),
});
mockModule("src/xhunt/services/campaignRegistrationService.js", {
  evaluateRankEligibility: async () => ({
    status: "ELIGIBLE",
    ranks: [{ domain: "web3", kolRank: 100 }],
  }),
});

delete require.cache[servicePath];
const { registerE2eParticipant } = require(servicePath);

beforeEach(() => {
  process.env.E2E_FEE_RECIPIENT_ADDRESS = `0x${"f".repeat(40)}`;
  state.existingRegistration = null;
  state.payoutAddressRegistration = null;
  state.createError = null;
  state.lastPayoutAddressWhere = null;
  state.created = [];
});

after(() => {
  delete require.cache[servicePath];
  for (const [filename, previous] of mockedModules) {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  }
  if (originalFeeRecipientAddress === undefined) delete process.env.E2E_FEE_RECIPIENT_ADDRESS;
  else process.env.E2E_FEE_RECIPIENT_ADDRESS = originalFeeRecipientAddress;
});

function register(userAddress, userId = "participant-1") {
  return registerE2eParticipant({
    address: campaign.address,
    user_id: userId,
    user_address: userAddress,
    username: "participant",
  }, {
    identity: { provider: "twitter" },
  });
}

test("rejects a payout address already used by another participant in the campaign", async () => {
  const payoutAddress = `0x${"aB".repeat(20)}`;
  state.payoutAddressRegistration = { user_id: "participant-2" };

  await assert.rejects(register(payoutAddress), (error) => {
    assert.equal(error.code, "E2E_PAYOUT_ADDRESS_IN_USE");
    assert.equal(error.status, 409);
    return true;
  });

  assert.equal(state.lastPayoutAddressWhere.address, campaign.address);
  assert.equal(state.created.length, 0);
});

test("rejects the configured service fee recipient address case-insensitively", async () => {
  process.env.E2E_FEE_RECIPIENT_ADDRESS = `0x${"aB".repeat(20)}`;

  await assert.rejects(register(`0x${"Ab".repeat(20)}`), (error) => {
    assert.equal(error.code, "E2E_FEE_RECIPIENT_ADDRESS_NOT_ALLOWED");
    assert.equal(error.status, 400);
    return true;
  });

  assert.equal(state.created.length, 0);
});

test("fails closed when the service fee recipient address is unavailable", async () => {
  delete process.env.E2E_FEE_RECIPIENT_ADDRESS;

  await assert.rejects(register(`0x${"d".repeat(40)}`), (error) => {
    assert.equal(error.code, "E2E_FEE_RECIPIENT_MISSING");
    assert.equal(error.status, 503);
    return true;
  });

  assert.equal(state.created.length, 0);
});

test("normalizes a valid payout address before saving it", async () => {
  const payoutAddress = `0x${"aB".repeat(20)}`;

  const result = await register(payoutAddress);

  assert.equal(result.success, true);
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0].user_address, payoutAddress.toLowerCase());
});

test("maps a concurrent payout-address unique conflict to the registration error", async () => {
  const uniqueError = new Error("duplicate key value violates unique constraint");
  uniqueError.name = "SequelizeUniqueConstraintError";
  state.createError = uniqueError;

  await assert.rejects(register(`0x${"c".repeat(40)}`), (error) => {
    assert.equal(error.code, "E2E_PAYOUT_ADDRESS_IN_USE");
    assert.equal(error.status, 409);
    return true;
  });
});
