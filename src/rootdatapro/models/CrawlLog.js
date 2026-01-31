const { DataTypes } = require("sequelize");

/**
 * 爬虫日志(CrawlLog)数据模型
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  const CrawlLog = sequelize.define(
    "CrawlLog",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      entity_id: {
        type: DataTypes.BIGINT, // 使用 BIGINT 以兼容所有实体ID类型
        allowNull: false,
        comment: "被爬取实体的ID (project_id, org_id, people_id)",
      },
      entity_type: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "被爬取实体的类型 (Project, Organization, Person)",
      },
      url: {
        type: DataTypes.TEXT, // URL可能很长
        allowNull: false,
        comment: "被爬取的URL",
      },
      status: {
        type: DataTypes.ENUM('success', 'failure'),
        allowNull: false,
        comment: "爬取状态",
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "如果失败，记录错误信息",
      },
      new_data_summary: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: "本次爬取新增的数据ID摘要，格式: {tableName: [new_ids]}",
      },
      crawled_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: "爬取时间",
      },
    },
    {
      tableName: "RootdataCrawlLogs",
      timestamps: false, // 使用 crawled_at 代替
      indexes: [
        { fields: ["entity_id", "entity_type"] },
        { fields: ["status"] },
        { fields: ["crawled_at"] },
        { fields: ["url", "status"] },
      ],
    }
  );

  /**
   * 统计去重后的失败URL总数
   * @returns {Promise<number>}
   */
  CrawlLog.countFailedUrls = async function () {
    const { sequelize } = this;
    const results = await CrawlLog.findAll({
      attributes: [
        'entity_type',
        [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('url'))), 'count'],
      ],
      where: {
        status: 'failure',
        [sequelize.Op.and]: sequelize.literal(`
          NOT EXISTS (
            SELECT 1
            FROM "${CrawlLog.tableName}" AS "successful_logs"
            WHERE "successful_logs"."url" = "CrawlLog"."url"
            AND "successful_logs"."status" = 'success'
          )
        `)
      },
      group: ['entity_type'],
      raw: true,
    });

    const counts = { Project: 0, Organization: 0, Person: 0 };
    for (const row of results) {
      if (counts.hasOwnProperty(row.entity_type)) {
        counts[row.entity_type] = parseInt(row.count, 10);
      }
    }
    return counts;
  };

  return CrawlLog;
};
