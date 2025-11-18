const { DataTypes } = require("sequelize");

/**
 * UrlRequestStats URL请求统计表
 *
 * 用途：
 * - 统计每个URL路径在每5分钟时间窗口内的请求次数
 * - 支持按时间区间查询URL请求排行榜
 * - 用于分析接口使用情况
 *
 * 数据示例：
 * time_window          | url_path                                    | request_count | createdAt
 * ---------------------|---------------------------------------------|---------------|------------
 * 2025-01-16 10:00:00  | /api/xhunt/proxy/public/api/fundraising/search/legacy | 1234          | 2025-01-16 10:05:00
 * 2025-01-16 10:00:00  | /api/xhunt/stats                           | 56            | 2025-01-16 10:05:00
 * 2025-01-16 10:05:00  | /api/xhunt/proxy/public/api/fundraising/search/legacy | 1456          | 2025-01-16 10:10:00
 *
 * 说明：
 * - time_window: 5分钟时间窗口的开始时间（精确到分钟，秒为0）
 * - url_path: URL路径（不包含查询参数，如 "/api/xhunt/proxy/public/api/fundraising/search/legacy"）
 * - request_count: 该URL在该时间窗口内的请求次数（所有实例汇总后的）
 * - 同一时间窗口同一URL只有一条记录（通过联合唯一索引保证）
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "UrlRequestStats",
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
      urlPath: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: "url_path",
        comment: "URL路径（不包含查询参数）",
      },
      requestCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "request_count",
        comment: "该URL在该时间窗口内的请求次数（所有实例汇总后的）",
      },
    },
    {
      tableName: "UrlRequestStats",
      timestamps: true,
      indexes: [
        {
          name: "idx_time_window",
          fields: ["time_window"],
          comment: "时间窗口索引：用于快速查询某个时间区间的数据",
        },
        {
          name: "idx_url_path",
          fields: ["url_path"],
          comment: "URL路径索引：用于快速查询某个URL的数据",
        },
        {
          name: "idx_time_window_url_path",
          unique: true,
          fields: ["time_window", "url_path"],
          comment:
            "联合唯一索引：确保同一时间窗口同一URL只有一条记录，防止重复统计",
        },
      ],
    }
  );
};

