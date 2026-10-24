const axios = require("axios");
const { DATA_SERVICE_BASE_URL } = require("../../../xhunt/constants/dataService");

const DEFAULT_FEE_PERCENTAGE = Number(process.env.E2E_FEE_PERCENTAGE || 10);
const E2E_V2_API_BASE_URL = String(
  process.env.E2E_V2_API_BASE_URL || `${DATA_SERVICE_BASE_URL}/e2e_v2`
).replace(/\/+$/, "");
const E2E_V2_API_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.E2E_V2_API_TIMEOUT_MS || 10000) || 10000
);
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

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

function createPaymentError(code, status, message, upstreamStatus = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (upstreamStatus !== null) error.upstreamStatus = upstreamStatus;
  return error;
}

function getE2eV2RequestConfig() {
  const apiKey = String(process.env.E2E_V2_API_KEY || "").trim();
  if (!apiKey) {
    throw createPaymentError(
      "E2E_PAYMENT_CONFIG_MISSING",
      503,
      "E2E 支付服务配置缺失"
    );
  }
  return {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    timeout: E2E_V2_API_TIMEOUT_MS,
  };
}

function normalizeUsdcAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw createPaymentError("E2E_PAYMENT_INVALID_AMOUNT", 400, "无效的 E2E 支付金额");
  }
  return amount.toFixed(6);
}

function normalizePaymentApiError(error, fallbackMessage) {
  if (error?.code && String(error.code).startsWith("E2E_PAYMENT_")) return error;
  const upstreamStatus = Number(error?.response?.status) || null;
  const status = [400, 404, 409].includes(upstreamStatus)
    ? upstreamStatus
    : [401, 503].includes(upstreamStatus)
      ? 503
      : 502;
  return createPaymentError(
    "E2E_PAYMENT_API_ERROR",
    status,
    fallbackMessage,
    upstreamStatus
  );
}

function validatePaymentResponse(data, expectedAddress = null) {
  const address = String(data?.address || "").trim();
  if (data?.status !== true || !EVM_ADDRESS_PATTERN.test(address)) {
    throw createPaymentError(
      "E2E_PAYMENT_INVALID_RESPONSE",
      502,
      "E2E 支付服务返回了无效数据"
    );
  }
  if (expectedAddress && address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw createPaymentError(
      "E2E_PAYMENT_ADDRESS_MISMATCH",
      502,
      "E2E 支付服务返回的活动地址不匹配"
    );
  }
  return { ...data, address };
}

function normalizeResponseUsdcAmount(value) {
  try {
    return normalizeUsdcAmount(value);
  } catch {
    throw createPaymentError(
      "E2E_PAYMENT_INVALID_RESPONSE",
      502,
      "E2E 支付服务返回了无效金额"
    );
  }
}

async function createExternalPaymentOrder({
  tweetId,
  payerUserId,
  campaignSequence,
  depositRewards,
} = {}) {
  const normalizedTweetId = String(tweetId || "").trim();
  if (!normalizedTweetId) {
    throw createPaymentError("E2E_PAYMENT_EXTERNAL_ID_REQUIRED", 400, "缺少 E2E 支付活动标识");
  }
  const normalizedPayerUserId = String(payerUserId || "").trim();
  if (!normalizedPayerUserId) {
    throw createPaymentError("E2E_PAYMENT_PAYER_REQUIRED", 400, "缺少 E2E 投放人标识");
  }
  const normalizedSequence = Number(campaignSequence);
  if (!Number.isSafeInteger(normalizedSequence) || normalizedSequence <= 0) {
    throw createPaymentError("E2E_PAYMENT_SEQUENCE_INVALID", 400, "无效的 E2E 投放批次");
  }

  const depositAmount = normalizeUsdcAmount(depositRewards);
  const externalId = `echohunt-e2e:${normalizedTweetId}:${normalizedPayerUserId}:${normalizedSequence}`;
  try {
    const response = await axios.post(
      `${E2E_V2_API_BASE_URL}/`,
      {
        external_id: externalId,
        deposit_amount: depositAmount,
      },
      getE2eV2RequestConfig()
    );
    const data = validatePaymentResponse(response?.data);
    if (normalizeResponseUsdcAmount(data.deposit_amount) !== depositAmount) {
      throw createPaymentError(
        "E2E_PAYMENT_AMOUNT_MISMATCH",
        502,
        "E2E 支付服务返回的充值金额不匹配"
      );
    }
    return data;
  } catch (error) {
    throw normalizePaymentApiError(error, "创建 E2E 支付订单失败，请稍后重试");
  }
}

