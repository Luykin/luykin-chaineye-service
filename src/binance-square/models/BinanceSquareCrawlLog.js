const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "BinanceSquareCrawlLog",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      taskType: {
        type: DataTypes.ENUM("following", "post", "target_calculate"),
        allowNull: false,
        comment: "任务类型",
      },
      status: {
        type: DataTypes.ENUM("success", "failed", "partial"),
        allowNull: false,
        comment: "执行状态",
      },
      targetId: {
        type: DataTypes.STRING(128),
        comment: "目标标识（用户名/帖子ID）—— target_calculate任务无此字段",
      },
      filterType: {
        type: DataTypes.ENUM("ALL", "REPLY", "QUOTE"),
        comment: "帖子抓取的filterType —— 非帖子任务为空",
      },
      errorMessage: {
        type: DataTypes.TEXT,
        comment: "错误信息 —— 失败时记录",
      },
      durationMs: {
        type: DataTypes.INTEGER,
        comment: "耗时毫秒 —— 失败时可能为空",
      },
      itemsCount: {
        type: DataTypes.INTEGER,
        comment: "抓取项目数 —— 失败时可能为空",
      },
      snapshotId: {
        type: DataTypes.STRING(64),
        comment: "关联镜像批次ID —— 非帖子任务为空",
      },
      failedDetails: {
        type: DataTypes.JSON,
        comment: "失败详情 —— [{username, error, time}]",
      },
    },
    {
      tableName: "BinanceSquareCrawlLogs",
      timestamps: true,
      indexes: [
        { fields: ["taskType", "status"], name: "idx_binance_square_logs_task_status" },
        { fields: ["filterType"], name: "idx_binance_square_logs_filter_type" },
        { fields: ["targetId"], name: "idx_binance_square_logs_target" },
        { fields: ["snapshotId"], name: "idx_binance_square_logs_snapshot" },
        { fields: ["createdAt"], name: "idx_binance_square_logs_created" },
      ],
    }
  );
};
