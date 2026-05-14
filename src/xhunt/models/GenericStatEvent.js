const { DataTypes } = require("sequelize");

/**
 * GenericStatEvent 通用统计事件表
 *
 * 用途：
 * - 承载 XHunt / RootDataPro / Admin 等模块的低频统计事件
 * - 支持按 type、对象、用户、时间范围做统一筛选
 * - 支持后续针对不同 type 做聚合分析
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "GenericStatEvent",
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        comment: "主键 ID",
      },
      type: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: "统计类型，例如 xhunt.kol_chat.chat",
      },
      source: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: "来源模块，例如 xhunt/rootdatapro/admin",
      },
      action: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: "行为类型，例如 chat/view/click/search",
      },
      subjectType: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "subject_type",
        comment: "被统计对象类型，例如 kol/campaign/api",
      },
      subjectId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "subject_id",
        comment: "被统计对象 ID",
      },
      subjectName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "subject_name",
        comment: "被统计对象展示名称快照",
      },
      actorType: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "actor_type",
        comment: "触发者类型，例如 xhunt_user/admin/guest",
      },
      actorId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "actor_id",
        comment: "触发者 ID",
      },
      actorName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "actor_name",
        comment: "触发者展示名称快照",
      },
      eventAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "event_at",
        comment: "事件发生时间",
      },
      countValue: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        field: "count_value",
        comment: "通用计数值，默认 1",
      },
      numericValue: {
        type: DataTypes.DECIMAL(20, 6),
        allowNull: true,
        field: "numeric_value",
        comment: "通用数值指标，备用",
      },
      dimensions: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: "可扩展维度 JSON",
      },
      metrics: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: "可扩展指标 JSON",
      },
      meta: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: "调试/追踪补充信息 JSON",
      },
    },
    {
      tableName: "GenericStatEvents",
      timestamps: true,
      indexes: [
        {
          name: "idx_generic_stat_events_type_event_at",
          fields: ["type", "event_at"],
        },
        {
          name: "idx_generic_stat_events_event_at",
          fields: ["event_at"],
        },
        {
          name: "idx_generic_stat_events_subject_event_at",
          fields: ["subject_type", "subject_id", "event_at"],
        },
        {
          name: "idx_generic_stat_events_actor_event_at",
          fields: ["actor_type", "actor_id", "event_at"],
        },
      ],
    }
  );
};
