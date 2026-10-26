const assert = require("node:assert/strict");
const path = require("node:path");
const { after, beforeEach, test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");
const servicePath = path.join(rootDir, "src/echohunt/e2e/services/e2eInteractionSubmissionService.js");
const scoreServicePath = path.join(rootDir, "src/echohunt/e2e/services/e2eScoreService.js");
const modelsPath = require.resolve(path.join(rootDir, "src/models/postgres-start.js"));
const crawlerPath = require.resolve(path.join(rootDir, "src/xhunt/services/twitter-crawler"));
const previousModules = new Map();

function mockModule(filename, exports) {
  previousModules.set(filename, require.cache[filename]);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const campaign = {
  address: "0x1111111111111111111111111111111111111111",
  tweet_id: "9000000000000000001",
  status: "active",
  end_time: "2099-01-02T00:00:00.000Z",
  retro: true,
  score_config: { maxReplies: 1, maxQuotes: 1 },
};
const signup = { user_id: "user-1", create_time: "2026-01-01T00:00:00.000Z" };
const state = { submissions: [], crawlerTweet: null, crawlerError: null, afterCrawler: null };

function record(values) {
  return {
    ...values,
    toJSON() { return { ...this }; },
    async update(patch) { Object.assign(this, patch); return this; },
  };
}

const E2eInteractionSubmission = {
  findOne: async ({ where }) => state.submissions.find((item) =>
    item.campaign_address === where.campaign_address &&
    item.interaction_tweet_id === where.interaction_tweet_id
  ) || null,
  findAll: async ({ where }) => state.submissions.filter((item) =>
    item.campaign_address === where.campaign_address &&
    (!where.user_id || item.user_id === where.user_id)
  ),
  count: async ({ where }) => state.submissions.filter((item) =>
    item.campaign_address === where.campaign_address &&
    item.user_id === where.user_id &&
    item.interaction_type === where.interaction_type
  ).length,
  create: async (values) => {
    const created = record({ id: `submission-${state.submissions.length + 1}`, ...values });
    state.submissions.push(created);
    return created;
  },
};

mockModule(modelsPath, {
  E2eInteractionSubmission,
  E2eList: { findByPk: async (address) => address === campaign.address ? { ...campaign } : null },
  E2eRecord: { findOne: async () => signup },
  pgInstance: {
    transaction: async (callback) => callback({ LOCK: { UPDATE: "UPDATE" } }),
  },
});
mockModule(crawlerPath, {
  requestTwitterCrawler: async () => {
    if (state.crawlerError) throw state.crawlerError;
    if (state.afterCrawler) await state.afterCrawler();
    return { data: state.crawlerTweet };
  },
});

const {
  parseInteractionTweetUrl,
  refreshCampaignInteractionSubmissions,
  submitE2eInteraction,
} = require(servicePath);
const { buildUserScoreBreakdown } = require(scoreServicePath);

beforeEach(() => {
  state.submissions = [];
  state.crawlerError = null;
  state.afterCrawler = null;
  campaign.status = "active";
  campaign.end_time = "2099-01-02T00:00:00.000Z";
  campaign.retro = true;
  campaign.score_config = { maxReplies: 1, maxQuotes: 1 };
  signup.create_time = "2026-01-01T00:00:00.000Z";
  signup.score_breakdown = null;
  state.crawlerTweet = {
    id: "9000000000000000002",
    text: "A direct reply",
    created_at: "2026-01-01T01:00:00.000Z",
    user_id: "user-1",
    username: "alice",
    in_reply_to_status_id: campaign.tweet_id,
    likes: 2,
    views: 100,
  };
});

after(() => {
  delete require.cache[servicePath];
  delete require.cache[scoreServicePath];
  for (const [filename, previous] of previousModules) {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  }
});

test("accepts strict X and Twitter status URLs", () => {
  assert.equal(parseInteractionTweetUrl("https://x.com/alice/status/9000000000000000002").tweetId, "9000000000000000002");
  assert.equal(parseInteractionTweetUrl("https://twitter.com/alice/status/9000000000000000002").handle, "alice");
  assert.throws(() => parseInteractionTweetUrl("https://example.com/alice/status/9000000000000000002"), {
    code: "E2E_INVALID_INTERACTION_URL",
  });
});

test("verifies and saves a direct reply by the registered user", async () => {
  const result = await submitE2eInteraction({
    address: campaign.address,
    campaignTweetId: campaign.tweet_id,
    tweetUrl: "https://x.com/alice/status/9000000000000000002",
    twitterUserId: "user-1",
  });
  assert.equal(result.type, "reply");
  assert.equal(result.status, "verified");
  assert.equal(result.metrics.likes, 2);
  assert.equal(state.submissions.length, 1);
});

test("verifies a quote and keeps duplicate submission idempotent", async () => {
  delete state.crawlerTweet.in_reply_to_status_id;
  state.crawlerTweet.quoted_status_id = campaign.tweet_id;
  const input = {
    address: campaign.address,
    campaignTweetId: campaign.tweet_id,
    tweetUrl: "https://x.com/alice/status/9000000000000000002",
    twitterUserId: "user-1",
  };
  const first = await submitE2eInteraction(input);
  signup.score_breakdown = {
    interactions: [{ id: first.tweetId, counted: true, score: 42.5, reason: null }],
  };
  const duplicate = await submitE2eInteraction(input);
  assert.equal(first.type, "quote");
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.counted, true);
  assert.equal(duplicate.score, 42.5);
  assert.equal(state.submissions.length, 1);
});

test("rejects crawler responses without a real creation time", async () => {
  delete state.crawlerTweet.created_at;
  await assert.rejects(
    submitE2eInteraction({
      address: campaign.address,
      campaignTweetId: campaign.tweet_id,
      tweetUrl: "https://x.com/alice/status/9000000000000000002",
      twitterUserId: "user-1",
    }),
    { code: "E2E_INTERACTION_INVALID_RESPONSE" }
  );
});

test("rechecks campaign status inside the write transaction", async () => {
  state.afterCrawler = () => { campaign.status = "review"; };
  await assert.rejects(
    submitE2eInteraction({
      address: campaign.address,
      campaignTweetId: campaign.tweet_id,
      tweetUrl: "https://x.com/alice/status/9000000000000000002",
      twitterUserId: "user-1",
    }),
    { code: "E2E_INTERACTION_SUBMISSION_CLOSED" }
  );
  assert.equal(state.submissions.length, 0);
});

test("uses the latest submission limit inside the write transaction", async () => {
  campaign.score_config = { maxReplies: 2, maxQuotes: 1 };
  state.submissions.push(record({
    id: "existing",
    campaign_address: campaign.address,
    campaign_tweet_id: campaign.tweet_id,
    interaction_tweet_id: "9000000000000000003",
    interaction_type: "reply",
    user_id: "user-1",
  }));
  state.afterCrawler = () => { campaign.score_config = { maxReplies: 1, maxQuotes: 1 }; };
  await assert.rejects(
    submitE2eInteraction({
      address: campaign.address,
      campaignTweetId: campaign.tweet_id,
      tweetUrl: "https://x.com/alice/status/9000000000000000002",
      twitterUserId: "user-1",
    }),
    { code: "E2E_INTERACTION_LIMIT_REACHED" }
  );
  assert.equal(state.submissions.length, 1);
});

test("rejects a Tweet owned by another X account", async () => {
  state.crawlerTweet.user_id = "user-2";
  await assert.rejects(
    submitE2eInteraction({
      address: campaign.address,
      campaignTweetId: campaign.tweet_id,
      tweetUrl: "https://x.com/bob/status/9000000000000000002",
      twitterUserId: "user-1",
    }),
    { code: "E2E_INTERACTION_AUTHOR_MISMATCH" }
  );
});

test("rejects an unrelated reply", async () => {
  state.crawlerTweet.in_reply_to_status_id = "8000000000000000000";
  await assert.rejects(
    submitE2eInteraction({
      address: campaign.address,
      campaignTweetId: campaign.tweet_id,
      tweetUrl: "https://x.com/alice/status/9000000000000000002",
      twitterUserId: "user-1",
    }),
    { code: "E2E_INTERACTION_TARGET_MISMATCH" }
  );
});

test("uses maxReplies as the backend submission limit", async () => {
  state.submissions.push(record({
    id: "existing",
    campaign_address: campaign.address,
    campaign_tweet_id: campaign.tweet_id,
    interaction_tweet_id: "9000000000000000003",
    interaction_type: "reply",
    user_id: "user-1",
  }));
  await assert.rejects(
    submitE2eInteraction({
      address: campaign.address,
      campaignTweetId: campaign.tweet_id,
      tweetUrl: "https://x.com/alice/status/9000000000000000002",
      twitterUserId: "user-1",
    }),
    { code: "E2E_INTERACTION_LIMIT_REACHED" }
  );
});

test("keeps the last verified metrics when a refresh fails", async () => {
  const existing = record({
    id: "existing",
    campaign_address: campaign.address,
    campaign_tweet_id: campaign.tweet_id,
    interaction_tweet_id: "9000000000000000002",
    interaction_type: "reply",
    user_id: "user-1",
    status: "verified",
    likes: 7,
  });
  state.submissions.push(existing);
  state.crawlerError = new Error("crawler unavailable");
  const result = await refreshCampaignInteractionSubmissions(campaign);
  assert.equal(result.failed, 1);
  assert.equal(existing.likes, 7);
  assert.equal(existing.status, "verified");
  assert.match(existing.last_error, /E2E_INTERACTION_NOT_FOUND/);
});

test("marks an explicitly missing interaction unavailable and keeps its snapshot", async () => {
  const existing = record({
    id: "deleted-reply",
    campaign_address: campaign.address,
    campaign_tweet_id: campaign.tweet_id,
    interaction_tweet_id: "9000000000000000002",
    interaction_type: "reply",
    interaction_url: "https://x.com/alice/status/9000000000000000002",
    user_id: "user-1",
    username: "alice",
    text: "Original snapshot",
    interaction_created_at: "2026-01-01T01:00:00.000Z",
    likes: 8,
    replies: 1,
    retweets: 0,
    quotes: 0,
    views: 321,
    status: "verified",
  });
  state.submissions.push(existing);
  state.crawlerTweet = {
    code: 200,
    message: "get data success",
    data: { errMsg: "NotFound" },
  };

  const result = await refreshCampaignInteractionSubmissions(campaign);

  assert.deepEqual(result, { total: 1, refreshed: 0, failed: 0, unavailable: 1 });
  assert.equal(existing.status, "unavailable");
  assert.equal(existing.text, "Original snapshot");
  assert.equal(existing.likes, 8);
  assert.equal(existing.views, 321);
  assert.match(existing.last_error, /E2E_INTERACTION_DELETED/);
});

test("keeps a deleted interaction in the score breakdown with zero points", () => {
  const breakdown = buildUserScoreBreakdown({
    signup,
    campaign,
    replies: [{
      id: "deleted-reply",
      user_id: "user-1",
      text: "Original snapshot",
      create_time: "2026-01-01T01:00:00.000Z",
      likes: 8,
      replies: 1,
      views: 321,
      status: "unavailable",
    }],
    quotes: [],
  });

  assert.equal(breakdown.point, 0);
  assert.equal(breakdown.interactions[0].counted, false);
  assert.equal(breakdown.interactions[0].score, 0);
  assert.equal(breakdown.interactions[0].reason, "互动已删除或不存在");
});

test("keeps language-ineligible interactions with an explicit non-scoring reason", () => {
  const breakdown = buildUserScoreBreakdown({
    signup,
    campaign: {
      ...campaign,
      lang: "cn",
      start_time: "2026-01-01T00:00:00.000Z",
      end_time: "2026-01-02T00:00:00.000Z",
    },
    replies: [
      {
        id: "english-reply",
        user_id: "user-1",
        text: "An English reply",
        create_time: "2026-01-01T01:00:00.000Z",
        likes: 10,
        replies: 2,
        retweets: 1,
        views: 100,
      },
      {
        id: "chinese-reply",
        user_id: "user-1",
        text: "这是一条中文评论",
        create_time: "2026-01-01T02:00:00.000Z",
        likes: 0,
        replies: 0,
        retweets: 0,
        views: 0,
      },
    ],
    quotes: [],
  });
  const details = new Map(breakdown.interactions.map((item) => [item.id, item]));
  assert.equal(breakdown.captured.replies, 1);
  assert.equal(breakdown.interactions.length, 2);
  assert.equal(details.get("english-reply").counted, false);
  assert.equal(details.get("english-reply").score, 0);
  assert.equal(details.get("english-reply").reason, "活动仅统计中文互动");
  assert.equal(details.get("chinese-reply").counted, true);
  assert.ok(breakdown.point > 0);
});
