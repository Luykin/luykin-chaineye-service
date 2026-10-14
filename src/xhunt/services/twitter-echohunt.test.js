const assert = require("node:assert/strict");
const test = require("node:test");
const axios = require("axios");
const { getEchohuntTweetText } = require("./twitter-echohunt");

test("fetches tweet text from the official X API with the user access token", async (t) => {
  const originalGet = axios.get;
  t.after(() => {
    axios.get = originalGet;
  });

  axios.get = async (url, options) => {
    assert.equal(url, "https://api.x.com/2/tweets/1234567890");
    assert.equal(options.headers.Authorization, "Bearer access-token");
    assert.equal(options.timeout, 3000);
    return { data: { data: { text: "Tweet text" } } };
  };

  const text = await getEchohuntTweetText({
    accessTokenEncrypted: "access-token",
    tokenExpiry: new Date(Date.now() + 60_000),
  }, "1234567890");

  assert.equal(text, "Tweet text");
});

test("does not call X for an invalid tweet id", async (t) => {
  const originalGet = axios.get;
  t.after(() => {
    axios.get = originalGet;
  });

  axios.get = async () => {
    assert.fail("X API should not be called");
  };

  assert.equal(await getEchohuntTweetText({}, "invalid"), null);
});
