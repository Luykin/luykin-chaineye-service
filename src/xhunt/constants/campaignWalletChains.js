const CAMPAIGN_WALLET_CHAIN_KEYS = ["solana", "sui", "monad", "bsc"];

const CAMPAIGN_WALLET_CHAINS = Object.freeze({
  solana: Object.freeze({
    key: "solana",
    displayName: "Solana",
    namespace: "solana",
    caipNetworkId: "solana:mainnet",
    rpcUrl: process.env.CAMPAIGN_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    explorerUrl: "https://explorer.solana.com",
    nativeCurrency: Object.freeze({ name: "Solana", symbol: "SOL", decimals: 9 }),
    signatureType: "solana_signMessage",
    wallets: Object.freeze(["Phantom", "OKX Wallet"]),
  }),
  sui: Object.freeze({
    key: "sui",
    displayName: "Sui",
    namespace: "sui",
    caipNetworkId: "sui:mainnet",
    rpcUrl: process.env.CAMPAIGN_SUI_RPC_URL || "https://fullnode.mainnet.sui.io:443",
    explorerUrl: "https://suiscan.xyz/mainnet",
    nativeCurrency: Object.freeze({ name: "Sui", symbol: "SUI", decimals: 9 }),
    signatureType: "sui_signPersonalMessage",
    wallets: Object.freeze(["Slush", "OKX Wallet"]),
  }),
  monad: Object.freeze({
    key: "monad",
    displayName: "Monad",
    namespace: "eip155",
    caipNetworkId: "eip155:143",
    chainId: 143,
    chainIdHex: "0x8f",
    rpcUrl: process.env.CAMPAIGN_MONAD_RPC_URL || "https://rpc.monad.xyz",
    explorerUrl: "https://monadscan.com",
    nativeCurrency: Object.freeze({ name: "Monad", symbol: "MON", decimals: 18 }),
    signatureType: "evm_personal_sign",
    wallets: Object.freeze(["MetaMask", "OKX Wallet"]),
  }),
  bsc: Object.freeze({
    key: "bsc",
    displayName: "BNB Chain",
    namespace: "eip155",
    caipNetworkId: "eip155:56",
    chainId: 56,
    chainIdHex: "0x38",
    rpcUrl: process.env.CAMPAIGN_BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org",
    explorerUrl: "https://bscscan.com",
    nativeCurrency: Object.freeze({ name: "BNB", symbol: "BNB", decimals: 18 }),
    signatureType: "evm_personal_sign",
    wallets: Object.freeze(["Binance Wallet", "MetaMask", "OKX Wallet"]),
  }),
});

function getCampaignWalletChain(chain) {
  const key = String(chain || "").trim().toLowerCase();
  return CAMPAIGN_WALLET_CHAINS[key] || null;
}

function getCampaignWalletPublicChain(chain) {
  const config = getCampaignWalletChain(chain);
  if (!config) return null;
  return {
    key: config.key,
    displayName: config.displayName,
    namespace: config.namespace,
    caipNetworkId: config.caipNetworkId,
    chainId: config.chainId || null,
    chainIdHex: config.chainIdHex || null,
    explorerUrl: config.explorerUrl,
    nativeCurrency: config.nativeCurrency,
    signatureType: config.signatureType,
    wallets: config.wallets,
  };
}

module.exports = {
  CAMPAIGN_WALLET_CHAIN_KEYS,
  CAMPAIGN_WALLET_CHAINS,
  getCampaignWalletChain,
  getCampaignWalletPublicChain,
};
