const { DataTypes } = require("sequelize");

/**
 * 项目标签关联表(ProjectTag)
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "ProjectTag",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      projectId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "RootdataProjects",
          key: "project_id",
        },
      },
      tagId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "RootdataTags",
          key: "tag_id",
        },
      },
    },
    {
      tableName: "RootdataProjectTags",
      timestamps: false, // 中间表通常不需要时间戳
      indexes: [{ unique: true, fields: ["projectId", "tagId"] }],
    }
  );
};
