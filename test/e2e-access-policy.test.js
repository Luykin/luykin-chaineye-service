const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const postgresModule = path.resolve(__dirname, "../src/models/postgres-start.js");
require.cache[postgresModule] = {
  id: postgresModule,
  filename: postgresModule,
  loaded: true,
  exports: {
    pgInstance: {},
    AuthCenterXhuntIdentity: {},
    AuthCenterXhuntUser: {},
    EchohuntFeatureAccess: {},
  },
};
const {
  E2E_PUBLISH_FEATURE_KEY,
  normalizeTwitterHandle,
} = require("../src/echohunt/e2e/services/e2eAccessService");
const {
  EVM_ADDRESS_PATTERN,
  MAX_DISTRIBUTION_RECIPIENTS,
} = require("../src/echohunt/e2e/services/e2eMoney");

test("E2E publish access uses the documented global feature key", () => {
  assert.equal(E2E_PUBLISH_FEATURE_KEY, "e2e-publish");
  assert.equal(normalizeTwitterHandle("https://x.com/Project_Name/status/123"), "project_name");
  assert.equal(normalizeTwitterHandle("@@Project_Name"), "project_name");
});

test("E2E distribution shares one address validator and recipient limit", () => {
  assert.equal(MAX_DISTRIBUTION_RECIPIENTS, 500);
  assert.equal(EVM_ADDRESS_PATTERN.test("0x1111111111111111111111111111111111111111"), true);
  assert.equal(EVM_ADDRESS_PATTERN.test("0x1234"), false);
});
