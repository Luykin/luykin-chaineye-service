const { DataTypes } = require("sequelize");

/**
 * XHuntHotVoteTopic 热点投票议题主表
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "XHuntHotVoteTopic",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "议题唯一ID",
      },
      title: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: "纯文本标题 (限100字，兼容旧字段，展示优先使用titleI18n)",
      },
      titleI18n: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: "标题多语言内容，例如 { zh, en }",
      },
      titleHtml: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "富文本标题 (限1000字符，白名单HTML标签)",
      },
      summary: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: "一句话核心冲突介绍 (限100字，兼容旧字段，展示优先使用summaryI18n)",
      },
      summaryI18n: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: "核心冲突介绍多语言内容，例如 { zh, en }",
      },
      summaryHtml: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "富文本核心冲突介绍 (限1000字符，白名单HTML标签)",
      },
      topicType: {
        type: DataTypes.ENUM("person_pk", "general_topic"),
        defaultValue: "person_pk",
        comment: "议题形式: 人物PK / 普通议题",
      },
      options: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: "选项定义: [{ id, name, nameI18n: { zh, en }, avatar, twitterHandle, color, isGua }]",
      },
      displayDomains: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: ["web3"],
        comment: "可见领域: ['web3', 'ai']",
      },
      displayLanguages: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: ["zh"],
        comment: "可见语言: ['zh', 'en']",
      },
      testingPhase: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "是否处于测试阶段 (测试阶段仅对 testList 可见)",
      },
      testList: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: false,
        defaultValue: [],
        comment: "内部测试人员名单 (Twitter handle 或 ID 列表)",
      },
      maxRevotes: {
        type: DataTypes.INTEGER,
        defaultValue: 2,
        comment: "允许修改选择的最大次数 (默认2次)",
      },
      status: {
        type: DataTypes.ENUM("draft", "published", "ended", "archived"),
        defaultValue: "draft",
        comment: "议题状态",
      },
      sortWeight: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: "排序权重 (数值大者优先展示)",
      },
      startTime: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "议题开始时间",
      },
      endTime: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "议题结束时间",
      },
    },
    {
      tableName: "XHuntHotVoteTopics",
      timestamps: true,
      indexes: [
        { fields: ["status", "sortWeight"] },
        { fields: ["testingPhase"] },
        { fields: ["createdAt"] },
      ],
    }
  );
};
