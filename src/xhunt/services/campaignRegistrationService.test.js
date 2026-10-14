const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const disabledCampaign = {
  nacosCampaignId: "BinanceWallet-hunter",
  campaignKey: "BinanceWallet",
  enabled: false,
  testingPhase: true,
  nacosPayload: {
    id: "BinanceWallet-hunter",
    campaignKey: "BinanceWallet",
    enabled: false,
    testingPhase: true,
  },
};

const originalLoad = Module._load;
Module._load = function loadWithCampaignModelStub(request, parent, isMain) {
  if (request === "../../models/postgres-start") {
    return {
      CampaignRegistration: {},
      XHuntWebsiteCampaign: {
        findOne: async ({ where }) => {
          if (where.campaignKey !== disabledCampaign.campaignKey) return null;
          if (where.enabled === true && disabledCampaign.enabled !== true) return null;
          return disabledCampaign;
        },
      },
      pgInstance: {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  loadCampaignConfigForRegistration,
} = require("./campaignRegistrationService");
Module._load = originalLoad;

test("disabled campaign returns a friendly not-started error", async () => {
  await assert.rejects(
    loadCampaignConfigForRegistration("BinanceWallet", { headers: {} }, { channel: "echohunt" }),
    (cause) => cause?.message === "CAMPAIGN_NOT_ENABLED"
      && cause?.status === 400
      && cause?.publicMessages?.["zh-CN"] === "活动尚未开始，敬请关注。"
      && cause?.publicMessages?.en === "This campaign has not started yet. Please stay tuned."
  );
});

test("unknown campaign remains an invalid campaign error", async () => {
  await assert.rejects(
    loadCampaignConfigForRegistration("missing-campaign", { headers: {} }, { channel: "echohunt" }),
    (cause) => cause?.message === "INVALID_CAMPAIGN"
      && cause?.status === 400
      && cause?.publicMessage === "Invalid campaign identifier"
  );
});
