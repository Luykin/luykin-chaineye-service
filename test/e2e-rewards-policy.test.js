const assert = require("node:assert/strict");
const test = require("node:test");
const {
  validateE2eCampaignRewards,
} = require("../src/echohunt/e2e/services/e2eRewardsPolicy");

test("requires public users to create campaigns between 500 and 2000 USDC", () => {
  assert.equal(validateE2eCampaignRewards(499.99).valid, false);
  assert.deepEqual(validateE2eCampaignRewards(500), { valid: true, rewards: 500 });
  assert.deepEqual(validateE2eCampaignRewards(2000), { valid: true, rewards: 2000 });
  assert.equal(validateE2eCampaignRewards(2000.01).valid, false);
});

test("allows internal test users to create campaigns below 500 USDC", () => {
  const options = { isInternalTestUser: true };
  assert.deepEqual(validateE2eCampaignRewards(0.01, options), { valid: true, rewards: 0.01 });
  assert.equal(validateE2eCampaignRewards(0, options).valid, false);
  assert.equal(validateE2eCampaignRewards(2000.01, options).valid, false);
});
