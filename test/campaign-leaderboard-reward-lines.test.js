const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PG_HOST ||= "localhost";
process.env.PG_DATABASE ||= "test";
process.env.PG_USERNAME ||= "test";
process.env.PG_PASSWORD ||= "test";

const { getCustomLeaderboardData } = require("../src/xhunt/services/campaignLeaderboardService");
const { buildCustomLeaderboardBundle } = require("../src/xhunt/services/echohuntLeaderboardService");

const customReward = "200USDT + 200U Gemini Credits";
const winner = {
  handler: "reward_tester",
  reward: customReward,
  post: "Test post",
  url: "https://x.com/reward_tester/status/1",
};
const customLeaderboard = {
  id: "winners",
  name: { en: "Winners" },
  isEssayContest: true,
  winners: [winner],
};

test("custom leaderboard API exposes custom rewards as separate display lines", async () => {
  const payload = await getCustomLeaderboardData({
    campaignKey: "reward-lines-test",
    leaderboardMode: "custom",
    customLeaderboards: [customLeaderboard],
  });
  const row = payload.leaderboards.winners[0];

  assert.equal(row.reward, customReward);
  assert.deepEqual(row.rewardLines, ["200USDT", "200U Gemini Credits"]);
});

test("EchoHunt winner bundle preserves the compatible reward string and display lines", () => {
  const bundle = buildCustomLeaderboardBundle({
    campaignKey: "reward-lines-test",
    leaderboardConfig: {
      leaderboardMode: "custom",
      customLeaderboards: [customLeaderboard],
    },
  });
  const row = bundle.winners.winners[0];

  assert.equal(row.reward, customReward);
  assert.deepEqual(row.rewardLines, ["200USDT", "200U Gemini Credits"]);
});
