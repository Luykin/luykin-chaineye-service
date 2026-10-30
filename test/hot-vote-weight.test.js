const assert = require("node:assert/strict");
const { test } = require("node:test");
const { formatPublicXHuntRank } = require("../src/xhunt/utils/hot-vote-weight");

test("returns the exact XHunt rank for a public voter", () => {
  assert.equal(formatPublicXHuntRank(20436, false), 20436);
  assert.equal(formatPublicXHuntRank("999", false), 999);
});

test("returns only the leading rank digit for an anonymous voter", () => {
  assert.equal(formatPublicXHuntRank(1, true), 1);
  assert.equal(formatPublicXHuntRank(23, true), 20);
  assert.equal(formatPublicXHuntRank(999, true), 900);
  assert.equal(formatPublicXHuntRank(20436, true), 20000);
  assert.equal(formatPublicXHuntRank(200000, true), 200000);
});

test("returns null when no valid XHunt rank exists", () => {
  assert.equal(formatPublicXHuntRank(null, false), null);
  assert.equal(formatPublicXHuntRank(undefined, true), null);
  assert.equal(formatPublicXHuntRank(0, true), null);
  assert.equal(formatPublicXHuntRank("invalid", false), null);
});
