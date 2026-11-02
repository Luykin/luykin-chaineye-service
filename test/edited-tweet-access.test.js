const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyEditedTweetScope,
} = require("../src/xhunt/utils/edited-tweet-access");

const NOW_SECONDS = 2_000_000_000;

function buildResponse(items = []) {
  return {
    code: 200,
    message: "get data success",
    data: {
      items,
      window_start: NOW_SECONDS - 30 * 24 * 60 * 60,
      window_end: NOW_SECONDS,
    },
  };
}

function buildAccess(detailScope, detailWindowSeconds) {
  return {
    detail_scope: detailScope,
    detail_window_seconds: detailWindowSeconds,
    count_semantics: "edited_threads",
  };
}

test("counts keep totals and expose count-only access metadata", () => {
  const response = {
    code: 200,
    data: { counts: { "123": 2 } },
  };

  const result = applyEditedTweetScope(response, {
    endpoint: "counts",
    access: buildAccess("count_only", 0),
    nowSeconds: NOW_SECONDS,
  });

  assert.deepEqual(result.data.counts, { "123": 2 });
  assert.equal(result.data.xhunt_access.detail_scope, "count_only");
  assert.notStrictEqual(result, response);
});

test("internal users receive every item in the upstream source window", () => {
  const items = [
    { edit: { first_created_at: NOW_SECONDS - 10 } },
    { edit: { first_created_at: NOW_SECONDS - 10 * 24 * 60 * 60 } },
  ];

  const result = applyEditedTweetScope(buildResponse(items), {
    endpoint: "details",
    access: buildAccess("internal_source_window", null),
    nowSeconds: NOW_SECONDS,
  });

  assert.equal(result.data.items.length, 2);
});

test("VIP users receive every item in the upstream source window", () => {
  const items = [
    { edit: { root_id: "recent", first_created_at: NOW_SECONDS - 60 } },
    {
      edit: {
        root_id: "old",
        first_created_at: NOW_SECONDS - 10 * 24 * 60 * 60,
      },
    },
    { edit: { root_id: "invalid", first_created_at: "invalid" } },
  ];

  const result = applyEditedTweetScope(buildResponse(items), {
    endpoint: "details",
    access: buildAccess("vip_24h", null),
  });

  assert.deepEqual(
    result.data.items.map((item) => item.edit.root_id),
    ["recent", "old", "invalid"]
  );
});

test("non-VIP details are emptied without retaining item metadata", () => {
  const response = buildResponse([
    { edit: { root_id: "secret", first_created_at: NOW_SECONDS } },
  ]);
  response.data.future_sensitive_field = { text: "secret" };

  const result = applyEditedTweetScope(
    response,
    {
      endpoint: "details",
      access: buildAccess("count_only", 0),
      nowSeconds: NOW_SECONDS,
    }
  );

  assert.deepEqual(result.data.items, []);
  assert.equal(result.data.future_sensitive_field, undefined);
});

test("malformed detail responses fail closed", () => {
  assert.throws(
    () =>
      applyEditedTweetScope(
        { code: 200, data: { items: null } },
        {
          endpoint: "details",
          access: buildAccess("internal_source_window", null),
          nowSeconds: NOW_SECONDS,
        }
      ),
    /Invalid edited tweet items/
  );
});
