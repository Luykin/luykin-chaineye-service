const crypto = require("crypto");
const { ethers } = require("ethers");
const { getCampaignWalletChain } = require("../constants/campaignWalletChains");
const { campaignRegistrationError } = require("./campaignRegistrationService");

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(Array.from(BASE58_ALPHABET).map((char, index) => [char, index]));
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function decodeBase58(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("Empty base58 value");
  let number = 0n;
  for (const char of text) {
    const digit = BASE58_INDEX.get(char);
    if (digit === undefined) throw new Error("Invalid base58 value");
    number = number * 58n + BigInt(digit);
  }
  let hex = number.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let bytes = number === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  let leadingZeros = 0;
  while (leadingZeros < text.length && text[leadingZeros] === "1") leadingZeros += 1;
  if (leadingZeros) bytes = Buffer.concat([Buffer.alloc(leadingZeros), bytes]);
  return bytes;
}

function encodeBase58(value) {
  const bytes = Buffer.from(value || []);
  let number = bytes.length ? BigInt(`0x${bytes.toString("hex") || "0"}`) : 0n;
  let output = "";
  while (number > 0n) {
    output = BASE58_ALPHABET[Number(number % 58n)] + output;
    number /= 58n;
  }
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;
  return "1".repeat(leadingZeros) + output;
}

function normalizeSuiAddress(value) {
  const raw = String(value || "").trim().toLowerCase();
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!/^[0-9a-f]{1,64}$/.test(hex)) {
    throw campaignRegistrationError("WALLET_ADDRESS_INVALID", 400, "Invalid Sui address");
  }
  return `0x${hex.padStart(64, "0")}`;
}

function normalizeWalletAddress(chain, address) {
  const chainConfig = getCampaignWalletChain(chain);
  if (!chainConfig) {
    throw campaignRegistrationError("WALLET_CHAIN_NOT_SUPPORTED", 400, "Wallet chain is not supported");
  }
  const raw = String(address || "").trim();
  if (!raw) throw campaignRegistrationError("WALLET_ADDRESS_REQUIRED", 400, "Wallet address is required");

  try {
    if (chainConfig.namespace === "eip155") {
      const displayAddress = ethers.utils.getAddress(raw);
      return { address: displayAddress, normalizedAddress: displayAddress.toLowerCase() };
    }
    if (chainConfig.key === "solana") {
      const publicKey = decodeBase58(raw);
      if (publicKey.length !== 32) throw new Error("Invalid Solana public key length");
      const canonical = encodeBase58(publicKey);
      return { address: canonical, normalizedAddress: canonical };
    }
    if (chainConfig.key === "sui") {
      const canonical = normalizeSuiAddress(raw);
      return { address: canonical, normalizedAddress: canonical };
    }
  } catch (error) {
    if (error?.status) throw error;
    throw campaignRegistrationError("WALLET_ADDRESS_INVALID", 400, `Invalid ${chainConfig.displayName} address`);
  }
  throw campaignRegistrationError("WALLET_ADDRESS_INVALID", 400, "Invalid wallet address");
}

function decodeSignatureBytes(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Signature is required");
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 64) return decoded;
  }
  return decodeBase58(raw);
}

async function verifyWalletMessage({ chain, address, message, signature }) {
  const chainConfig = getCampaignWalletChain(chain);
  const normalized = normalizeWalletAddress(chain, address);
  const text = String(message || "");
  const signedValue = String(signature || "").trim();
  if (!text || !signedValue) {
    throw campaignRegistrationError("WALLET_SIGNATURE_REQUIRED", 400, "Wallet signature is required");
  }
  if (signedValue.length > 8192) {
    throw campaignRegistrationError("WALLET_SIGNATURE_INVALID", 400, "Wallet signature is invalid");
  }

  try {
    if (chainConfig.namespace === "eip155") {
      const recovered = ethers.utils.getAddress(ethers.utils.verifyMessage(text, signedValue));
      if (recovered.toLowerCase() !== normalized.normalizedAddress) throw new Error("Recovered address does not match");
      return true;
    }
    if (chainConfig.key === "solana") {
      const publicKeyBytes = decodeBase58(normalized.address);
      const signatureBytes = decodeSignatureBytes(signedValue);
      if (signatureBytes.length !== 64) throw new Error("Invalid Ed25519 signature length");
      const publicKey = crypto.createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]),
        format: "der",
        type: "spki",
      });
      if (!crypto.verify(null, Buffer.from(text, "utf8"), publicKey, signatureBytes)) {
        throw new Error("Invalid Solana signature");
      }
      return true;
    }
    if (chainConfig.key === "sui") {
      const { verifyPersonalMessageSignature } = await import("@mysten/sui/verify");
      await verifyPersonalMessageSignature(Buffer.from(text, "utf8"), signedValue, {
        address: normalized.address,
      });
      return true;
    }
  } catch (error) {
    throw campaignRegistrationError("WALLET_SIGNATURE_INVALID", 400, "Wallet signature verification failed");
  }
  throw campaignRegistrationError("WALLET_SIGNATURE_INVALID", 400, "Wallet signature verification failed");
}

module.exports = {
  decodeBase58,
  encodeBase58,
  normalizeSuiAddress,
  normalizeWalletAddress,
  verifyWalletMessage,
};
