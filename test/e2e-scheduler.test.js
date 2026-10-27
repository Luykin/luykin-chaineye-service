const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const rootDir = path.resolve(__dirname, "..");
const schedulerPath = path.join(rootDir, "src/echohunt/e2e/jobs/e2eScheduler.js");
const scoreServicePath = path.join(rootDir, "src/echohunt/e2e/services/e2eScoreService.js");
const settlementServicePath = path.join(rootDir, "src/echohunt/e2e/services/e2eSettlementService.js");
const nodeSchedulePath = require.resolve("node-schedule");
const previousModules = new Map();
const scheduledJobs = [];
let scoringRuns = 0;
let distributionRuns = 0;

function mockModule(filename, exports) {
  previousModules.set(filename, require.cache[filename]);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

mockModule(nodeSchedulePath, {
  scheduleJob: (rule, callback) => {
    scheduledJobs.push({ rule, callback });
    return { rule };
  },
});
mockModule(scoreServicePath, {
  runE2eScoringCycle: async () => {
    scoringRuns += 1;
    return { campaignCount: 0 };
  },
});
mockModule(settlementServicePath, {
  refreshPendingDistributions: async () => {
    distributionRuns += 1;
    return { checked: 0, failed: 0, completedByTimeout: 0 };
  },
});

delete require.cache[schedulerPath];
const { startE2eScheduler } = require(schedulerPath);
const previousEnabled = process.env.E2E_SCHEDULER_ENABLED;

test.after(() => {
  delete require.cache[schedulerPath];
  for (const [filename, previous] of previousModules) {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  }
  if (previousEnabled === undefined) delete process.env.E2E_SCHEDULER_ENABLED;
  else process.env.E2E_SCHEDULER_ENABLED = previousEnabled;
});

test("keeps scoring at ten minutes and polls distribution status hourly", async () => {
  delete process.env.E2E_SCHEDULER_ENABLED;
  const result = startE2eScheduler();

  assert.equal(result.enabled, true);
  assert.deepEqual(scheduledJobs.map((job) => job.rule), ["*/10 * * * *", "0 * * * *"]);

  await scheduledJobs[0].callback();
  assert.equal(scoringRuns, 1);
  assert.equal(distributionRuns, 0);

  await scheduledJobs[1].callback();
  assert.equal(scoringRuns, 1);
  assert.equal(distributionRuns, 1);
});
