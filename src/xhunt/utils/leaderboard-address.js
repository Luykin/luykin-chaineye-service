const { utils: ethersUtils } = require("ethers");
const chainContract = require("../../../shared/xhunt/leaderboard-address-chain-contract.json");

const SUPPORTED_CHAIN_IDS = new Set(chainContract.chains.map((item) => item.id));
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(Array.from(BASE58_ALPHABET).map((char, index) => [char, index]));

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

function decodeBase58(value) {
  let number = 0n;
  for (const char of value) {
    const digit = BASE58_INDEX.get(char);
    if (digit === undefined) return null;
    number = number * 58n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number % 256n));
    number /= 256n;
  }
  bytes.reverse();
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === "1") leadingZeroes += 1;
  return Buffer.from([...new Array(leadingZeroes).fill(0), ...bytes]);
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
    try {
      return { valid: true, chain: normalizedChain, address, addressNormalized: ethersUtils.getAddress(address) };
    } catch (_) {
      return { valid: false, code: "INVALID_SUBMISSION_ADDRESS" };
    }
  }

  if (normalizedChain === "solana") {
    const decoded = decodeBase58(address);
    if (!decoded || decoded.length !== 32) return { valid: false, code: "INVALID_SUBMISSION_ADDRESS" };
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
