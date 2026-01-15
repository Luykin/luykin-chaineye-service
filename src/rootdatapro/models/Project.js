const { DataTypes } = require("sequelize");

/**
 * 项目(Project)数据模型
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "Project",
    {
      project_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        comment: "项目ID",
      },
      project_name: {
        type: DataTypes.STRING,
        comment: "项目名称",
      },
      logo: {
        type: DataTypes.STRING,
        comment: "项目 logo 的 URL",
      },
      token_symbol: {
        type: DataTypes.STRING,
        comment: "代币符号",
      },
      establishment_date: {
        type: DataTypes.STRING,
        comment: "成立时间",
      },
      one_liner: {
        type: DataTypes.TEXT,
        comment: "一句话介绍",
      },
      description: {
        type: DataTypes.TEXT,
        comment: "详细介绍",
      },
      active: {
        type: DataTypes.BOOLEAN,
        comment: "true:运营中; false:停止运营",
      },
      total_funding: {
        type: DataTypes.BIGINT,
        comment: "融资总额",
      },
      rootdataurl: {
        type: DataTypes.STRING,
        comment: "项目对应的RootData链接",
      },
      social_media: {
        type: DataTypes.JSONB,
        comment: "社交媒体链接 (对象)",
      },
      similar_project: {
        type: DataTypes.JSONB,
        comment: "同类项目 (数组)",
      },
      on_main_net: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        comment: "已上线的主网",
      },
      plan_to_launch: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        comment: "计划上线的生态",
      },
      on_test_net: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        comment: "已上线的测试网",
      },
      fully_diluted_market_cap: {
        type: DataTypes.STRING,
        comment: "完全稀释市值",
      },
      market_cap: {
        type: DataTypes.STRING,
        comment: "流通市值",
      },
      price: {
        type: DataTypes.STRING,
        comment: "价格",
      },
      event: {
        type: DataTypes.JSONB,
        comment: "项目重大事件 (数组)",
      },
      reports: {
        type: DataTypes.JSONB,
        comment: "新闻动态数据 (数组)",
      },
      token_launch_time: {
        type: DataTypes.STRING,
        comment: "代币发行时间 yyyy-MM",
      },
      contracts: {
        type: DataTypes.JSONB,
        comment: "合约信息 (数组)",
      },
      support_exchanges: {
        type: DataTypes.JSONB,
        comment: "支持的交易所 (数组)",
      },
      heat: {
        type: DataTypes.STRING,
        comment: "X热度值",
      },
      heat_rank: {
        type: DataTypes.INTEGER,
        comment: "X热度排名",
      },
      influence: {
        type: DataTypes.STRING,
        comment: "X影响力",
      },
      influence_rank: {
        type: DataTypes.INTEGER,
        comment: "X影响力排名",
      },
      followers: {
        type: DataTypes.INTEGER,
        comment: "X关注者数量",
      },
      following: {
        type: DataTypes.INTEGER,
        comment: "正在关注的数量",
      },
    },
    {
      tableName: "RootdataProjects",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["project_id"] },
        { fields: ["project_name"] },
        { fields: ["token_symbol"] },
      ],
    }
  );
};
