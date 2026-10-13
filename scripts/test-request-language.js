const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveXLanguage } = require("../src/xhunt/utils/request-language");

test("x-language is the only request language source", () => {
  assert.equal(resolveXLanguage({ query: { lang: "en", "x-language": "zh" }, headers: {} }), "zh");
  assert.equal(resolveXLanguage({ query: { lang: "zh" }, headers: { "x-language": "en" } }), "en");
  assert.equal(resolveXLanguage({ query: { lang: "en" }, headers: { "accept-language": "zh" } }), "zh");
});

test("query x-language overrides the x-language header", () => {
  assert.equal(resolveXLanguage({ query: { "x-language": "zh" }, headers: { "x-language": "en" } }), "zh");
});
