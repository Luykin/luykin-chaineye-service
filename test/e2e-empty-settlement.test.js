const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const servicePath = path.join(rootDir, "src/echohunt/e2e/services/e2eSettlementService.js");
const modelsPath = path.join(rootDir, "src/models/postgres-start.js");
const previousModels = require.cache[modelsPath];
let settlementItems = [];

const campaign = {
  address: "0x1111111111111111111111111111111111111111",
  status: "review",
  complete_tx: null,
  async update(values) {
    Object.assign(this, values);
    return this;
  },
};

const settlement = {
  id: "settlement-1",
  campaign_address: campaign.address,
  status: "draft",
  fee_amount: "100.000000",
  deposit_amount: "600.000000",
  distribution_status: "pending",
  async update(values) {
    Object.assign(this, values);
    return this;
  },
};

require.cache[modelsPath] = {
  id: modelsPath,
  filename: modelsPath,
  loaded: true,
  exports: {
    E2eList: { findByPk: async () => campaign },
    E2eRecord: {},
    E2eSettlement: { findOne: async () => settlement },
    E2eSettlementItem: { findAll: async () => settlementItems },
    pgInstance: { transaction: async (callback) => callback({ LOCK: { UPDATE: "UPDATE" } }) },
  },
};

delete require.cache[servicePath];
const { approveSettlement } = require(servicePath);

test.beforeEach(() => {
  Object.assign(campaign, { status: "review", complete_tx: null });
  Object.assign(settlement, {
    status: "draft",
    fee_amount: "100.000000",
    deposit_amount: "600.000000",
    distribution_status: "pending",
    distribution_recipients: null,
    approved_by: null,
  });
  settlementItems = [];
});

test.after(() => {
  delete require.cache[servicePath];
  if (previousModels) require.cache[modelsPath] = previousModels;
  else delete require.cache[modelsPath];
});

test("approving an empty settlement completes the campaign without distribution", async () => {
  const result = await approveSettlement(campaign.address, { id: 7, email: "reviewer@example.com" });

  assert.equal(result.status, "completed_no_payout");
  assert.equal(result.distribution_status, "not_required");
  assert.deepEqual(result.distribution_recipients, []);
  assert.equal(result.approved_by, 7);
  assert.equal(campaign.status, "complete");
  assert.equal(campaign.complete_tx, null);
});

test("approving a settlement with participants but no winners also completes without distribution", async () => {
  settlementItems = [{
    is_winner: false,
    excluded: false,
    reward_amount: "0.000000",
    payout_address: null,
  }];

  const result = await approveSettlement(campaign.address, { id: 8, email: "reviewer@example.com" });

  assert.equal(result.status, "completed_no_payout");
  assert.equal(result.distribution_status, "not_required");
  assert.equal(campaign.status, "complete");
});

test("approving a settlement with a winner still waits for chain distribution", async () => {
  settlement.fee_amount = "0.000000";
  settlement.deposit_amount = "500.000000";
  settlementItems = [{
    is_winner: true,
    excluded: false,
    reward_amount: "500.000000",
    payout_address: "0x2222222222222222222222222222222222222222",
  }];

  const result = await approveSettlement(campaign.address, { id: 9, email: "reviewer@example.com" });

  assert.equal(result.status, "approved");
  assert.equal(campaign.status, "review");
  assert.deepEqual(result.distribution_recipients, [{
    address: "0x2222222222222222222222222222222222222222",
    amount: "500.000000",
  }]);
});
