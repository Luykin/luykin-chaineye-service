const { DataTypes } = require("sequelize");

/**
 * 机构(Organization)数据模型
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "Organization",
    {
      org_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        comment: "机构ID",
      },
      org_name: {
        type: DataTypes.STRING,
        comment: "机构名称",
      },
      logo: {
        type: DataTypes.STRING,
        comment: "机构 logo 的 URL",
      },
      establishment_date: {
        type: DataTypes.STRING,
        comment: "成立时间",
      },
      description: {
        type: DataTypes.TEXT,
        comment: "详细介绍",
      },
      active: {
        type: DataTypes.BOOLEAN,
        comment: "true:运营中; false:停止运营",
      },
      social_media: {
        type: DataTypes.JSONB,
        comment: "社交媒体链接（官网、推特、LinkedIn）",
      },
      events: {
        type: DataTypes.JSONB,
        comment: "事件时间线 (数组)",
      },
      X: {
        type: DataTypes.STRING,
        comment: "X链接",
      },
      rootdataurl: {
        type: DataTypes.STRING,
        comment: "机构对应的RootData链接",
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
      tableName: "RootdataOrganizations",
      timestamps: true,
      indexes: [{ unique: true, fields: ["org_id"] }, { fields: ["org_name"] }],
    }
  );
};