async function verifyExternalPayment({ address, requiredAmount } = {}) {
  const normalizedAddress = String(address || "").trim();
  if (!EVM_ADDRESS_PATTERN.test(normalizedAddress)) {
    throw createPaymentError("E2E_PAYMENT_INVALID_ADDRESS", 400, "无效的 E2E 收款地址");
  }

  const expectedAmount = normalizeUsdcAmount(requiredAmount);
  try {
    const response = await axios.get(
      `${E2E_V2_API_BASE_URL}/${encodeURIComponent(normalizedAddress)}`,
      getE2eV2RequestConfig()
    );
    const data = validatePaymentResponse(response?.data, normalizedAddress);
    const required = normalizeResponseUsdcAmount(data.deposit_amount);
    if (required !== expectedAmount) {
      throw createPaymentError(
        "E2E_PAYMENT_AMOUNT_MISMATCH",
        502,
        "E2E 支付订单金额与任务金额不匹配"
      );
    }
    return {
      verified: data.paid === true,
      funded: data.funded === true,
      paid: data.paid === true,
      balance: data.balance ?? null,
      required,
      message: data.paid === true ? "支付已确认" : "支付尚未到账，请稍后重试",
    };
  } catch (error) {
    throw normalizePaymentApiError(error, "查询 E2E 支付状态失败，请稍后重试");
  }
}

function normalizeDistributionResponse(data, expectedAddress) {
  const normalized = validatePaymentResponse(data, expectedAddress);
  const distributionStatus = String(normalized.distribution_status || "pending").toLowerCase();
  if (!["pending", "prepared", "submitted", "confirmed", "failed"].includes(distributionStatus)) {
    throw createPaymentError("E2E_PAYMENT_INVALID_RESPONSE", 502, "E2E 支付服务返回了无效交易状态");
  }
  const txHash = normalized.tx_hash ? String(normalized.tx_hash) : null;
  if (distributionStatus !== "pending" && (!txHash || !TX_HASH_PATTERN.test(txHash))) {
    throw createPaymentError("E2E_PAYMENT_INVALID_RESPONSE", 502, "E2E 支付服务未返回有效交易哈希");
  }
  return { ...normalized, distribution_status: distributionStatus, tx_hash: txHash };
}

async function submitExternalDistribution({ address, recipients } = {}) {
  const normalizedAddress = String(address || "").trim();
  if (!EVM_ADDRESS_PATTERN.test(normalizedAddress)) {
    throw createPaymentError("E2E_PAYMENT_INVALID_ADDRESS", 400, "无效的 E2E 活动地址");
  }
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 500) {
    throw createPaymentError("E2E_PAYMENT_INVALID_RECIPIENTS", 400, "E2E 分发地址数量必须为 1-500");
  }
  try {
    const response = await axios.post(
      `${E2E_V2_API_BASE_URL}/${encodeURIComponent(normalizedAddress)}/distribution`,
      { recipients },
      getE2eV2RequestConfig()
    );
    return normalizeDistributionResponse(response?.data, normalizedAddress);
  } catch (error) {
    throw normalizePaymentApiError(error, "提交 E2E 奖励分发失败，请稍后重试");
  }
}

async function getExternalDistributionStatus(address) {
  const normalizedAddress = String(address || "").trim();
  if (!EVM_ADDRESS_PATTERN.test(normalizedAddress)) {
    throw createPaymentError("E2E_PAYMENT_INVALID_ADDRESS", 400, "无效的 E2E 活动地址");
  }
  try {
    const response = await axios.get(
      `${E2E_V2_API_BASE_URL}/${encodeURIComponent(normalizedAddress)}`,
      getE2eV2RequestConfig()
    );
    return normalizeDistributionResponse(response?.data, normalizedAddress);
  } catch (error) {
    throw normalizePaymentApiError(error, "查询 E2E 分发状态失败，请稍后重试");
  }
}

module.exports = {
  DEFAULT_FEE_PERCENTAGE,
  E2E_V2_API_BASE_URL,
  calculateDepositAmounts,
  createExternalPaymentOrder,
  getExternalDistributionStatus,
  submitExternalDistribution,
  verifyExternalPayment,
};
