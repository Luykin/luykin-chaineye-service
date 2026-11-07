const { getCampaignWalletChain } = require("../constants/campaignWalletChains");

function toPlain(record) {
  return record && typeof record.toJSON === "function" ? record.toJSON() : record;
}

function serializeRegistrationWallet(record, { audience = "public" } = {}) {
  const json = toPlain(record);
  if (!json?.walletAddress || !json?.walletChain) return null;
  const chain = getCampaignWalletChain(json.walletChain);
  const verification = json.walletVerification && typeof json.walletVerification === "object"
    ? json.walletVerification
    : {};
  const wallet = {
    chain: json.walletChain,
    networkName: chain?.displayName || json.walletChain,
    address: json.walletAddress,
    signatureRequired: json.walletSignatureRequired === true,
    verified: json.walletVerified === true,
    verifiedAt: json.walletVerifiedAt || null,
  };
  if (audience === "self" || audience === "admin") {
    wallet.signatureType = verification.signatureType || chain?.signatureType || null;
    wallet.walletName = verification.walletName || null;
  }
  return wallet;
}

function stripWalletVerification(json) {
  const {
    walletChain: _walletChain,
    walletAddress: _walletAddress,
    walletAddressNormalized: _walletAddressNormalized,
    walletSignatureRequired: _walletSignatureRequired,
    walletVerified: _walletVerified,
    walletVerifiedAt: _walletVerifiedAt,
    walletVerification: _walletVerification,
    ...safe
  } = json || {};
  return safe;
}

function attachRegistrationWallet(record, { audience = "public" } = {}) {
  const json = toPlain(record);
  if (!json) return null;
  const safe = stripWalletVerification(json);
  return {
    ...safe,
    walletRegistration: serializeRegistrationWallet(json, { audience }),
  };
}

module.exports = {
  serializeRegistrationWallet,
  attachRegistrationWallet,
};
