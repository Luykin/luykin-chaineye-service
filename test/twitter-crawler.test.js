const assert = require("node:assert/strict");
const path = require("node:path");
const { after, beforeEach, test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");
const axiosPath = require.resolve("axios");
const crawlerPath = require.resolve(path.join(rootDir, "src/xhunt/services/twitter-crawler"));
const ghostFollowingPath = require.resolve(path.join(rootDir, "src/xhunt/api/ghost-following.js"));
const previousModules = new Map();
const previousEnv = {};
let capturedRequest = null;

function mockModule(filename, exports) {
  previousModules.set(filename, require.cache[filename]);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

for (const name of [
  "TWITTER_CRAWLER_API_KEY",
  "SOCIAL_LISTENING_CRAWLER_API_KEY",
  "PRO_API_KEY",
]) {
  previousEnv[name] = process.env[name];
  delete process.env[name];
}

mockModule(axiosPath, {
  post: async (...args) => {
    capturedRequest = args;
    return { status: 200, data: { code: 200 } };
  },
});
mockModule(ghostFollowingPath, {
  PRO_API_CONFIG: { apiKey: "legacy-test-key" },
});
delete require.cache[crawlerPath];

const { requestTwitterCrawler } = require(crawlerPath);

beforeEach(() => {
  capturedRequest = null;
});

after(() => {
  delete require.cache[crawlerPath];
  for (const [filename, previous] of previousModules) {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  }
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("reuses the existing Pro API key when crawler key env vars are absent", async () => {
  await requestTwitterCrawler("tweet_detail", { tweet_id: "2113851022817001840" });

  assert.equal(capturedRequest[1].endpoint, "tweet_detail");
  assert.equal(capturedRequest[2].headers.apikey, "legacy-test-key");
});
