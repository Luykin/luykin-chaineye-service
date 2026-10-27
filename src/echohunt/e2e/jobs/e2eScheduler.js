const schedule = require("node-schedule");
const { runE2eScoringCycle } = require("../services/e2eScoreService");
const { refreshPendingDistributions } = require("../services/e2eSettlementService");

let scoreRunning = false;
let distributionRefreshRunning = false;

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

async function runDistributionRefreshSafely() {
  if (distributionRefreshRunning) return;
  distributionRefreshRunning = true;
  try {
    const result = await refreshPendingDistributions();
    if (result.checked > 0) {
      console.log(
        `[EchoHunt E2E] 分发状态刷新完成: 查询 ${result.checked} 笔，`
        + `超时完成 ${result.completedByTimeout} 笔，失败 ${result.failed} 笔`
      );
    }
  } catch (error) {
    console.error("[EchoHunt E2E] 分发状态刷新任务异常:", error?.message || error);
  } finally {
    distributionRefreshRunning = false;
  }
}

function startE2eScheduler() {
  if (process.env.E2E_SCHEDULER_ENABLED === "false") {
    return { enabled: false };
  }

  // 每 10 分钟逐条刷新用户已提交的互动，并执行算分与到期流转。
  schedule.scheduleJob("*/10 * * * *", () => runScoringTaskSafely());

  // 每小时检查一次实际分发；提交满 72 小时后停止检查并按超时完成处理。
  schedule.scheduleJob("0 * * * *", () => runDistributionRefreshSafely());

  return { enabled: true };
}

module.exports = {
  startE2eScheduler,
  runDistributionRefreshSafely,
  runScoringTaskSafely,
};
