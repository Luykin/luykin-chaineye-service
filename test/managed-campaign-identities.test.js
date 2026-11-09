const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  assertUniqueManagedCampaignIdentities,
} = require("../src/xhunt/utils/managed-campaign-identities");

function campaign(nacosCampaignId, campaignKey, slug = campaignKey) {
  return { nacosCampaignId, campaignKey, slug };
}

test("允许身份字段各不相同的活动配置", () => {
  assert.doesNotThrow(() => assertUniqueManagedCampaignIdentities([
    campaign("yzilabs-hunter", "yzilabs"),
    campaign("yzilabs2-hunter", "yzilabs2"),
  ]));
});

test("拒绝复制活动沿用原 ID 或 campaignKey", () => {
  assert.throws(
    () => assertUniqueManagedCampaignIdentities([
      campaign("yzilabs-hunter", "yzilabs"),
      campaign("yzilabs-hunter", "yzilabs2", "yzilabs2"),
    ]),
    /活动 ID 重复/
  );
  assert.throws(
    () => assertUniqueManagedCampaignIdentities([
      campaign("yzilabs-hunter", "yzilabs"),
      campaign("yzilabs2-hunter", "yzilabs", "yzilabs2"),
    ]),
    /campaignKey 重复/
  );
});

test("拒绝缺失身份字段或重复 slug", () => {
  assert.throws(
    () => assertUniqueManagedCampaignIdentities([]),
    /不能为空/
  );
  assert.throws(
    () => assertUniqueManagedCampaignIdentities([campaign("", "yzilabs")]),
    /不能为空/
  );
  assert.throws(
    () => assertUniqueManagedCampaignIdentities([
      campaign("a-hunter", "a", "same"),
      campaign("b-hunter", "b", "same"),
    ]),
    /slug 重复/
  );
});
