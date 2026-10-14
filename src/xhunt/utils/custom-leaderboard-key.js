const customLeaderboardKeyContract = require("../../../shared/xhunt/custom-leaderboard-key-contract.json");

const CUSTOM_LEADERBOARD_KEY_PATTERN = new RegExp(
  customLeaderboardKeyContract.allowedPattern,
  customLeaderboardKeyContract.flags
);

function normalizeCustomLeaderboardKey(value) {
  return String(value || "").trim().normalize("NFC");
}

function isValidCustomLeaderboardKey(value) {
  const key = normalizeCustomLeaderboardKey(value);
  return !!key
    && Array.from(key).length <= customLeaderboardKeyContract.maxLength
    && CUSTOM_LEADERBOARD_KEY_PATTERN.test(key);
}

function getCustomLeaderboardAdapterKey(item, index) {
  return normalizeCustomLeaderboardKey(item?.id || item?.distributionType || `custom-${index}`);
}

module.exports = {
  getCustomLeaderboardAdapterKey,
  isValidCustomLeaderboardKey,
  normalizeCustomLeaderboardKey,
};
