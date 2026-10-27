const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const servicePath = path.join(rootDir, "src/echohunt/e2e/services/e2eSettlementService.js");
const modelsPath = path.join(rootDir, "src/models/postgres-start.js");
const paymentServicePath = path.join(rootDir, "src/echohunt/e2e/services/e2ePaymentService.js");
const previousModels = require.cache[modelsPath];
const previousPaymentService = require.cache[paymentServicePath];
let settlementItems = [];
let distributionExecution = null;
const submissionTxHash = `0x${"a".repeat(64)}`;

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
    E2eList: {
      findByPk: async () => campaign,
      update: async (values) => {
        Object.assign(campaign, values);
        return [1];
      },
    },
    E2eRecord: {},
    E2eSettlement: { findOne: async () => settlement },
    E2eSettlementItem: { findAll: async () => settlementItems },
    pgInstance: { transaction: async (callback) => callback({ LOCK: { UPDATE: "UPDATE" } }) },
  },
};
require.cache[paymentServicePath] = {
  id: paymentServicePath,
  filename: paymentServicePath,
  loaded: true,
  exports: {
    getExternalDistributionExecutionInfo: async () => distributionExecution,
    getExternalDistributionStatus: async () => ({
      distribution_status: "confirmed",
      tx_hash: submissionTxHash,
    }),
    submitExternalDistribution: async () => ({
      distribution_status: "confirmed",
      tx_hash: submissionTxHash,
    }),
  },
};

delete require.cache[servicePath];
const {
  approveSettlement,
  refreshSettlementDistribution,
  submitSettlementDistribution,
} = require(servicePath);

test.beforeEach(() => {
  Object.assign(campaign, { status: "review", complete_tx: null });
  Object.assign(settlement, {
    status: "draft",
    fee_amount: "100.000000",
    deposit_amount: "600.000000",
    distribution_status: "pending",
    distribution_recipients: null,
    approved_by: null,
    tx_hash: null,
    confirmed_at: null,
    provider_response: null,
  });
  settlementItems = [];
  distributionExecution = null;
});

test.after(() => {
  delete require.cache[servicePath];
  if (previousModels) require.cache[modelsPath] = previousModels;
  else delete require.cache[modelsPath];
  if (previousPaymentService) require.cache[paymentServicePath] = previousPaymentService;
  else delete require.cache[paymentServicePath];
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

test("a confirmed list-submission transaction does not complete the campaign before payout execution", async () => {
  settlement.status = "approved";
  settlement.distribution_recipients = [{
    address: "0x2222222222222222222222222222222222222222",
    amount: "500.000000",
  }];
  distributionExecution = { phase: "waiting" };

  const result = await submitSettlementDistribution(campaign.address, { id: 9, email: "reviewer@example.com" });

  assert.equal(result.status, "submitted");
  assert.equal(result.distribution_status, "confirmed");
  assert.equal(campaign.status, "review");
  assert.equal(campaign.complete_tx, null);
});

test("the campaign completes after on-chain payout execution is observed", async () => {
  settlement.status = "submitted";
  settlement.tx_hash = submissionTxHash;
  distributionExecution = { phase: "executed" };

  const result = await refreshSettlementDistribution(campaign.address);

  assert.equal(result.status, "confirmed");
  assert.equal(campaign.status, "complete");
  assert.equal(campaign.complete_tx, submissionTxHash);
});

test("refresh repairs a campaign that was completed by list submission alone", async () => {
  campaign.status = "complete";
  campaign.complete_tx = submissionTxHash;
  settlement.status = "confirmed";
  settlement.tx_hash = submissionTxHash;
  distributionExecution = { phase: "waiting" };

  const result = await refreshSettlementDistribution(campaign.address);

  assert.equal(result.status, "submitted");
  assert.equal(campaign.status, "review");
  assert.equal(campaign.complete_tx, null);
});

test("an unverified chain state cannot preserve completion from list submission alone", async () => {
  campaign.status = "complete";
  campaign.complete_tx = submissionTxHash;
  settlement.status = "confirmed";
  settlement.tx_hash = submissionTxHash;
  distributionExecution = null;

  const result = await refreshSettlementDistribution(campaign.address);

  assert.equal(result.status, "submitted");
  assert.equal(campaign.status, "review");
  assert.equal(campaign.complete_tx, null);
});

test("stored payout execution evidence survives a temporary chain RPC failure", async () => {
  campaign.status = "complete";
  campaign.complete_tx = submissionTxHash;
  settlement.status = "confirmed";
  settlement.tx_hash = submissionTxHash;
  settlement.provider_response = { distribution_execution: { phase: "executed" } };
  distributionExecution = null;

  const result = await refreshSettlementDistribution(campaign.address);

  assert.equal(result.status, "confirmed");
  assert.equal(campaign.status, "complete");
  assert.equal(campaign.complete_tx, submissionTxHash);
});
