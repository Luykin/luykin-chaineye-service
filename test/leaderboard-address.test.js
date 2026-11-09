const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  getAddressInputConfigErrors,
  isLeaderboardSubmissionAddressMode,
  normalizeChainAddress,
  validateConfiguredChainAddress,
} = require("../src/xhunt/utils/leaderboard-address");

const completeConfig = {
  supportedChains: ["bsc", "solana", "sui", "monad"],
  recommendedChain: "bsc",
};

test("只有显式 leaderboard_submission 才开启投稿地址模式", () => {
  assert.equal(isLeaderboardSubmissionAddressMode({ addressCollectionMode: "leaderboard_submission" }), true);
  assert.equal(isLeaderboardSubmissionAddressMode({ addressCollectionMode: "registration_evm" }), false);
  assert.equal(isLeaderboardSubmissionAddressMode({}), false);
  assert.equal(isLeaderboardSubmissionAddressMode({ addressCollectionMode: "unknown" }), false);
});

test("校验 BSC、Solana、Sui 和 Monad 地址并生成稳定规范值", () => {
  const bsc = normalizeChainAddress("bsc", "0x000000000000000000000000000000000000dEaD");
  assert.equal(bsc.valid, true);
  assert.equal(bsc.addressNormalized, "0x000000000000000000000000000000000000dEaD");

  const solana = normalizeChainAddress("solana", "11111111111111111111111111111111");
  assert.equal(solana.valid, true);
  assert.equal(solana.addressNormalized, "11111111111111111111111111111111");

  const sui = normalizeChainAddress("sui", "0x2");
  assert.equal(sui.valid, true);
  assert.equal(sui.addressNormalized, `0x${"2".padStart(64, "0")}`);

  const monad = normalizeChainAddress("monad", "0x000000000000000000000000000000000000dEaD");
  assert.equal(monad.valid, true);
  assert.equal(monad.addressNormalized, "0x000000000000000000000000000000000000dEaD");

  assert.deepEqual(getAddressInputConfigErrors(completeConfig).errors, []);
});

test("拒绝无效地址和未配置链，忽略旧版自定义话术", () => {
  assert.equal(normalizeChainAddress("bsc", "0x1234").valid, false);
  assert.equal(normalizeChainAddress("solana", "0OIl").valid, false);
  assert.equal(normalizeChainAddress("sui", "not-an-address").valid, false);
  assert.equal(normalizeChainAddress("monad", "0x2").valid, false);

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
  assert.deepEqual(Object.keys(invalidConfig.config).sort(), ["recommendedChain", "supportedChains"]);
});
