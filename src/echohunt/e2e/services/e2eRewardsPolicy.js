const MIN_PUBLIC_CAMPAIGN_REWARDS = 500;
const MAX_CAMPAIGN_REWARDS = 2000;

function validateE2eCampaignRewards(value, { isInternalTestUser = false } = {}) {
  const rewards = Number(value);
  const valid = Number.isFinite(rewards)
    && rewards <= MAX_CAMPAIGN_REWARDS
    && (isInternalTestUser ? rewards > 0 : rewards >= MIN_PUBLIC_CAMPAIGN_REWARDS);

  if (valid) return { valid: true, rewards };

  const rewardsRange = isInternalTestUser
    ? `大于 0 且不超过 ${MAX_CAMPAIGN_REWARDS}`
    : `${MIN_PUBLIC_CAMPAIGN_REWARDS}-${MAX_CAMPAIGN_REWARDS}`;
  return {
    valid: false,
    message: `奖池金额必须在 ${rewardsRange} USDC 范围内`,
  };
}

module.exports = {
  validateE2eCampaignRewards,
};
