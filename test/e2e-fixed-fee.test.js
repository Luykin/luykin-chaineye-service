const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const servicePath = path.join(rootDir, "src/echohunt/e2e/services/e2ePaymentService.js");
const previousFeePercentage = process.env.E2E_FEE_PERCENTAGE;

process.env.E2E_FEE_PERCENTAGE = "99";
delete require.cache[servicePath];
const { DEFAULT_FEE_PERCENTAGE, calculateDepositAmounts } = require(servicePath);

test.after(() => {
  delete require.cache[servicePath];
  if (previousFeePercentage === undefined) delete process.env.E2E_FEE_PERCENTAGE;
  else process.env.E2E_FEE_PERCENTAGE = previousFeePercentage;
});

test("uses a fixed 20 percent E2E service fee regardless of environment configuration", () => {
  assert.equal(DEFAULT_FEE_PERCENTAGE, 20);
  assert.deepEqual(calculateDepositAmounts(500), {
    rewards: 500,
    fees: 100,
    depositRewards: 600,
    feePercentage: 20,
  });
});
