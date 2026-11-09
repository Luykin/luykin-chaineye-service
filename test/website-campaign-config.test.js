const assert = require("node:assert/strict");
const path = require("node:path");
const { after, beforeEach, test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");
const servicePath = require.resolve(
  path.join(rootDir, "src/xhunt/services/websiteCampaignService.js")
);
const modelsPath = require.resolve(
  path.join(rootDir, "src/models/postgres-start.js")
);
const previousModels = require.cache[modelsPath];

const state = {
  record: null,
  persistedNacosPayload: null,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRecord() {
  const record = {
    id: 1,
    nacosCampaignId: "yzilabs2-hunter",
    campaignKey: "yzilabs2",
    slug: "yzilabs2",
    webStatus: "live",
    pageTemplate: "standard",
    templateConfig: {},
    websiteExtra: {},
    nacosPayload: {
      id: "yzilabs2-hunter",
      campaignKey: "yzilabs2",
    },
    async update(values) {
      if (
        Object.prototype.hasOwnProperty.call(values, "nacosPayload") &&
        values.nacosPayload !== this.nacosPayload
      ) {
        state.persistedNacosPayload = clone(values.nacosPayload);
      }
      Object.assign(this, values);
      return this;
    },
  };
  state.persistedNacosPayload = clone(record.nacosPayload);
  return record;
}

const XHuntWebsiteCampaign = {
  async findOne({ where }) {
    if (where?.nacosCampaignId) return state.record;
    return null;
  },
  async findByPk() {
    return null;
  },
};

require.cache[modelsPath] = {
  id: modelsPath,
  filename: modelsPath,
  loaded: true,
  exports: {
    CampaignRegistration: {},
    XHuntWebsiteCampaign,
    XhuntCampaignLeaderboardAddressBinding: {},
    pgInstance: {
      async transaction(callback) {
        return callback({ LOCK: { UPDATE: "UPDATE" } });
      },
    },
  },
};

delete require.cache[servicePath];
const { saveWebsiteCampaignConfig } = require(servicePath);

beforeEach(() => {
  state.record = createRecord();
});

after(() => {
  delete require.cache[servicePath];
  if (previousModels) require.cache[modelsPath] = previousModels;
  else delete require.cache[modelsPath];
});

test("保存概览数据展示项后持久化到 nacosPayload", async () => {
  await saveWebsiteCampaignConfig("yzilabs2-hunter", {
    slug: "yzilabs2",
    webStatus: "live",
    pageTemplate: "standard",
    templateConfig: {},
    websiteExtra: {},
    displayMetrics: ["hunters"],
  });

  assert.deepEqual(state.persistedNacosPayload.displayMetrics, ["hunters"]);
});
