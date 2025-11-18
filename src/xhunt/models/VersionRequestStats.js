const { DataTypes } = require("sequelize");

/**
 * VersionRequestStats 版本请求统计表
 *
 * 用途：
 * - 统计每个版本在每5分钟时间窗口内的请求次数
 * - 支持按时间区间查询版本请求趋势
 * - 用于绘制版本请求折线图
 *
 * 数据示例：
 * time_window          | version | request_count | createdAt
 * ---------------------|---------|---------------|------------
 * 2025-01-16 10:00:00  | 1.1.1   | 33            | 2025-01-16 10:05:00
 * 2025-01-16 10:00:00  | 2.0.1   | 98901         | 2025-01-16 10:05:00
 * 2025-01-16 10:05:00  | 1.1.1   | 45            | 2025-01-16 10:10:00
 *
 * 说明：
 * - time_window: 5分钟时间窗口的开始时间（精确到分钟，秒为0）
 * - version: 版本号（如 "1.1.1", "2.0.1"）
 * - request_count: 该版本在该时间窗口内的请求次数（所有实例汇总后的）
 * - 同一时间窗口同一版本只有一条记录（通过联合唯一索引保证）
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "VersionRequestStats",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        comment: "主键ID",
      },
      timeWindow: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "time_window",
        comment:
          "5分钟时间窗口的开始时间（精确到分钟，秒为0）。例如：2025-01-16 10:00:00",
      },
      version: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: "版本号（如 '1.1.1', '2.0.1'）",
      },
      requestCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "request_count",
        comment: "该版本在该时间窗口内的请求次数（所有实例汇总后的）",
      },
    },
    {
      tableName: "VersionRequestStats",
      timestamps: true,
      indexes: [
        {
          name: "idx_time_window",
          fields: ["time_window"],
          comment: "时间窗口索引：用于快速查询某个时间区间的数据",
        },
        {
          name: "idx_version",
          fields: ["version"],
          comment: "版本索引：用于快速查询某个版本的数据",
        },
        {
          name: "idx_time_window_version",
          unique: true,
          fields: ["time_window", "version"],
          comment:
            "联合唯一索引：确保同一时间窗口同一版本只有一条记录，防止重复统计",
        },
      ],
    }
  );
};

