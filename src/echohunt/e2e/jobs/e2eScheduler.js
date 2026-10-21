const schedule = require("node-schedule");
const { updateActiveE2eTweetEngages } = require("../services/e2eEngageService");
const { runE2eScoringCycle } = require("../services/e2eScoreService");

let engageRunning = false;
let scoreRunning = false;

async function runEngageTaskSafely() {
  if (engageRunning) return;
  engageRunning = true;
  try {
    const result = await updateActiveE2eTweetEngages();
    if (result.updatedCount > 0) {
      console.log(`[EchoHunt E2E] 推文互动抓取完成: 更新了 ${result.updatedCount} 条活跃推文`);
    }
  } catch (error) {
    console.error("[EchoHunt E2E] 推文互动抓取任务异常:", error?.message || error);
  } finally {
    engageRunning = false;
  }
}

async function runScoringTaskSafely() {
  if (scoreRunning) return;
  scoreRunning = true;
  try {
    const result = await runE2eScoringCycle();
    if (result.campaignCount > 0) {
      console.log(`[EchoHunt E2E] 算分与状态流转完成: 处理了 ${result.campaignCount} 个活跃活动`);
    }
  } catch (error) {
    console.error("[EchoHunt E2E] 算分任务异常:", error?.message || error);
  } finally {
    scoreRunning = false;
  }
}

function startE2eScheduler() {
  if (process.env.E2E_SCHEDULER_ENABLED === "false") {
    return { enabled: false };
  }

  // 每 5 分钟执行一次活跃 E2E 推文的互动数据抓取（与原 twitter_task_tweet_engage.rs 周期一致）
  schedule.scheduleJob("*/5 * * * *", () => {
    void runEngageTaskSafely();
  });

  // 每 10 分钟执行一次活跃 E2E 任务的算分与到期流转
  schedule.scheduleJob("*/10 * * * *", () => {
    void runScoringTaskSafely();
  });

  return { enabled: true };
}

module.exports = {
  startE2eScheduler,
  runEngageTaskSafely,
  runScoringTaskSafely,
};
