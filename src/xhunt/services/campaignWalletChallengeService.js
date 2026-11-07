const crypto = require("crypto");
const { randomUUID } = require("crypto");
const { getCampaignWalletChain } = require("../constants/campaignWalletChains");
const {
  getCampaignWalletRegistration,
  getCampaignEnglishTitle,
  getEchohuntWebBaseUrl,
} = require("./campaignWalletConfigService");
const { normalizeWalletAddress, verifyWalletMessage } = require("./campaignWalletVerificationService");
const { campaignRegistrationError } = require("./campaignRegistrationService");

const CHALLENGE_TTL_SECONDS = 5 * 60;
const MESSAGE_VERSION = 1;

function challengeScopeKey({ campaignKey, user, chain, normalizedAddress }) {
  const scope = JSON.stringify([
    String(campaignKey || "").trim(),
    String(user?.authCenterUserId || ""),
    String(user?.twitterId || ""),
    String(chain || "").trim().toLowerCase(),
    String(normalizedAddress || ""),
  ]);
  const digest = crypto.createHash("sha256").update(scope).digest("hex");
  return `xhunt:campaign-wallet-registration:challenge:${digest}`;
}

function getExpectedOrigin() {
  try {
    return new URL(getEchohuntWebBaseUrl()).origin;
  } catch (_) {
    return "https://app.echohunt.ai";
  }
}

function buildWalletRegistrationMessage({ title, networkName, address, challengeId, nonce, issuedAt, expiresAt }) {
  return [
    "XHunt Campaign Wallet Registration",
    "",
    `Campaign: ${title}`,
    `Network: ${networkName}`,
    `Wallet Address: ${address}`,
    "",
    "This wallet will be bound to this campaign and cannot be changed after registration.",
    "This request does not trigger a blockchain transaction or cost gas.",
    "",
    `Request ID: ${challengeId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiresAt}`,
    `Origin: ${getExpectedOrigin()}`,
  ].join("\n");
}

