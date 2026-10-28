const { E2eScoringSetting } = require("../../../models/postgres-start");
const { normalizeScoringConfig, validateScoringConfig } = require("./e2eScoringConfig");

const GLOBAL_SCOPE = "global";

async function getGlobalE2eScoringConfig() {
  const setting = await E2eScoringSetting.findByPk(GLOBAL_SCOPE);
  return normalizeScoringConfig(setting?.config);
}

async function updateGlobalE2eScoringConfig(value, adminId = null) {
  const config = validateScoringConfig(value);
  const now = new Date();
  await E2eScoringSetting.upsert({
    scope: GLOBAL_SCOPE,
    config,
    updated_by: adminId,
    updated_at: now,
  });
  return config;
}

module.exports = {
  getGlobalE2eScoringConfig,
  updateGlobalE2eScoringConfig,
};
