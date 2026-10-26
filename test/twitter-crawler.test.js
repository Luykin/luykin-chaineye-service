const assert = require("node:assert/strict");
const path = require("node:path");
const { after, beforeEach, test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");
const axiosPath = require.resolve("axios");
const crawlerPath = require.resolve(path.join(rootDir, "src/xhunt/services/twitter-crawler"));
const previousModules = new Map();
const previousProApiKey = process.env.BITEY_INTERNAL_PRO_API_KEY;
let capturedRequest = null;

function mockModule(filename, exports) {
  previousModules.set(filename, require.cache[filename]);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

mockModule(axiosPath, {
  post: async (...args) => {
    capturedRequest = args;
    return { status: 200, data: { code: 200 } };
  },
});
delete require.cache[crawlerPath];

const { requestTwitterCrawler } = require(crawlerPath);

beforeEach(() => {
  capturedRequest = null;
  process.env.BITEY_INTERNAL_PRO_API_KEY = "test-pro-api-key";
});

after(() => {
  delete require.cache[crawlerPath];
  for (const [filename, previous] of previousModules) {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  }
  if (previousProApiKey === undefined) delete process.env.BITEY_INTERNAL_PRO_API_KEY;
  else process.env.BITEY_INTERNAL_PRO_API_KEY = previousProApiKey;
});

test("uses BITEY_INTERNAL_PRO_API_KEY for crawler authentication", async () => {
  await requestTwitterCrawler("tweet_detail", { tweet_id: "2113851022817001840" });

  assert.equal(capturedRequest[1].endpoint, "tweet_detail");
  assert.equal(capturedRequest[2].headers.apikey, "test-pro-api-key");
});

test("fails before the downstream request when BITEY_INTERNAL_PRO_API_KEY is absent", async () => {
  delete process.env.BITEY_INTERNAL_PRO_API_KEY;

  await assert.rejects(
    requestTwitterCrawler("tweet_detail", { tweet_id: "2113851022817001840" }),
    { code: "BITEY_INTERNAL_PRO_API_KEY_REQUIRED" }
  );
  assert.equal(capturedRequest, null);
});
