const { utils: ethersUtils } = require("ethers");
const chainContract = require("../../../shared/xhunt/leaderboard-address-chain-contract.json");

const SUPPORTED_CHAIN_IDS = new Set(chainContract.chains.map((item) => item.id));
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isLeaderboardSubmissionAddressMode(campaign) {
  return campaign?.addressCollectionMode === "leaderboard_submission";
}

function normalizeAddressInputConfig(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const supportedChains = Array.from(new Set(
    (Array.isArray(source.supportedChains) ? source.supportedChains : [])
      .map((item) => String(item || "").trim().toLowerCase())
      .filter((item) => SUPPORTED_CHAIN_IDS.has(item))
  ));
  const recommendedChainValue = String(source.recommendedChain || "").trim().toLowerCase();
  return {
    supportedChains,
    recommendedChain: supportedChains.includes(recommendedChainValue) ? recommendedChainValue : null,
  };
}

function getAddressInputConfigErrors(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const config = normalizeAddressInputConfig(value);
  const errors = [];
  const rawSupportedChains = (Array.isArray(source.supportedChains) ? source.supportedChains : [])
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);
  if (!config.supportedChains.length) errors.push("supportedChains");
  if (rawSupportedChains.some((item) => !SUPPORTED_CHAIN_IDS.has(item))) {
    errors.push("supportedChains.unsupported");
  }
  const rawRecommendedChain = String(source.recommendedChain || "").trim().toLowerCase();
  if (rawRecommendedChain && !config.supportedChains.includes(rawRecommendedChain)) {
    errors.push("recommendedChain");
  }
  return { config, errors };
}

function normalizeChainAddress(chain, rawAddress) {
  const normalizedChain = String(chain || "").trim().toLowerCase();
  const address = String(rawAddress || "").trim();
  if (!SUPPORTED_CHAIN_IDS.has(normalizedChain)) {
    return { valid: false, code: "UNSUPPORTED_ADDRESS_CHAIN" };
  }
  if (!address || address.length > chainContract.addressMaxLength) {
    return { valid: false, code: "INVALID_SUBMISSION_ADDRESS" };
  }

  if (normalizedChain === "bsc" || normalizedChain === "monad") {
    if (!EVM_ADDRESS_PATTERN.test(address)) {
      return { valid: false, code: "INVALID_SUBMISSION_ADDRESS" };
    }
    try {
      // 投稿只校验基础格式，不要求用户输入符合 EIP-55 checksum；仍生成稳定 checksum 值用于比较。
      return {
        valid: true,
        chain: normalizedChain,
        address,
        addressNormalized: ethersUtils.getAddress(address.toLowerCase()),
      };
    } catch (_) {
      return { valid: false, code: "INVALID_SUBMISSION_ADDRESS" };
    }
  }

  if (normalizedChain === "solana") {
    // 仅做常用长度和 Base58 字符检查，不进行公钥解码或链上查询。
    if (!SOLANA_ADDRESS_PATTERN.test(address)) {
      return { valid: false, code: "INVALID_SUBMISSION_ADDRESS" };
    }
    return { valid: true, chain: normalizedChain, address, addressNormalized: address };
  }

  const match = address.match(/^0x([0-9a-fA-F]{1,64})$/);
  if (!match) return { valid: false, code: "INVALID_SUBMISSION_ADDRESS" };
  return {
    valid: true,
    chain: normalizedChain,
    address,
    addressNormalized: `0x${match[1].toLowerCase().padStart(64, "0")}`,
  };
}

function validateConfiguredChainAddress(addressInput, chain, rawAddress) {
  const { config, errors } = getAddressInputConfigErrors(addressInput);
  if (errors.length) return { valid: false, code: "ADDRESS_INPUT_CONFIG_INVALID", configErrors: errors };
  const result = normalizeChainAddress(chain, rawAddress);
  if (!result.valid) return result;
  if (!config.supportedChains.includes(result.chain)) {
    return { valid: false, code: "UNSUPPORTED_ADDRESS_CHAIN" };
  }
  return { ...result, config };
}

module.exports = {
  SUPPORTED_CHAIN_IDS,
  getAddressInputConfigErrors,
  isLeaderboardSubmissionAddressMode,
  normalizeAddressInputConfig,
  normalizeChainAddress,
  validateConfiguredChainAddress,
};
