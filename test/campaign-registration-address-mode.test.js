const assert = require("node:assert/strict");
const path = require("node:path");
const { after, test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");
const servicePath = require.resolve(path.join(rootDir, "src/xhunt/services/campaignRegistrationService.js"));
const modelsPath = require.resolve(path.join(rootDir, "src/models/postgres-start.js"));
const websiteCampaignServicePath = require.resolve(path.join(rootDir, "src/xhunt/services/websiteCampaignService.js"));
const previousModules = new Map();

function mockModule(filename, exports) {
  previousModules.set(filename, require.cache[filename]);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

mockModule(modelsPath, { CampaignRegistration: {} });
mockModule(websiteCampaignServicePath, { getManagedCampaignPayloadByKey: async () => null });
delete require.cache[servicePath];

const { validateRegistrationContact } = require(servicePath);

after(() => {
  delete require.cache[servicePath];
  for (const [filename, previous] of previousModules) {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  }
});

test("新模式报名不要求联系方式", () => {
  assert.doesNotThrow(() => validateRegistrationContact(
    { addressCollectionMode: "leaderboard_submission" },
    { evmAddress: null, email: null }
  ));
});

test("旧模式、缺失模式和未知模式仍然要求 EVM 地址", () => {
  for (const addressCollectionMode of [undefined, "registration_evm", "unknown"]) {
    assert.throws(
      () => validateRegistrationContact(
        addressCollectionMode ? { addressCollectionMode } : {},
        { evmAddress: null, email: null }
      ),
      (error) => error.message === "EVM_ADDRESS_REQUIRED"
    );
  }
});
