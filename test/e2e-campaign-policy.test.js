const assert = require("node:assert/strict");
const test = require("node:test");

const {
  E2E_CAMPAIGN_TARGET_OPTIONS,
  getDisallowedE2eCampaignUpdateFields,
  getE2eCampaignEditableFields,
  normalizeE2eCampaignTarget,
} = require("../src/echohunt/e2e/services/e2eCampaignPolicy");

test("uses the same fixed rank threshold options as the publish flow", () => {
  assert.deepEqual(E2E_CAMPAIGN_TARGET_OPTIONS, [50000, 100000, 200000, -1]);
  assert.equal(normalizeE2eCampaignTarget("50000"), 50000);
  assert.equal(normalizeE2eCampaignTarget(-1), -1);
  assert.equal(normalizeE2eCampaignTarget(12345), 200000);
  assert.equal(normalizeE2eCampaignTarget("not-a-rank", null), null);
});

test("locks campaign configuration according to campaign status", () => {
  assert.deepEqual(getE2eCampaignEditableFields("pending"), [
    "target",
    "winners",
    "type",
    "lang",
    "retro",
    "end_time",
  ]);
  assert.deepEqual(getE2eCampaignEditableFields("active"), ["end_time"]);
  assert.deepEqual(getE2eCampaignEditableFields("review"), []);
  assert.deepEqual(getE2eCampaignEditableFields("complete"), []);
});

test("rejects locked fields without blocking an active campaign end-time extension", () => {
  assert.deepEqual(
    getDisallowedE2eCampaignUpdateFields("pending", ["rewards", "target", "start_time"]),
    ["rewards", "start_time"]
  );
  assert.deepEqual(
    getDisallowedE2eCampaignUpdateFields("active", ["target", "end_time"]),
    ["target"]
  );
  assert.deepEqual(
    getDisallowedE2eCampaignUpdateFields("review", ["end_time"]),
    ["end_time"]
  );
});
