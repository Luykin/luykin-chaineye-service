const DEFAULT_FEE_PERCENTAGE = Number(process.env.E2E_FEE_PERCENTAGE || 10);

/**
 * 计算活动服务费与总充值金额
 * @param {number} rewards 奖池金额 (USDC)
 */
function calculateDepositAmounts(rewards) {
  const cleanRewards = Number(rewards);
  if (!Number.isFinite(cleanRewards) || cleanRewards <= 0) {
    throw new Error("INVALID_REWARDS_AMOUNT");
  }
  const feePercentage = DEFAULT_FEE_PERCENTAGE;
  const fees = Number(((cleanRewards * feePercentage) / 100).toFixed(6));
  const depositRewards = Number((cleanRewards + fees).toFixed(6));
  return {
    rewards: cleanRewards,
    fees,
    depositRewards,
    feePercentage,
  };
}

function createPaymentIntegrationPendingError() {
  const error = new Error("E2E 外部支付接口尚未接入");
  error.code = "E2E_PAYMENT_INTEGRATION_PENDING";
  error.status = 501;
  return error;
}

async function createExternalPaymentOrder() {
  // TODO: 请求外部支付接口创建订单，并返回收款地址等信息。
  throw createPaymentIntegrationPendingError();
}

async function verifyExternalPayment() {
  // TODO: 请求外部支付接口校验到账状态。
  throw createPaymentIntegrationPendingError();
}

module.exports = {
  DEFAULT_FEE_PERCENTAGE,
  calculateDepositAmounts,
  createExternalPaymentOrder,
  verifyExternalPayment,
};
