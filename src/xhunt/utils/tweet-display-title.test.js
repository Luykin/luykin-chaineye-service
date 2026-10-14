const assert = require("node:assert/strict");
const test = require("node:test");
const { buildTweetDisplayTitle } = require("./tweet-display-title");

test("uses the first non-empty line as the display title", () => {
  assert.equal(buildTweetDisplayTitle("\n  First   line  \nSecond line"), "First line");
});

test("returns null when tweet text is unavailable", () => {
  assert.equal(buildTweetDisplayTitle(null), null);
  assert.equal(buildTweetDisplayTitle(" \n\t "), null);
});

test("truncates long titles without splitting emoji graphemes", () => {
  assert.equal(buildTweetDisplayTitle("中文标题😀继续", 5), "中文标题😀…");
});
