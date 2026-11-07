const {
  CAMPAIGN_WALLET_CHAIN_KEYS,
  getCampaignWalletPublicChain,
} = require("../constants/campaignWalletChains");

const CAMPAIGN_WALLET_CHAIN_SET = new Set(CAMPAIGN_WALLET_CHAIN_KEYS);

function normalizeCampaignWalletRegistration(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const supportedChains = Array.from(
    new Set(
      (Array.isArray(source.supportedChains) ? source.supportedChains : [])
        .map((item) => String(item || "").trim().toLowerCase())
        .filter((item) => CAMPAIGN_WALLET_CHAIN_SET.has(item))
    )
  );
  const enabled = source.enabled === true;
  return {
    enabled,
    supportedChains: enabled ? supportedChains : [],
    signatureRequired: enabled ? source.signatureRequired !== false : false,
  };
}

function getCampaignWalletRegistration(campaign) {
  return normalizeCampaignWalletRegistration(campaign?.walletRegistration);
}

function sanitizeCampaignEnglishTitle(value) {
  const title = String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(title).slice(0, 160).join("");
}

function getCampaignEnglishTitle(campaign) {
  return sanitizeCampaignEnglishTitle(campaign?.displayName?.en);
}

function getEchohuntWebBaseUrl() {
  return String(process.env.ECHOHUNT_WEB_BASE_URL || "https://app.echohunt.ai").replace(/\/+$/, "");
}

function buildEchohuntRegistrationUrl(campaignKey) {
  const key = String(campaignKey || "").trim();
  return key ? `${getEchohuntWebBaseUrl()}/campaigns/${encodeURIComponent(key)}` : null;
}

function buildPublicWalletRegistration(campaign, campaignKey) {
  const config = getCampaignWalletRegistration(campaign);
  return {
    ...config,
    echohuntRegistrationUrl: config.enabled ? buildEchohuntRegistrationUrl(campaignKey || campaign?.campaignKey) : null,
    chains: config.supportedChains.map(getCampaignWalletPublicChain).filter(Boolean),
  };
}

module.exports = {
  normalizeCampaignWalletRegistration,
  getCampaignWalletRegistration,
  sanitizeCampaignEnglishTitle,
  getCampaignEnglishTitle,
  getEchohuntWebBaseUrl,
  buildEchohuntRegistrationUrl,
  buildPublicWalletRegistration,
};
