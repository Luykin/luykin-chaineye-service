const assert = require("node:assert/strict");
const path = require("node:path");
const { after, beforeEach, test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");
const servicePath = require.resolve(
  path.join(rootDir, "src/xhunt/services/campaignRegistrationAdminService.js")
);
const modelsPath = require.resolve(path.join(rootDir, "src/models/postgres-start.js"));
const previousModelsModule = require.cache[modelsPath];

const state = {
  record: null,
  calls: [],
  transaction: null,
};

const CampaignRegistration = {
  async findOne(options) {
    state.calls.push(["find-registration", options]);
    return state.record;
  },
};

const XhuntCampaignTweetSubmission = {
  async destroy(options) {
    state.calls.push(["delete-tweet-submissions", options]);
    return 2;
  },
};

const XhuntCampaignLeaderboardAddressBinding = {
  async destroy(options) {
    state.calls.push(["delete-address-bindings", options]);
    return 1;
  },
};

const pgInstance = {
  async transaction(callback) {
    state.transaction = { LOCK: { UPDATE: "UPDATE" } };
    return callback(state.transaction);
  },
  async query(sql, options) {
    state.calls.push(["enable-address-binding-delete", sql, options]);
  },
};

require.cache[modelsPath] = {
  id: modelsPath,
  filename: modelsPath,
  loaded: true,
  exports: {
    pgInstance,
    CampaignRegistration,
    XhuntCampaignLeaderboardAddressBinding,
    XhuntCampaignTweetSubmission,
  },
};

after(() => {
  delete require.cache[servicePath];
  if (previousModelsModule) require.cache[modelsPath] = previousModelsModule;
  else delete require.cache[modelsPath];
});

beforeEach(() => {
  state.calls = [];
  state.transaction = null;
  state.record = {
    id: "registration-1",
    campaign: "campaign-a",
    async destroy(options) {
      state.calls.push(["delete-registration", options]);
    },
  };
});

test("强制删除报名时在同一事务内依次删除投稿、地址绑定和报名记录", async () => {
  const { deleteCampaignRegistrationWithRelations } = require(servicePath);

  const result = await deleteCampaignRegistrationWithRelations({
    id: "registration-1",
    campaign: "campaign-a",
  });

  assert.equal(result.record, state.record);
  assert.equal(result.deletedTweetSubmissions, 2);
  assert.equal(result.deletedAddressBindings, 1);
  assert.deepEqual(
    state.calls.map(([name]) => name),
    [
      "find-registration",
      "delete-tweet-submissions",
      "enable-address-binding-delete",
      "delete-address-bindings",
      "delete-registration",
    ]
  );

  const findOptions = state.calls[0][1];
  assert.deepEqual(findOptions.where, { id: "registration-1", campaign: "campaign-a" });
  assert.equal(findOptions.transaction, state.transaction);
  assert.equal(findOptions.lock, "UPDATE");

  const tweetDeleteOptions = state.calls[1][1];
  assert.deepEqual(tweetDeleteOptions.where, { campaignRegistrationId: "registration-1" });
  assert.equal(tweetDeleteOptions.transaction, state.transaction);

  const bypassOptions = state.calls[2][2];
  assert.match(
    state.calls[2][1],
    /set_config\('xhunt\.allow_campaign_registration_cascade_delete', 'on', true\)/
  );
  assert.equal(bypassOptions.transaction, state.transaction);

  const bindingDeleteOptions = state.calls[3][1];
  assert.deepEqual(bindingDeleteOptions.where, { campaignRegistrationId: "registration-1" });
  assert.equal(bindingDeleteOptions.transaction, state.transaction);
  assert.equal(state.calls[4][1].transaction, state.transaction);
});

test("找不到报名记录时不删除任何关联数据", async () => {
  state.record = null;
  const { deleteCampaignRegistrationWithRelations } = require(servicePath);

  const result = await deleteCampaignRegistrationWithRelations({
    id: "missing-registration",
    campaign: "campaign-a",
  });

  assert.equal(result, null);
  assert.deepEqual(state.calls.map(([name]) => name), ["find-registration"]);
});
