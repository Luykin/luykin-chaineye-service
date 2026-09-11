const { Op } = require("sequelize");

const SOCIAL_LISTENING_RETENTION_DAYS = 31;
const SOCIAL_LISTENING_CLEANUP_CRON = "20 10 * * *";
const SOCIAL_LISTENING_CLEANUP_TIME_ZONE = "Asia/Shanghai";
const COMPLETED_JOB_STATUSES = ["succeeded", "failed", "skipped", "cancelled"];

function getRetentionCutoff(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - SOCIAL_LISTENING_RETENTION_DAYS);
  return cutoff;
}

function getNextCleanupAt(now = new Date()) {
  const nextCleanupAt = new Date(now);
  nextCleanupAt.setUTCHours(2, 20, 0, 0);
  if (nextCleanupAt <= now) nextCleanupAt.setUTCDate(nextCleanupAt.getUTCDate() + 1);
  return nextCleanupAt;
}

function getExpiredPercent(expiredRows, totalRows) {
  if (!totalRows) return 0;
  return Number(((expiredRows / totalRows) * 100).toFixed(2));
}

function createSocialListeningDataMaintenance({
  EchohuntSocialListeningPost,
  EchohuntSocialListeningSnapshot,
  EchohuntSocialListeningAccountSignal,
  EchohuntSocialListeningAlert,
  EchohuntSocialListeningTextCondensation,
  EchohuntSocialListeningJob,
}) {
  function getRetentionTargets(cutoff) {
    return [
      {
        key: "posts",
        label: "推文",
        retentionField: "postCreatedAt",
        model: EchohuntSocialListeningPost,
        where: { postCreatedAt: { [Op.lt]: cutoff } },
      },
      {
        key: "snapshots",
        label: "聚合快照",
        retentionField: "generatedAt",
        model: EchohuntSocialListeningSnapshot,
        where: { generatedAt: { [Op.lt]: cutoff } },
      },
      {
        key: "accountSignals",
        label: "账号动态",
        retentionField: "occurredAt",
        model: EchohuntSocialListeningAccountSignal,
        where: { occurredAt: { [Op.lt]: cutoff } },
      },
      {
        key: "alerts",
        label: "预警",
        retentionField: "triggeredAt",
        model: EchohuntSocialListeningAlert,
        where: { triggeredAt: { [Op.lt]: cutoff } },
      },
      {
        key: "textCondensations",
        label: "长文缓存",
        retentionField: "condensedAt",
        model: EchohuntSocialListeningTextCondensation,
        where: { condensedAt: { [Op.lt]: cutoff } },
      },
      {
        key: "completedJobs",
        label: "已完成任务",
        retentionField: "finishedAt",
        model: EchohuntSocialListeningJob,
        totalWhere: { status: { [Op.in]: COMPLETED_JOB_STATUSES } },
        where: {
          finishedAt: { [Op.lt]: cutoff },
          status: { [Op.in]: COMPLETED_JOB_STATUSES },
        },
      },
    ];
  }

  async function getCleanupStatus(now = new Date()) {
    const cutoff = getRetentionCutoff(now);
    const tables = [];

    for (const target of getRetentionTargets(cutoff)) {
      const [totalRows, expiredRows] = await Promise.all([
        target.totalWhere
          ? target.model.count({ where: target.totalWhere })
          : target.model.count(),
        target.model.count({ where: target.where }),
      ]);
      tables.push({
        key: target.key,
        label: target.label,
        retentionField: target.retentionField,
        totalRows: Number(totalRows || 0),
        expiredRows: Number(expiredRows || 0),
        expiredPercent: getExpiredPercent(Number(expiredRows || 0), Number(totalRows || 0)),
      });
    }

    const summary = tables.reduce(
      (result, table) => ({
        totalRows: result.totalRows + table.totalRows,
        expiredRows: result.expiredRows + table.expiredRows,
      }),
      { totalRows: 0, expiredRows: 0 }
    );

    return {
      retentionDays: SOCIAL_LISTENING_RETENTION_DAYS,
      cutoff: cutoff.toISOString(),
      measuredAt: now.toISOString(),
      schedule: {
        cron: SOCIAL_LISTENING_CLEANUP_CRON,
        timeZone: SOCIAL_LISTENING_CLEANUP_TIME_ZONE,
        nextRunAt: getNextCleanupAt(now).toISOString(),
      },
      summary: {
        ...summary,
        expiredPercent: getExpiredPercent(summary.expiredRows, summary.totalRows),
      },
      tables,
    };
  }

  async function cleanupExpiredData(options = {}) {
    const cutoff = getRetentionCutoff();
    const deleted = {};

    try {
      for (const target of getRetentionTargets(cutoff)) {
        deleted[target.key] = await target.model.destroy({ where: target.where });
      }

      const totalDeleted = Object.values(deleted).reduce((sum, count) => sum + Number(count || 0), 0);

      console.log(
        `[SocialListening] ✅ 已清理 31 天前数据：推文 ${deleted.posts} 条，快照 ${deleted.snapshots} 条，账号动态 ${deleted.accountSignals} 条，预警 ${deleted.alerts} 条，长文缓存 ${deleted.textCondensations} 条，已完成任务 ${deleted.completedJobs} 条（截止 ${cutoff.toISOString()}）`
      );
      return {
        cutoff: cutoff.toISOString(),
        completedAt: new Date().toISOString(),
        totalDeleted,
        deleted,
      };
    } catch (error) {
      console.error("[SocialListening] ❌ 清理 31 天前数据失败:", error);
      if (options?.throwOnError) throw error;
      return null;
    }
  }

  return { cleanupExpiredData, getCleanupStatus };
}

module.exports = {
  SOCIAL_LISTENING_CLEANUP_CRON,
  SOCIAL_LISTENING_CLEANUP_TIME_ZONE,
  SOCIAL_LISTENING_RETENTION_DAYS,
  createSocialListeningDataMaintenance,
  getNextCleanupAt,
  getRetentionCutoff,
};
