const { DataTypes } = require("sequelize");

/**
 * 人物(Person)数据模型
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "Person",
    {
      people_id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        allowNull: false,
        comment: "人物ID",
      },
      introduce: {
        type: DataTypes.TEXT,
        comment: "人物介绍",
      },
      head_img: {
        type: DataTypes.STRING,
        comment: "头像URL",
      },
      one_liner: {
        type: DataTypes.STRING,
        comment: "简介",
      },
      X: {
        type: DataTypes.STRING,
        comment: "X链接",
      },
      people_name: {
        type: DataTypes.STRING,
        comment: "人物名称",
      },
      linkedin: {
        type: DataTypes.STRING,
        comment: "领英链接",
      },
      heat: {
        type: DataTypes.STRING,
        comment: "X热度值",
      },
      heat_rank: {
        type: DataTypes.STRING,
        comment: "X热度排名",
      },
      influence: {
        type: DataTypes.STRING,
        comment: "X影响力",
      },
      influence_rank: {
        type: DataTypes.STRING,
        comment: "X影响力排名",
      },
      followers: {
        type: DataTypes.STRING,
        comment: "X关注者数量",
      },
      following: {
        type: DataTypes.STRING,
        comment: "正在关注的数量",
      },
    },
    {
      tableName: "RootdataPeople",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["people_id"] },
        { fields: ["people_name"] },
        { fields: ["X"] },
      ],
    }
  );
};
