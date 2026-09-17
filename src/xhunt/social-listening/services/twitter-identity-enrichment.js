const axios = require("axios");
const { EchohuntSocialListeningPost } = require("../../../models/postgres-start");

const TWITTER_USER_API_URL = "https://data.cryptohunt.ai/fetch/twitter/user";
const LOOKUP_CONCURRENCY = 8;
const LOOKUP_TIMEOUT_MS = 7000;
const LOOKUP_RESPONSE_BUDGET_MS = 3500;
const POSITIVE_CACHE_TTL_SECONDS = 6 * 60 * 60;
const NEGATIVE_CACHE_TTL_SECONDS = 5 * 60;
const MAX_IDENTITIES_PER_RESPONSE = 100;

function normalizeTwitterId(value) {
  const id = String(value || "").trim();
  return /^\d{1,64}$/.test(id) ? id : "";
}

function normalizeHandle(value) {
  const handle = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9_]{1,32}$/i.test(handle) ? handle : null;
}

function pickAvatar(user = {}) {
  const profile = user?.profile && typeof user.profile === "object" ? user.profile : user || {};
  const avatar = profile.profile_image_url || profile.profile_image_url_https || profile.avatar || profile.image || null;
  return typeof avatar === "string" && avatar.trim() ? avatar.trim() : null;
}

function buildTwitterIdentity(user, requestedTwitterId) {
  const twitterId = normalizeTwitterId(user?.id || user?.twitterId || requestedTwitterId);
  const handle = normalizeHandle(user?.username || user?.username_raw || user?.handle || user?.profile?.username);
  const name = String(user?.name || user?.displayName || user?.profile?.name || "").trim() || null;
  const avatar = pickAvatar(user);
  if (!twitterId || (!handle && !name && !avatar)) return null;
  return { twitterId, handle, name, avatar };
}

function cacheKey(twitterId) {
  return `echohunt:social-listening:twitter-identity:${twitterId}`;
}

async function getCachedIdentity(redisClient, twitterId) {
  if (!redisClient?.get) return undefined;
  const raw = await redisClient.get(cacheKey(twitterId)).catch(() => null);
  if (!raw) return undefined;
  try {
    const cached = JSON.parse(raw);
    if (cached?.missing === true) return null;
    return buildTwitterIdentity(cached, twitterId);
  } catch (_) {
    return undefined;
  }
}

async function cacheIdentity(redisClient, twitterId, identity) {
  if (!redisClient?.set) return;
  const value = identity ? JSON.stringify(identity) : JSON.stringify({ missing: true });
  const ttl = identity ? POSITIVE_CACHE_TTL_SECONDS : NEGATIVE_CACHE_TTL_SECONDS;
  await redisClient.set(cacheKey(twitterId), value, { EX: ttl }).catch(() => null);
}

async function fetchTwitterIdentity(twitterId, timeout = LOOKUP_TIMEOUT_MS) {
  const response = await axios.get(TWITTER_USER_API_URL, {
    params: { user_id: twitterId, "x-language": "en" },
    timeout,
  });
  return buildTwitterIdentity(response?.data?.data?.data, twitterId);
}

async function resolveTwitterIdentities(twitterIds, redisClient) {
  const ids = Array.from(new Set((twitterIds || []).map(normalizeTwitterId).filter(Boolean))).slice(0, MAX_IDENTITIES_PER_RESPONSE);
  const identities = new Map();
  const uncachedIds = [];

  await Promise.all(ids.map(async (twitterId) => {
    const cached = await getCachedIdentity(redisClient, twitterId);
    if (cached === undefined) uncachedIds.push(twitterId);
    else if (cached) identities.set(twitterId, cached);
  }));

  // Keep the page API responsive when an unusually large page has historical
  // missing identities. Remaining IDs are retried on later reads and become
  // progressively backfilled; they are deliberately not negative-cached here.
  const deadline = Date.now() + LOOKUP_RESPONSE_BUDGET_MS;
  let cursor = 0;
  const worker = async () => {
    while (cursor < uncachedIds.length && Date.now() < deadline) {
      const twitterId = uncachedIds[cursor];
      cursor += 1;
      const remainingMs = Math.max(1, Math.min(LOOKUP_TIMEOUT_MS, deadline - Date.now()));
      let identity = null;
      try {
        identity = await fetchTwitterIdentity(twitterId, remainingMs);
      } catch (_) {
        identity = null;
      }
      if (identity) identities.set(twitterId, identity);
      // Cache actual failed requests briefly, but never cache IDs skipped by
      // the response deadline so a later read can still resolve them.
      await cacheIdentity(redisClient, twitterId, identity);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, uncachedIds.length) }, worker));

  return identities;
}

function identityNeedsEnrichment(post = {}) {
  const author = post.author && typeof post.author === "object" ? post.author : {};
  return Boolean(normalizeTwitterId(author.twitterId)) && (!author.handle || !author.name || !author.avatar);
}

function applyIdentity(post, identity) {
  if (!identity) return post;
  const author = post.author && typeof post.author === "object" ? post.author : {};
  return {
    ...post,
    tweetUrl: identity.handle && !author.handle
      ? `https://x.com/${identity.handle}/status/${post.tweetId}`
      : (post.tweetUrl || `https://x.com/${identity.handle || "i/web"}/status/${post.tweetId}`),
    author: {
      ...author,
      twitterId: author.twitterId || identity.twitterId,
      handle: identity.handle || author.handle || null,
      name: identity.name || author.name || null,
      avatar: identity.avatar || author.avatar || null,
      avatarUrl: identity.avatar || author.avatarUrl || author.avatar || null,
      profileImageUrl: identity.avatar || author.profileImageUrl || author.avatar || null,
    },
  };
}

async function backfillIdentity(boardId, identity) {
  if (!boardId || !identity?.twitterId) return;
  const patch = {};
  if (identity.handle) patch.authorHandle = identity.handle;
  if (identity.name) patch.authorName = identity.name;
  if (identity.avatar) patch.authorAvatar = identity.avatar;
  if (!Object.keys(patch).length) return;
  await EchohuntSocialListeningPost.update(patch, {
    where: { boardId, authorTwitterId: identity.twitterId },
  }).catch((error) => {
    console.warn(`[SocialListening] 作者资料回填失败 board=${boardId} twitterId=${identity.twitterId}: ${error.message}`);
  });
}

async function enrichPostsWithTwitterIdentities(posts, options = {}) {
  const rows = Array.isArray(posts) ? posts : [];
  const ids = rows.filter(identityNeedsEnrichment).map((post) => post.author?.twitterId);
  if (!ids.length) return rows;

  const identities = await resolveTwitterIdentities(ids, options.redisClient);
  if (!identities.size) return rows;

  if (options.boardId) {
    await Promise.all([...identities.values()].map((identity) => backfillIdentity(options.boardId, identity)));
  }
  return rows.map((post) => applyIdentity(post, identities.get(normalizeTwitterId(post.author?.twitterId))));
}

module.exports = {
  buildTwitterIdentity,
  enrichPostsWithTwitterIdentities,
};