async function createWalletRegistrationChallenge({ redisClient, campaignKey, campaignConfig, user, chain, address }) {
  if (!redisClient?.setEx) {
    throw campaignRegistrationError("WALLET_CHALLENGE_UNAVAILABLE", 503, "Wallet verification is temporarily unavailable");
  }
  if (typeof redisClient.incr === "function") {
    const rateKey = `xhunt:campaign-wallet-registration:rate:${String(user?.authCenterUserId || "unknown")}:${String(campaignKey || "unknown")}`;
    const attempts = await redisClient.incr(rateKey);
    if (attempts === 1 && typeof redisClient.expire === "function") {
      await redisClient.expire(rateKey, 60);
    }
    if (attempts > 10) {
      throw campaignRegistrationError("TOO_FREQUENT", 429, "Too many wallet challenge requests. Please try again later.");
    }
  }
  const registrationConfig = getCampaignWalletRegistration(campaignConfig);
  if (!registrationConfig.enabled) {
    throw campaignRegistrationError("WALLET_REGISTRATION_NOT_ENABLED", 400, "Wallet registration is not enabled");
  }
  if (!registrationConfig.signatureRequired) {
    throw campaignRegistrationError("WALLET_SIGNATURE_NOT_REQUIRED", 400, "This campaign does not require a wallet signature");
  }
  const normalizedChain = String(chain || "").trim().toLowerCase();
  if (!registrationConfig.supportedChains.includes(normalizedChain)) {
    throw campaignRegistrationError("WALLET_CHAIN_NOT_SUPPORTED", 400, "Wallet chain is not supported by this campaign");
  }
  const chainConfig = getCampaignWalletChain(normalizedChain);
  const normalizedAddress = normalizeWalletAddress(normalizedChain, address);
  const redisKey = challengeScopeKey({
    campaignKey,
    user,
    chain: normalizedChain,
    normalizedAddress: normalizedAddress.normalizedAddress,
  });
  const title = getCampaignEnglishTitle(campaignConfig);
  if (!title) {
    throw campaignRegistrationError("CAMPAIGN_ENGLISH_TITLE_REQUIRED", 400, "Campaign English title is required");
  }
  const challengeId = randomUUID();
  const nonce = crypto.randomBytes(16).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_SECONDS * 1000);
  const message = buildWalletRegistrationMessage({
    title,
    networkName: chainConfig.displayName,
    address: normalizedAddress.address,
    challengeId,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const stored = {
    challengeId,
    messageVersion: MESSAGE_VERSION,
    campaignKey: String(campaignKey || "").trim(),
    authCenterUserId: String(user?.authCenterUserId || ""),
    twitterId: String(user?.twitterId || ""),
    chain: normalizedChain,
    address: normalizedAddress.address,
    normalizedAddress: normalizedAddress.normalizedAddress,
    titleSnapshot: title,
    signatureType: chainConfig.signatureType,
    message,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  // 同一用户、活动、链和地址只保留一个 challenge；SET 会原子覆盖旧值。
  await redisClient.setEx(redisKey, CHALLENGE_TTL_SECONDS, JSON.stringify(stored));
  return {
    challengeId,
    messageVersion: MESSAGE_VERSION,
    message,
    chain: normalizedChain,
    address: normalizedAddress.address,
    signatureType: chainConfig.signatureType,
    expiresAt: expiresAt.toISOString(),
  };
}

async function readChallenge(redisClient, key) {
  if (!redisClient?.get || !key) return null;
  const raw = await redisClient.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

const CONSUME_CHALLENGE_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return nil end
local value = cjson.decode(raw)
if value["challengeId"] ~= ARGV[1] then return nil end
redis.call("DEL", KEYS[1])
return raw
`;

async function consumeWalletChallenge({ redisClient, reservation }) {
  if (!redisClient?.eval || !reservation?.key || !reservation?.challengeId) {
    throw campaignRegistrationError("WALLET_CHALLENGE_UNAVAILABLE", 503, "Wallet verification is temporarily unavailable");
  }
  const raw = await redisClient.eval(CONSUME_CHALLENGE_SCRIPT, {
    keys: [reservation.key],
    arguments: [reservation.challengeId],
  });
  if (!raw) {
    throw campaignRegistrationError("WALLET_CHALLENGE_INVALID", 400, "Wallet challenge is invalid or expired");
  }
  const expiresAt = new Date(reservation.expiresAt).getTime();
  return async function restoreWalletChallenge() {
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0 || !redisClient?.set) return false;
    const result = await redisClient.set(reservation.key, raw, {
      NX: true,
      PX: remainingMs,
    });
    return result === "OK";
  };
}

async function verifyWalletChallenge({ redisClient, campaignKey, campaignConfig, user, wallet }) {
  const registrationConfig = getCampaignWalletRegistration(campaignConfig);
  const chain = String(wallet?.chain || "").trim().toLowerCase();
  if (!registrationConfig.supportedChains.includes(chain)) {
    throw campaignRegistrationError("WALLET_CHAIN_NOT_SUPPORTED", 400, "Wallet chain is not supported by this campaign");
  }
  const normalized = normalizeWalletAddress(chain, wallet?.address);
  const walletName = String(wallet?.walletName || "").trim().slice(0, 64) || null;
  if (!registrationConfig.signatureRequired) {
    return {
      wallet: {
        chain,
        address: normalized.address,
        normalizedAddress: normalized.normalizedAddress,
        signatureRequired: false,
        verified: false,
        verifiedAt: null,
        verification: {
          messageVersion: null,
          signatureType: null,
          walletName,
        },
      },
      challengeReservation: null,
    };
  }
  if (!wallet?.challengeId || !wallet?.signature) {
    throw campaignRegistrationError("WALLET_SIGNATURE_REQUIRED", 400, "Wallet signature is required");
  }
  const key = challengeScopeKey({
    campaignKey,
    user,
    chain,
    normalizedAddress: normalized.normalizedAddress,
  });
  const challenge = await readChallenge(redisClient, key);
  if (!challenge) {
    throw campaignRegistrationError("WALLET_CHALLENGE_INVALID", 400, "Wallet challenge is invalid or expired");
  }
  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    throw campaignRegistrationError("WALLET_CHALLENGE_EXPIRED", 410, "Wallet challenge has expired");
  }
  const matches =
    challenge.challengeId === String(wallet.challengeId) &&
    challenge.campaignKey === String(campaignKey || "").trim() &&
    challenge.authCenterUserId === String(user?.authCenterUserId || "") &&
    challenge.twitterId === String(user?.twitterId || "") &&
    challenge.chain === chain &&
    challenge.normalizedAddress === normalized.normalizedAddress;
  if (!matches) {
    throw campaignRegistrationError("WALLET_CHALLENGE_INVALID", 400, "Wallet challenge does not match this registration");
  }
  await verifyWalletMessage({
    chain,
    address: normalized.address,
    message: challenge.message,
    signature: wallet.signature,
  });
  const verifiedAt = new Date();
  return {
    wallet: {
      chain,
      address: normalized.address,
      normalizedAddress: normalized.normalizedAddress,
      signatureRequired: true,
      verified: true,
      verifiedAt,
      verification: {
        messageVersion: challenge.messageVersion,
        challengeId: challenge.challengeId,
        signatureType: challenge.signatureType,
        signature: String(wallet.signature),
        message: challenge.message,
        titleSnapshot: challenge.titleSnapshot,
        walletName,
        verifiedAt: verifiedAt.toISOString(),
      },
    },
    challengeReservation: {
      key,
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
    },
  };
}

module.exports = {
  CHALLENGE_TTL_SECONDS,
  MESSAGE_VERSION,
  getExpectedOrigin,
  buildWalletRegistrationMessage,
  createWalletRegistrationChallenge,
  verifyWalletChallenge,
  consumeWalletChallenge,
};
