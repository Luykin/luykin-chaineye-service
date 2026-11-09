const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  getAddressInputConfigErrors,
  isLeaderboardSubmissionAddressMode,
  normalizeChainAddress,
  validateConfiguredChainAddress,
} = require("../src/xhunt/utils/leaderboard-address");

const completeConfig = {
  supportedChains: ["bsc", "solana", "sui"],
  recommendedChain: "bsc",
  label: { zh: "地址", en: "Address" },
  placeholder: { zh: "请输入地址", en: "Enter address" },
  helpText: { zh: "奖励地址", en: "Reward address" },
  confirmationText: { zh: "确认后不可修改", en: "Cannot be changed after confirmation" },
};

test("只有显式 leaderboard_submission 才开启投稿地址模式", () => {
  assert.equal(isLeaderboardSubmissionAddressMode({ addressCollectionMode: "leaderboard_submission" }), true);
  assert.equal(isLeaderboardSubmissionAddressMode({ addressCollectionMode: "registration_evm" }), false);
  assert.equal(isLeaderboardSubmissionAddressMode({}), false);
  assert.equal(isLeaderboardSubmissionAddressMode({ addressCollectionMode: "unknown" }), false);
});

test("校验 BSC、Solana 和 Sui 地址并生成稳定规范值", () => {
  const bsc = normalizeChainAddress("bsc", "0x000000000000000000000000000000000000dEaD");
  assert.equal(bsc.valid, true);
  assert.equal(bsc.addressNormalized, "0x000000000000000000000000000000000000dEaD");

  const solana = normalizeChainAddress("solana", "11111111111111111111111111111111");
  assert.equal(solana.valid, true);
  assert.equal(solana.addressNormalized, "11111111111111111111111111111111");

  const sui = normalizeChainAddress("sui", "0x2");
  assert.equal(sui.valid, true);
  assert.equal(sui.addressNormalized, `0x${"2".padStart(64, "0")}`);
});

test("拒绝无效地址、未配置链和缺少双语提示的配置", () => {
  assert.equal(normalizeChainAddress("bsc", "0x1234").valid, false);
  assert.equal(normalizeChainAddress("solana", "0OIl").valid, false);
  assert.equal(normalizeChainAddress("sui", "not-an-address").valid, false);

  const unsupported = validateConfiguredChainAddress(
    { ...completeConfig, supportedChains: ["bsc"] },
    "solana",
    "11111111111111111111111111111111"
  );
  assert.equal(unsupported.code, "UNSUPPORTED_ADDRESS_CHAIN");

  const invalidConfig = getAddressInputConfigErrors({
    supportedChains: ["bsc", "unknown"],
    recommendedChain: "solana",
    label: { zh: "地址" },
  });
  assert.ok(invalidConfig.errors.includes("supportedChains.unsupported"));
  assert.ok(invalidConfig.errors.includes("recommendedChain"));
  assert.ok(invalidConfig.errors.includes("label.zh/en"));
  assert.ok(invalidConfig.errors.includes("confirmationText.zh/en"));
});
