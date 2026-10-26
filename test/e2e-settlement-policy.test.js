const test = require("node:test");
const assert = require("node:assert/strict");

const {
  computeTimeDecayWeight,
  ordinaryRetweetScoreDetail,
  scoreSingleInteraction,
} = require("../src/echohunt/e2e/services/e2eScoringPolicy");
const {
  DEFAULT_E2E_SCORING_CONFIG,
  validateScoringConfig,
} = require("../src/echohunt/e2e/services/e2eScoringConfig");
const {
  aggregateDistributionRecipients,
  allocateUsdcMicros,
  formatUsdcMicros,
  toUsdcMicros,
} = require("../src/echohunt/e2e/services/e2eMoney");

test("historical ordinary retweet data never scores", () => {
  const detail = ordinaryRetweetScoreDetail("123");
  assert.equal(detail.score, 0);
  assert.equal(detail.counted, false);
  assert.equal(detail.reason, "普通转推不计分");
});

test("time decay is deterministic from start to end", () => {
  const start = "2026-01-01T00:00:00.000Z";
  const middle = "2026-01-01T12:00:00.000Z";
  const end = "2026-01-02T00:00:00.000Z";
  assert.equal(computeTimeDecayWeight(start, start, end, 0.5), 1);
  assert.equal(computeTimeDecayWeight(middle, start, end, 0.5), 0.75);
  assert.equal(computeTimeDecayWeight(end, start, end, 0.5), 0.5);
});

test("default time decay floor is 0.7", () => {
  const start = "2026-01-01T00:00:00.000Z";
  const end = "2026-01-02T00:00:00.000Z";
  assert.equal(DEFAULT_E2E_SCORING_CONFIG.timeDecayFloor, 0.7);
  assert.equal(computeTimeDecayWeight(end, start, end), 0.7);
});

test("default per-user submission and scoring limits are one reply and one quote", () => {
  assert.equal(DEFAULT_E2E_SCORING_CONFIG.maxReplies, 1);
  assert.equal(DEFAULT_E2E_SCORING_CONFIG.maxQuotes, 1);
});

test("like quality coefficient remains 1.5", () => {
  const detail = scoreSingleInteraction(
    { id: "1", text: "", likes: 2, create_time: "2026-01-01T00:00:00.000Z" },
    "reply",
    "2026-01-01T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
    0.5
  );
  assert.equal(detail.engagementBonus, 3);
  assert.equal(detail.score, 13);
});

test("campaign scoring coefficients are configurable", () => {
  const detail = scoreSingleInteraction(
    { id: "1", text: "1234567890", likes: 2, create_time: "2026-01-01T00:00:00.000Z" },
    "reply",
    "2026-01-01T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
    { replyBase: 20, lengthCharsPerPoint: 5, lengthBonusCap: 10, likeMultiplier: 2 }
  );
  assert.equal(detail.base, 20);
  assert.equal(detail.lengthBonus, 2);
  assert.equal(detail.engagementBonus, 4);
  assert.equal(detail.score, 26);
});

test("scoring config rejects out-of-range values", () => {
  assert.throws(
    () => validateScoringConfig({ ...DEFAULT_E2E_SCORING_CONFIG, timeDecayFloor: 1.1 }),
    /timeDecayFloor/
  );
});

test("six-decimal allocation has an exact deterministic remainder", () => {
  const total = toUsdcMicros("10.000000");
  const allocations = allocateUsdcMicros(total, [
    { userId: "a", weight: 1n },
    { userId: "b", weight: 1n },
    { userId: "c", weight: 1n },
  ]);
  assert.deepEqual(allocations.map((item) => formatUsdcMicros(item.amount)), [
    "3.333334",
    "3.333333",
    "3.333333",
  ]);
  assert.equal(allocations.reduce((sum, item) => sum + item.amount, 0n), total);
});

test("duplicate winner wallets and matching fee wallet are aggregated", () => {
  const walletA = "0x1111111111111111111111111111111111111111";
  const walletB = "0x2222222222222222222222222222222222222222";
  const recipients = aggregateDistributionRecipients([
    { address: walletA, amountMicros: toUsdcMicros("1.000001") },
    { address: walletA.toUpperCase().replace("0X", "0x"), amountMicros: toUsdcMicros("2.000002") },
    { address: walletB, amountMicros: toUsdcMicros("3.000003") },
  ], { feeAddress: walletA, feeMicros: toUsdcMicros("4.000004") });
  assert.deepEqual(recipients, [
    { address: walletA, amount: "7.000007" },
    { address: walletB, amount: "3.000003" },
  ]);
});
