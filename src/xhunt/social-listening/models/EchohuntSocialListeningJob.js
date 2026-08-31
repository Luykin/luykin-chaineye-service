const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "EchohuntSocialListeningJob",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, comment: "后台任务 ID" },
      boardId: { type: DataTypes.UUID, allowNull: false, comment: "关联 EchohuntSocialListeningBoards.id" },
      jobType: { type: DataTypes.STRING(64), allowNull: false, comment: "任务类型：history_backfill/incremental/manual_refresh/reanalyze" },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "pending", comment: "任务状态：pending/running/succeeded/failed/skipped/cancelled" },
      rangeStartAt: { type: DataTypes.DATE, allowNull: true, comment: "本任务处理时间范围开始" },
      rangeEndAt: { type: DataTypes.DATE, allowNull: true, comment: "本任务处理时间范围结束" },
      progress: { type: DataTypes.JSONB, allowNull: true, comment: "任务进度 JSON：stage/window/counters/warnings/heartbeat 等" },
      metadata: { type: DataTypes.JSONB, allowNull: true, comment: "任务参数 JSON：stage、overlap、触发来源详情等" },
      startedAt: { type: DataTypes.DATE, allowNull: true, comment: "任务开始执行时间" },
      finishedAt: { type: DataTypes.DATE, allowNull: true, comment: "任务结束时间" },
      errorCode: { type: DataTypes.STRING(64), allowNull: true, comment: "任务失败错误码" },
      errorMessage: { type: DataTypes.TEXT, allowNull: true, comment: "任务失败错误信息摘要" },
      triggeredBy: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "system", comment: "触发方：system/admin/user" },
      triggeredByAdminId: { type: DataTypes.INTEGER, allowNull: true, comment: "后台触发任务的管理员 ID" },
      triggeredByAuthCenterUserId: { type: DataTypes.UUID, allowNull: true, comment: "前台触发任务的 AuthCenter 用户 ID" },
    },
    {
      tableName: "EchohuntSocialListeningJobs",
      timestamps: true,
      indexes: [
        { name: "idx_echohunt_sl_jobs_board_status_created", fields: ["boardId", "status", "createdAt"] },
        { name: "idx_echohunt_sl_jobs_type_status", fields: ["jobType", "status"] },
      ],
    }
  );
};
