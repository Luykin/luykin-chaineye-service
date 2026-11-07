const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { ethers } = require("ethers");

process.env.PG_HOST ||= "localhost";
process.env.PG_DATABASE ||= "test";
process.env.PG_USERNAME ||= "test";
process.env.PG_PASSWORD ||= "test";

const {
  normalizeCampaignWalletRegistration,
  getCampaignEnglishTitle,
  buildPublicWalletRegistration,
} = require("../src/xhunt/services/campaignWalletConfigService");
const {
  encodeBase58,
  normalizeWalletAddress,
  verifyWalletMessage,
} = require("../src/xhunt/services/campaignWalletVerificationService");
const {
  createWalletRegistrationChallenge,
  verifyWalletChallenge,
  consumeWalletChallenge,
} = require("../src/xhunt/services/campaignWalletChallengeService");
const { attachRegistrationWallet } = require("../src/xhunt/services/campaignRegistrationSerializer");
const {
  normalizeRegistrationContact,
  validateRegistrationContact,
} = require("../src/xhunt/services/campaignRegistrationService");

function makeRedis() {
  const values = new Map();
  return {
    values,
    async setEx(key, _ttl, value) { values.set(key, value); },
    async get(key) { return values.get(key) || null; },
    async set(key, value, options = {}) {
      if (options.NX && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    async eval(_script, { keys, arguments: args }) {
      const value = values.get(keys[0]) || null;
      if (!value) return null;
      const parsed = JSON.parse(value);
      if (parsed.challengeId !== args[0]) return null;
      values.delete(keys[0]);
      return value;
    },
  };
}

test("钱包报名配置只接受正式字段和四条受支持网络", () => {
  assert.deepEqual(
    normalizeCampaignWalletRegistration({
      enabel: true,
      supportedChains: ["solana"],
      signatureRequired: true,
    }),
    { enabled: false, supportedChains: [], signatureRequired: false },
  );
  assert.deepEqual(
    normalizeCampaignWalletRegistration({
      enabled: true,
      supportedChains: ["SOLANA", "bsc", "bsc", "ethereum"],
    }),
    { enabled: true, supportedChains: ["solana", "bsc"], signatureRequired: true },
  );
});

test("公开配置返回统一链标识和 EchoHunt 报名地址", () => {
  const config = buildPublicWalletRegistration({
    campaignKey: "campaign a",
    walletRegistration: { enabled: true, supportedChains: ["monad", "bsc"], signatureRequired: false },
  });
  assert.equal(config.echohuntRegistrationUrl, "https://app.echohunt.ai/campaigns/campaign%20a");
  assert.deepEqual(config.chains.map((item) => item.caipNetworkId), ["eip155:143", "eip155:56"]);
  assert.equal(config.chains[0].rpcUrl, undefined);
});

test("签名标题移除换行并限制为稳定英文快照", () => {
  assert.equal(
    getCampaignEnglishTitle({ displayName: { en: "  XStable\n Creator   Campaign  " } }),
    "XStable Creator Campaign",
  );
});

test("EVM、Solana 和 Sui 地址按链规范化", () => {
  assert.equal(normalizeWalletAddress("bsc", "0x000000000000000000000000000000000000dEaD").normalizedAddress, "0x000000000000000000000000000000000000dead");
  assert.equal(normalizeWalletAddress("sui", "0x1").address, `0x${"0".repeat(63)}1`);
  const solanaBytes = crypto.randomBytes(32);
  const solana = encodeBase58(solanaBytes);
  assert.equal(normalizeWalletAddress("solana", solana).address, solana);
});

test("EVM challenge 使用英文标题、绑定真实 campaignKey，重复申请会废弃旧 challenge", async () => {
  const redisClient = makeRedis();
  const wallet = ethers.Wallet.createRandom();
  const campaignConfig = {
    displayName: { en: "XStable Creator Campaign" },
    walletRegistration: { enabled: true, supportedChains: ["monad"], signatureRequired: true },
  };
  const user = { authCenterUserId: "auth-1", twitterId: "twitter-1" };
  const challenge = await createWalletRegistrationChallenge({
    redisClient,
    campaignKey: "internal-campaign-key",
    campaignConfig,
    user,
    chain: "monad",
    address: wallet.address,
  });
  assert.match(challenge.message, /Campaign: XStable Creator Campaign/);
  assert.doesNotMatch(challenge.message, /internal-campaign-key/);
  const replacement = await createWalletRegistrationChallenge({
    redisClient,
    campaignKey: "internal-campaign-key",
    campaignConfig,
    user,
    chain: "monad",
    address: wallet.address,
  });
  assert.notEqual(replacement.challengeId, challenge.challengeId);
  const obsoleteSignature = await wallet.signMessage(challenge.message);
  await assert.rejects(
    verifyWalletChallenge({
      redisClient,
      campaignKey: "internal-campaign-key",
      campaignConfig,
      user,
      wallet: {
        chain: "monad",
        address: wallet.address,
        challengeId: challenge.challengeId,
        signature: obsoleteSignature,
      },
    }),
    (error) => error.message === "WALLET_CHALLENGE_INVALID",
  );

  const signature = await wallet.signMessage(replacement.message);
  const verification = await verifyWalletChallenge({
    redisClient,
    campaignKey: "internal-campaign-key",
    campaignConfig,
    user,
    wallet: {
      chain: "monad",
      address: wallet.address,
      walletName: "MetaMask",
      challengeId: replacement.challengeId,
      signature,
    },
  });
  assert.equal(verification.wallet.verified, true);
  assert.equal(verification.wallet.verification.titleSnapshot, "XStable Creator Campaign");

  const restore = await consumeWalletChallenge({
    redisClient,
    reservation: verification.challengeReservation,
  });
  await assert.rejects(
    verifyWalletChallenge({
      redisClient,
      campaignKey: "internal-campaign-key",
      campaignConfig,
      user,
      wallet: { chain: "monad", address: wallet.address, challengeId: replacement.challengeId, signature },
    }),
    (error) => error.message === "WALLET_CHALLENGE_INVALID",
  );

  assert.equal(await restore(), true);
  const retried = await verifyWalletChallenge({
    redisClient,
    campaignKey: "internal-campaign-key",
    campaignConfig,
    user,
    wallet: { chain: "monad", address: wallet.address, challengeId: replacement.challengeId, signature },
  });
  assert.equal(retried.wallet.verified, true);
});

test("Solana Ed25519 签名可以验证到报名公钥", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const address = encodeBase58(publicDer.subarray(publicDer.length - 32));
  const message = "XHunt wallet registration";
  const signature = crypto.sign(null, Buffer.from(message), privateKey).toString("base64");
  assert.equal(await verifyWalletMessage({ chain: "solana", address, message, signature }), true);
});

test("Sui personal-message 签名使用官方验证实现", async () => {
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const keypair = new Ed25519Keypair();
  const message = "XHunt wallet registration";
  const signed = await keypair.signPersonalMessage(Buffer.from(message));
  assert.equal(await verifyWalletMessage({
    chain: "sui",
    address: keypair.getPublicKey().toSuiAddress(),
    message,
    signature: signed.signature,
  }), true);
});

test("报名序列化返回完整地址但不泄漏签名和 challenge", () => {
  const source = {
    id: "registration-1",
    walletChain: "solana",
    walletAddress: "FullSolanaAddress",
    walletAddressNormalized: "FullSolanaAddress",
    walletSignatureRequired: true,
    walletVerified: true,
    walletVerifiedAt: "2026-11-07T00:00:00.000Z",
    walletVerification: {
      challengeId: "secret-challenge",
      signature: "secret-signature",
      message: "secret-message",
      walletName: "Phantom",
      signatureType: "solana_signMessage",
    },
  };
  const publicResult = attachRegistrationWallet(source, { audience: "public" });
  assert.equal(publicResult.walletRegistration.address, "FullSolanaAddress");
  assert.equal(publicResult.walletRegistration.walletName, undefined);
  assert.equal(publicResult.walletVerification, undefined);
  assert.equal(publicResult.walletAddressNormalized, undefined);
  assert.doesNotMatch(JSON.stringify(publicResult), /secret-/);

  const adminResult = attachRegistrationWallet(source, { audience: "admin" });
  assert.equal(adminResult.walletRegistration.walletName, "Phantom");
  assert.equal(adminResult.walletRegistration.signatureType, "solana_signMessage");
  assert.doesNotMatch(JSON.stringify(adminResult), /secret-/);
});

test("启用钱包报名后旧 EVM 表单不能绕过 EchoHunt Web 流程", () => {
  const campaign = {
    allowEmailRegistration: false,
    walletRegistration: { enabled: true, supportedChains: ["bsc"], signatureRequired: true },
  };
  const legacyContact = normalizeRegistrationContact({
    evmAddress: "0x000000000000000000000000000000000000dEaD",
  });
  assert.throws(
    () => validateRegistrationContact(campaign, legacyContact),
    (error) => error.status === 403 && error.message === "ECHOHUNT_WEB_REGISTRATION_REQUIRED",
  );
});
