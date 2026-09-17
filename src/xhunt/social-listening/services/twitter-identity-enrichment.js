const axios = require("axios");
const { EchohuntSocialListeningPost } = require("../../../models/postgres-start");

const TWITTER_TWEET_RESULT_URL = "https://cdn.syndication.twimg.com/tweet-result";
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

function normalizeTweetId(value) {
  const id = String(value || "").trim();
  return /^\d{5,32}$/.test(id) ? id : "";
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
  const twitterId = normalizeTwitterId(user?.id || user?.id_str || user?.twitterId || requestedTwitterId);
  const handle = normalizeHandle(user?.username || user?.username_raw || user?.screen_name || user?.handle || user?.profile?.username);
  const name = String(user?.name || user?.displayName || user?.profile?.name || "").trim() || null;
  const avatar = pickAvatar(user);
  if (!twitterId || (!handle && !name && !avatar)) return null;
  return { twitterId, handle, name, avatar };
}

function cacheKey(twitterId) {
  // Versioned separately from the removed user-id lookup path, so old
  // "not found" cache values cannot suppress the tweet-detail lookup.
  return `echohunt:social-listening:tweet-identity-v2:${twitterId}`;
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

async function fetchTwitterIdentityFromTweet(tweetId, timeout = LOOKUP_TIMEOUT_MS) {
  const response = await axios.get(TWITTER_TWEET_RESULT_URL, {
    // The syndication endpoint requires a non-empty token but does not use it
    // as authentication. It is a public tweet-rendering endpoint, not an X API key.
    params: { id: tweetId, lang: "en", token: "0" },
    timeout,
  });
  return buildTwitterIdentity(response?.data?.user, null);
}

async function resolveTwitterIdentitiesFromPosts(posts, redisClient) {
  const candidates = [];
  const seenTweetIds = new Set();
  for (const post of (posts || [])) {
    const twitterId = normalizeTwitterId(post?.author?.twitterId);
    const tweetId = normalizeTweetId(post?.tweetId);
    if (!twitterId || !tweetId || seenTweetIds.has(tweetId)) continue;
    seenTweetIds.add(tweetId);
    candidates.push({ twitterId, tweetId });
    if (candidates.length >= MAX_IDENTITIES_PER_RESPONSE) break;
  }

  const identities = new Map();
  const uncachedCandidates = [];
  await Promise.all(candidates.map(async (candidate) => {
    const cached = await getCachedIdentity(redisClient, candidate.twitterId);
    if (cached === undefined) uncachedCandidates.push(candidate);
    else if (cached) identities.set(candidate.twitterId, cached);
  }));

  const deadline = Date.now() + LOOKUP_RESPONSE_BUDGET_MS;
  let cursor = 0;
  const worker = async () => {
    while (cursor < uncachedCandidates.length && Date.now() < deadline) {
      const candidate = uncachedCandidates[cursor];
      cursor += 1;
      const remainingMs = Math.max(1, Math.min(LOOKUP_TIMEOUT_MS, deadline - Date.now()));
      let identity = null;
      try {
        identity = await fetchTwitterIdentityFromTweet(candidate.tweetId, remainingMs);
      } catch (_) {
        identity = null;
      }
      if (identity) {
        identities.set(candidate.twitterId, identity);
        // Cache against the source author ID. Some historical dev.tweet rows
        // contain an invalid author ID, but that is still the key used by the
        // social-listening snapshot and is therefore the correct cache key.
        await cacheIdentity(redisClient, candidate.twitterId, identity);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, candidates.length) }, worker));
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

async function backfillIdentity(boardId, sourceTwitterId, identity) {
  if (!boardId || !sourceTwitterId || !identity) return;
  const patch = {};
  if (identity.handle) patch.authorHandle = identity.handle;
  if (identity.name) patch.authorName = identity.name;
  if (identity.avatar) patch.authorAvatar = identity.avatar;
  if (!Object.keys(patch).length) return;
  await EchohuntSocialListeningPost.update(patch, {
    where: { boardId, authorTwitterId: sourceTwitterId },
  }).catch((error) => {
    console.warn(`[SocialListening] 作者资料回填失败 board=${boardId} twitterId=${sourceTwitterId}: ${error.message}`);
  });
}

async function enrichPostsWithTwitterIdentities(posts, options = {}) {
  const rows = Array.isArray(posts) ? posts : [];
  const unresolvedPosts = rows.filter(identityNeedsEnrichment);
  if (!unresolvedPosts.length) return rows;

  const identities = await resolveTwitterIdentitiesFromPosts(unresolvedPosts, options.redisClient);
  if (!identities.size) return rows;

  if (options.boardId) {
    await Promise.all([...identities.entries()].map(([twitterId, identity]) => backfillIdentity(options.boardId, twitterId, identity)));
  }
  return rows.map((post) => applyIdentity(post, identities.get(normalizeTwitterId(post.author?.twitterId))));
}

module.exports = {
  buildTwitterIdentity,
  enrichPostsWithTwitterIdentities,
};
