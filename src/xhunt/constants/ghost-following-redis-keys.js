const GHOST_FOLLOWING_ANALYZE_REDIS_KEY_PREFIX = "xhunt:ghost:new";
const GHOST_FOLLOWING_LIST_REDIS_KEY_PREFIX = "xhunt:ghost:following:new";

function getGhostFollowingAnalyzeQuotaKey(userId) {
  return `${GHOST_FOLLOWING_ANALYZE_REDIS_KEY_PREFIX}:${userId}:quota`;
}

function getGhostFollowingAnalyzeHistoryKey(userId) {
  return `${GHOST_FOLLOWING_ANALYZE_REDIS_KEY_PREFIX}:${userId}:history`;
}

function getGhostFollowingListQuotaKey(userId) {
  return `${GHOST_FOLLOWING_LIST_REDIS_KEY_PREFIX}:${userId}:quota`;
}

module.exports = {
  GHOST_FOLLOWING_ANALYZE_REDIS_KEY_PREFIX,
  GHOST_FOLLOWING_LIST_REDIS_KEY_PREFIX,
  getGhostFollowingAnalyzeQuotaKey,
  getGhostFollowingAnalyzeHistoryKey,
  getGhostFollowingListQuotaKey,
};
