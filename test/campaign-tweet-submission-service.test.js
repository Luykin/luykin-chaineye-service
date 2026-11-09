const assert = require("node:assert/strict");
const path = require("node:path");
const { after, beforeEach, test } = require("node:test");
const { Op } = require("sequelize");

const rootDir = path.resolve(__dirname, "..");
const servicePath = require.resolve(path.join(rootDir, "src/xhunt/services/campaignTweetSubmissionService.js"));
const modelsPath = require.resolve(path.join(rootDir, "src/models/postgres-start.js"));
const twitterServicePath = require.resolve(path.join(rootDir, "src/xhunt/services/twitter-echohunt.js"));
const previousModules = new Map();

function mockModule(filename, exports) {
  previousModules.set(filename, require.cache[filename]);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const state = {
  record: null,
  duplicate: null,
  identity: { id: "identity-1" },
  tweetDetail: null,
  tweetError: null,
  lastFindAllOptions: null,
  registration: null,
  binding: null,
  bindingFindCalls: 0,
  createdBinding: null,
  createdSubmission: null,
};

function submissionRecord(overrides = {}) {
  const record = {
    id: "11111111-1111-4111-8111-111111111111",
    campaignKey: "campaign-a",
    leaderboardKey: "essay",
    campaignRegistrationId: "registration-1",
    xHuntUserId: "user-1",
    authCenterUserId: "auth-user-1",
    twitterId: "123456789",
    twitterUsername: "old_user",
    tweetId: "1000000000000000001",
    tweetUrl: "https://x.com/old_user/status/1000000000000000001",
    tweetTitle: "旧文案",
    submittedAt: new Date("2026-10-26T01:00:00.000Z"),
    ...overrides,
    toJSON() {
      const { toJSON, update, ...values } = this;
      return { ...values };
    },
    async update(patch) {
      Object.assign(this, patch);
      return this;
    },
  };
  return record;
}

const XhuntCampaignTweetSubmission = {
  async findOne({ where }) {
    if (where?.id && typeof where.id === "object") return state.duplicate;
    if (where?.id === state.record?.id) return state.record;
    if (where?.tweetId) return state.duplicate;
    return null;
  },
  async findAll(options) {
    state.lastFindAllOptions = options;
    return [];
  },
  async count() {
    return 0;
  },
  async create(values) {
    state.createdSubmission = submissionRecord({
      ...values,
      id: "33333333-3333-4333-8333-333333333333",
    });
    return state.createdSubmission;
  },
};

const XhuntCampaignLeaderboardAddressBinding = {
  async findOne() {
    state.bindingFindCalls += 1;
    return state.binding;
  },
  async create(values) {
    state.createdBinding = {
      id: "44444444-4444-4444-8444-444444444444",
      ...values,
      toJSON() {
        const { toJSON, ...record } = this;
        return record;
      },
    };
    state.binding = state.createdBinding;
    return state.createdBinding;
  },
  async findAll() {
    return state.binding ? [state.binding] : [];
  },
};

mockModule(modelsPath, {
  pgInstance: {
    async transaction(callback) {
      return callback({ LOCK: { UPDATE: "UPDATE" } });
    },
    async query() {},
  },
  AuthCenterXhuntIdentity: {
    async findOne() {
      return state.identity;
    },
  },
  CampaignRegistration: {
    async findOne() {
      return state.registration;
    },
  },
  XhuntCampaignLeaderboardAddressBinding,
  XhuntCampaignTweetSubmission,
});

mockModule(twitterServicePath, {
  async getEchohuntTweetDetail() {
    if (state.tweetError) throw state.tweetError;
    return state.tweetDetail;
  },
});

delete require.cache[servicePath];
const {
  createTweetSubmission,
  listExternalTweetSubmissions,
  replaceTweetSubmission,
} = require(servicePath);

beforeEach(() => {
  state.record = submissionRecord();
  state.duplicate = null;
  state.identity = { id: "identity-1" };
  state.tweetDetail = {
    text: "新的总结文案\n第二行不会进入标题",
    authorId: "123456789",
    authorUsername: "new_user",
  };
  state.tweetError = null;
  state.lastFindAllOptions = null;
  state.registration = {
    id: "registration-1",
    xHuntUserId: "user-1",
    authCenterUserId: "auth-user-1",
    twitterId: "123456789",
    username: "old_user",
  };
  state.binding = null;
  state.bindingFindCalls = 0;
  state.createdBinding = null;
  state.createdSubmission = null;
});

after(() => {
  delete require.cache[servicePath];
  for (const [filename, previous] of previousModules) {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  }
});

test("管理员替换投稿链接时同步更新 tweetId、规范链接和总结文案", async () => {
  const originalSubmittedAt = state.record.submittedAt;
  const result = await replaceTweetSubmission({
    id: state.record.id,
    campaignKey: "campaign-a",
    tweetUrl: "https://twitter.com/new_user/status/2000000000000000002?ref=admin",
  });

  assert.equal(result.before.tweetId, "1000000000000000001");
  assert.equal(result.submission.tweetId, "2000000000000000002");
  assert.equal(result.submission.tweetUrl, "https://x.com/new_user/status/2000000000000000002");
  assert.equal(result.submission.title, "新的总结文案");
  assert.equal(result.submission.user.username, "new_user");
  assert.equal(state.record.submittedAt, originalSubmittedAt);
});

test("管理员不能把投稿替换成其他用户的推文", async () => {
  state.tweetDetail.authorId = "987654321";

  await assert.rejects(
    replaceTweetSubmission({
      id: state.record.id,
      campaignKey: "campaign-a",
      tweetUrl: "https://x.com/other/status/2000000000000000002",
    }),
    (error) => error.status === 403 && error.message === "TWEET_AUTHOR_MISMATCH",
  );
  assert.equal(state.record.tweetId, "1000000000000000001");
  assert.equal(state.record.tweetTitle, "旧文案");
});

test("投稿用户 X 授权失效时返回可操作的管理端提示", async () => {
  state.tweetError = Object.assign(new Error("X_REAUTH_REQUIRED"), { status: 401 });

  await assert.rejects(
    replaceTweetSubmission({
      id: state.record.id,
      campaignKey: "campaign-a",
      tweetUrl: "https://x.com/new_user/status/2000000000000000002",
    }),
    (error) => error.status === 409
      && error.message === "TWITTER_REAUTH_REQUIRED"
      && error.publicMessage.includes("重新连接 X"),
  );
});

test("搜索条件与游标条件同时生效，搜索通配符按普通字符处理", async () => {
  const cursor = Buffer.from(JSON.stringify({
    submittedAt: "2026-10-26T01:00:00.000Z",
    id: "22222222-2222-4222-8222-222222222222",
  })).toString("base64url");

  await listExternalTweetSubmissions({
    campaignKey: "campaign-a",
    query: "Neo%_",
    cursor,
    limit: 20,
  });

  const andConditions = state.lastFindAllOptions.where[Op.and];
  assert.equal(andConditions.length, 2);
  const searchColumns = andConditions[0][Op.or];
  assert.equal(searchColumns[0].tweetTitle[Op.iLike], "%Neo\\%\\_%");
  assert.ok(andConditions[1][Op.or]);
  assert.equal(state.lastFindAllOptions.include, undefined);
});

function submissionCampaignConfig(addressCollectionMode) {
  return {
    ...(addressCollectionMode ? { addressCollectionMode } : {}),
    leaderboardMode: "custom",
    enrollmentWindow: {
      startAt: "2020-01-01T00:00:00.000Z",
      endAt: "2099-01-01T00:00:00.000Z",
    },
    customLeaderboards: [{
      id: "essay",
      tweetSubmission: {
        enabled: true,
        period: "day",
        periodLimit: 3,
        totalLimit: 20,
        addressInput: {
          supportedChains: ["bsc"],
          recommendedChain: "bsc",
        },
      },
    }],
  };
}

test("新模式首次投稿在同一事务创建不可变地址绑定并关联投稿", async () => {
  const result = await createTweetSubmission({
    campaignKey: "campaign-a",
    leaderboardKey: "essay",
    campaignConfig: submissionCampaignConfig("leaderboard_submission"),
    twitterIdentity: { twitterId: "123456789", username: "old_user" },
    twitterIdentityRecord: { id: "identity-1" },
    authCenterUserId: "auth-user-1",
    tweetUrl: "https://x.com/old_user/status/2000000000000000002",
    chain: "bsc",
    submissionAddress: "0x000000000000000000000000000000000000dEaD",
    addressConfirmed: true,
  });

  assert.equal(state.createdBinding.addressNormalized, "0x000000000000000000000000000000000000dEaD");
  assert.equal(state.createdSubmission.addressBindingId, state.createdBinding.id);
  assert.equal(result.addressBinding.id, state.createdBinding.id);
});

test("旧模式投稿完全不查询地址绑定，也不增加响应字段", async () => {
  const result = await createTweetSubmission({
    campaignKey: "campaign-a",
    leaderboardKey: "essay",
    campaignConfig: submissionCampaignConfig(),
    twitterIdentity: { twitterId: "123456789", username: "old_user" },
    twitterIdentityRecord: { id: "identity-1" },
    authCenterUserId: "auth-user-1",
    tweetUrl: "https://x.com/old_user/status/2000000000000000002",
  });

  assert.equal(state.bindingFindCalls, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "addressBinding"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(state.createdSubmission, "addressBindingId"), false);
});

test("新模式后续投稿复用绑定，任何换链或换地址请求都会被拒绝", async () => {
  state.binding = {
    id: "44444444-4444-4444-8444-444444444444",
    campaignKey: "campaign-a",
    leaderboardKey: "essay",
    chain: "bsc",
    address: "0x000000000000000000000000000000000000dEaD",
    addressNormalized: "0x000000000000000000000000000000000000dEaD",
    lockedAt: new Date("2026-11-09T00:00:00.000Z"),
  };

  const reused = await createTweetSubmission({
    campaignKey: "campaign-a",
    leaderboardKey: "essay",
    campaignConfig: submissionCampaignConfig("leaderboard_submission"),
    twitterIdentity: { twitterId: "123456789", username: "old_user" },
    twitterIdentityRecord: { id: "identity-1" },
    authCenterUserId: "auth-user-1",
    tweetUrl: "https://x.com/old_user/status/2000000000000000002",
  });
  assert.equal(state.createdSubmission.addressBindingId, state.binding.id);
  assert.equal(reused.addressBinding.id, state.binding.id);

  state.createdSubmission = null;
  await assert.rejects(
    createTweetSubmission({
      campaignKey: "campaign-a",
      leaderboardKey: "essay",
      campaignConfig: submissionCampaignConfig("leaderboard_submission"),
      twitterIdentity: { twitterId: "123456789", username: "old_user" },
      twitterIdentityRecord: { id: "identity-1" },
      authCenterUserId: "auth-user-1",
      tweetUrl: "https://x.com/old_user/status/3000000000000000003",
      chain: "bsc",
      submissionAddress: "0x0000000000000000000000000000000000000001",
      addressConfirmed: true,
    }),
    (error) => error.status === 409 && error.message === "LEADERBOARD_ADDRESS_LOCKED",
  );
  assert.equal(state.createdSubmission, null);
});
