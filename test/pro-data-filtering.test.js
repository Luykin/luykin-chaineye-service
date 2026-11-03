const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PG_HOST ||= "127.0.0.1";
process.env.PG_DATABASE ||= "xhunt_test";
process.env.PG_USERNAME ||= "xhunt_test";
process.env.PG_PASSWORD ||= "xhunt_test";

const {
  applyProDataFiltering,
} = require("../src/xhunt/utils/pro-data-filtering");
const {
  PRO_ACCESS_MIN_EXTENSION_VERSION,
} = require("../src/xhunt/constants/pro");
const {
  loadVipLists,
} = require("../src/xhunt/constants/xhuntVip");
const {
  XhuntVipTestUser,
} = require("../src/models/postgres-start");

test("uses one shared Pro access version threshold", () => {
  assert.equal(PRO_ACCESS_MIN_EXTENSION_VERSION, "99.99.99");
});

test("follow relation always returns the complete upstream payload", () => {
  const payload = {
    code: 200,
    message: "get data success",
    data: {
      data: {
        followed_action: Array.from({ length: 6 }, (_, index) => ({
          id: `followed-${index}`,
        })),
        following_action: Array.from({ length: 6 }, (_, index) => ({
          id: `following-${index}`,
        })),
      },
    },
  };

  const result = applyProDataFiltering(
    {
      path: "/public/fetch/twitter/follow_relation",
      headers: {
        "x-extension-version": PRO_ACCESS_MIN_EXTENSION_VERSION,
      },
      isPro: false,
    },
    payload
  );

  assert.strictEqual(result, payload);
  assert.deepEqual(
    result.data.data.followed_action,
    payload.data.data.followed_action
  );
  assert.deepEqual(
    result.data.data.following_action,
    payload.data.data.following_action
  );
  assert.equal(result.proMessage, undefined);
});

test("deleted tweet response includes the request VIP status", async () => {
  const originalFindAll = XhuntVipTestUser.findAll;
  XhuntVipTestUser.findAll = async () => [
    {
      username: "vip-user",
      twitterId: "123456",
      listType: "vip",
    },
  ];

  try {
    await loadVipLists();

    const payload = {
      code: 200,
      data: {
        data: [
          {
            id: "tweet-1",
            text: "deleted tweet content",
            create_time: new Date().toISOString(),
          },
        ],
      },
    };

    const vipResult = applyProDataFiltering(
      {
        path: "/public/fetch/tweet/deleted",
        headers: { "x-tw-id": "123456" },
      },
      payload
    );
    const nonVipResult = applyProDataFiltering(
      {
        path: "/public/fetch/tweet/deleted",
        headers: { "x-tw-id": "654321" },
      },
      payload
    );

    assert.equal(vipResult.isVip, true);
    assert.equal(vipResult.data.data[0].text, "deleted tweet content");
    assert.equal(nonVipResult.isVip, false);
    assert.equal(nonVipResult.data.data[0].text, "您暂时无法查看详细删帖内容");
  } finally {
    XhuntVipTestUser.findAll = async () => [];
    await loadVipLists();
    XhuntVipTestUser.findAll = originalFindAll;
  }
});

test("deleted tweet response preserves every upstream item with role-based masking", async () => {
  const originalFindAll = XhuntVipTestUser.findAll;
  XhuntVipTestUser.findAll = async () => [
    {
      username: "vip-user",
      twitterId: "123456",
      listType: "vip",
    },
    {
      username: "internal-user",
      twitterId: "999999",
      listType: "internal_test",
    },
  ];

  try {
    await loadVipLists();

    const recentTime = new Date().toISOString();
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const payload = {
      code: 200,
      data: {
        data: Array.from({ length: 5 }, (_, index) => ({
          id: `tweet-${index + 1}`,
          text: `deleted tweet content ${index + 1}`,
          create_time: index === 0 ? recentTime : oldTime,
        })),
      },
    };

    const internalResult = applyProDataFiltering(
      {
        path: "/public/fetch/tweet/deleted",
        headers: { "x-tw-id": "999999" },
      },
      payload
    );
    const vipResult = applyProDataFiltering(
      {
        path: "/public/fetch/tweet/deleted",
        headers: { "x-tw-id": "123456" },
      },
      payload
    );
    const nonVipResult = applyProDataFiltering(
      {
        path: "/public/fetch/tweet/deleted",
        headers: { "x-tw-id": "654321" },
      },
      payload
    );

    assert.deepEqual(
      internalResult.data.data.map((item) => item.text),
      [
        "deleted tweet content 1",
        "deleted tweet content 2",
        "deleted tweet content 3",
        "deleted tweet content 4",
        "deleted tweet content 5",
      ]
    );
    assert.deepEqual(
      vipResult.data.data.map((item) => item.text),
      [
        "deleted tweet content 1",
        "您暂时无法查看详细删帖内容",
        "您暂时无法查看详细删帖内容",
        "您暂时无法查看详细删帖内容",
        "您暂时无法查看详细删帖内容",
      ]
    );
    assert.deepEqual(
      nonVipResult.data.data.map((item) => item.text),
      Array(5).fill("您暂时无法查看详细删帖内容")
    );
  } finally {
    XhuntVipTestUser.findAll = async () => [];
    await loadVipLists();
    XhuntVipTestUser.findAll = originalFindAll;
  }
});
