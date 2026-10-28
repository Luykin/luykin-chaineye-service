const assert = require("node:assert/strict");
const path = require("node:path");
const { after, beforeEach, test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");
const modelsPath = require.resolve(path.join(rootDir, "src/models/postgres-start.js"));
const servicePath = require.resolve(path.join(rootDir, "src/echohunt/e2e/services/e2eScoringSettingService.js"));
const previousModels = require.cache[modelsPath];
const state = { setting: null, upserts: [] };

require.cache[modelsPath] = {
  id: modelsPath,
  filename: modelsPath,
  loaded: true,
  exports: {
    E2eScoringSetting: {
      findByPk: async () => state.setting,
      upsert: async (values) => {
        state.upserts.push(values);
        return [values, true];
      },
    },
  },
};

delete require.cache[servicePath];
const {
  getGlobalE2eScoringConfig,
  updateGlobalE2eScoringConfig,
} = require(servicePath);
const { DEFAULT_E2E_SCORING_CONFIG } = require("../src/echohunt/e2e/services/e2eScoringConfig");

beforeEach(() => {
  state.setting = null;
  state.upserts = [];
});

after(() => {
  delete require.cache[servicePath];
  if (previousModels) require.cache[modelsPath] = previousModels;
  else delete require.cache[modelsPath];
});

test("global scoring config falls back to the complete built-in policy", async () => {
  assert.deepEqual(await getGlobalE2eScoringConfig(), DEFAULT_E2E_SCORING_CONFIG);
});

test("global scoring config normalizes older stored policies", async () => {
  state.setting = { config: { replyBase: 8, rankWeightDefault: 0.75 } };

  const config = await getGlobalE2eScoringConfig();

  assert.equal(config.replyBase, 8);
  assert.equal(config.rankThreshold6, 200000);
  assert.equal(config.rankWeightTop200000, 1);
  assert.equal(config.rankWeightDefault, 0.75);
});

test("global scoring config validates and records the updating administrator", async () => {
  const config = { ...DEFAULT_E2E_SCORING_CONFIG, replyBase: 6 };

  assert.deepEqual(await updateGlobalE2eScoringConfig(config, 42), config);
  assert.equal(state.upserts.length, 1);
  assert.equal(state.upserts[0].scope, "global");
  assert.equal(state.upserts[0].updated_by, 42);
  assert.deepEqual(state.upserts[0].config, config);
  assert.ok(state.upserts[0].updated_at instanceof Date);
});

test("invalid global scoring config is rejected before persistence", async () => {
  await assert.rejects(
    updateGlobalE2eScoringConfig({ ...DEFAULT_E2E_SCORING_CONFIG, rankThreshold6: 50000 }, 42),
    /严格递增/
  );
  assert.equal(state.upserts.length, 0);
});
