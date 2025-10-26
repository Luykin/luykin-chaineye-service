const { DataTypes } = require("sequelize");

/**
 * DailyActiveUser 每日活跃用户记录表
 *
 * 用途：
 * - 追踪每个用户每天的活跃情况
 * - 支持计算用户首次活跃日期（用于cohort分析）
 * - 支持按日期统计日活用户数（DAU）
 * - 支持计算周级留存率（第2、3、4周留存）
 *
 * 数据示例：
 * userId      | date       | createdAt
 * ------------|------------|------------
 * user123     | 2025-01-27 | 2025-01-27 10:00
 * user123     | 2025-01-28 | 2025-01-28 09:30
 * user456     | 2025-01-27 | 2025-01-27 14:20
 *
 * 说明：
 * - userId: 用户唯一标识（必须是 x_user_id，只有已登录用户才会记录。未登录用户不会记录）
 * - date: 用户在该日期活跃（格式：YYYY-MM-DD，只存储日期，不包含时间）
 * - 同一用户每天最多一条记录（通过联合唯一索引 userId + date 保证）
 * - 写入条件：必须有 x_user_id，否则不会被记录
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "DailyActiveUser",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        comment: "主键ID",
      },
      userId: {
        type: DataTypes.STRING,
        allowNull: false,
        comment:
          "用户唯一标识（必须是 x_user_id，只有登录用户才会记录），用于区分不同用户",
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        comment:
          "用户活跃的日期（格式：YYYY-MM-DD，只存储日期，不包含时间）。表示用户在这一天产生了活跃行为（如登录、使用插件等）。每条记录代表某个用户在某个日期的活跃，同一用户同一天只能有一条记录。",
      },
    },
    {
      tableName: "DailyActiveUsers",
      timestamps: true,
      indexes: [
        {
          name: "idx_user_date",
          unique: true, // 确保同一用户同一天只能有一条记录
          fields: ["userId", "date"],
          comment:
            "联合唯一索引：确保每个用户在每天只有一条活跃记录，防止重复统计",
        },
        {
          name: "idx_date",
          fields: ["date"],
          comment: "日期索引：用于快速查询某个日期的所有活跃用户（日活统计）",
        },
        {
          name: "idx_user_id",
          fields: ["userId"],
          comment:
            "用户ID索引：用于快速查询某个用户的所有活跃日期（首次活跃日期、活跃历史等）",
        },
      ],
    }
  );
};
