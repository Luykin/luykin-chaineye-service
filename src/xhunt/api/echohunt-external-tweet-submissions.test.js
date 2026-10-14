const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("external tweet submissions can query a campaign absent from the public campaign table", async () => {
  const originalLoad = Module._load;
  let publicCampaignLookupCount = 0;
  const modelStub = {
    pgInstance: {},
    XHuntWebsiteCampaign: {
      findOne: async () => {
        publicCampaignLookupCount += 1;
        return null;
      },
    },
    XhuntCampaignTweetSubmission: {
      findAll: async ({ where }) => {
        assert.equal(where.campaignKey, "BinanceWallet");
        assert.equal(where.leaderboardKey, undefined);
        return [];
      },
    },
  };

  Module._load = function loadWithModelStub(request, parent, isMain) {
    if (request.includes("models/postgres-start")) return modelStub;
    return originalLoad.call(this, request, parent, isMain);
  };

  let router;
  try {
    router = require("./echohunt");
  } finally {
    Module._load = originalLoad;
  }

  const layer = router.stack.find(
    (item) => item.route?.path === "/external/campaigns/:campaignKey/tweet-submissions"
  );
  assert.ok(layer, "external tweet submissions route must exist");
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const req = {
    params: { campaignKey: "BinanceWallet" },
    query: { limit: "50" },
    headers: {},
    get: () => undefined,
  };
  let responseStatus = 200;
  let responseBody;
  const res = {
    req,
    status(value) {
      responseStatus = value;
      return this;
    },
    json(value) {
      responseBody = value;
      return value;
    },
  };

  await handler(req, res);

  assert.equal(responseStatus, 200, JSON.stringify(responseBody));
  assert.deepEqual(responseBody, {
    success: true,
    data: { campaignKey: "BinanceWallet", items: [], nextCursor: null },
  });
  assert.equal(publicCampaignLookupCount, 0);
});
