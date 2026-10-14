const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const findOneCalls = [];
const originalLoad = Module._load;
Module._load = function loadWithAdapterModelStub(request, parent, isMain) {
  if (request === "../../models/postgres-start") {
    return {
      XhuntExternalLeaderboardAdapter: {
        findOne: async (options) => {
          findOneCalls.push(options);
          return null;
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { getAdapter } = require("./externalLeaderboardAdapterService");
Module._load = originalLoad;

test("external leaderboard adapter accepts multilingual stable keys", async () => {
  findOneCalls.length = 0;

  await getAdapter("valid-campaign", "Content Contest");
  await getAdapter("valid-campaign", "内容榜单");
  await getAdapter("valid-campaign", "  Cafe\u0301 榜单  ");
  await getAdapter("valid-campaign", "中".repeat(128));

  assert.deepEqual(
    findOneCalls.map((call) => call.where.leaderboardKey),
    ["Content Contest", "内容榜单", "Café 榜单", "中".repeat(128)]
  );
});

test("external leaderboard adapter rejects route delimiters and punctuation", async () => {
  for (const leaderboardKey of ["content/contest", "content#contest", "content.contest", "内容\\榜单", "中".repeat(129)]) {
    await assert.rejects(
      getAdapter("valid-campaign", leaderboardKey),
      (cause) => cause?.code === "EXTERNAL_LEADERBOARD_ADAPTER_INVALID"
        && cause?.message === "leaderboardKey 格式不正确"
    );
  }
});
