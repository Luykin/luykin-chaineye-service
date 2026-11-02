const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PG_HOST ||= "127.0.0.1";
process.env.PG_DATABASE ||= "xhunt_test";
process.env.PG_USERNAME ||= "xhunt_test";
process.env.PG_PASSWORD ||= "xhunt_test";

const {
  applyProDataFiltering,
} = require("../src/xhunt/utils/pro-data-filtering");

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
      headers: { "x-extension-version": "9.9.99" },
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
