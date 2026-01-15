const { DataTypes } = require("sequelize");

/**
 * 项目团队成员(ProjectTeamMember)数据模型
 * 这是 Project 和 Person 之间的中间表
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "ProjectTeamMember",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      projectId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: "项目ID (关联 RootdataProjects.project_id)",
        references: {
          model: 'RootdataProjects',
          key: 'project_id',
        }
      },
      personId: {
        type: DataTypes.BIGINT,
        allowNull: false,
        comment: "成员ID (关联 RootdataPeople.people_id)",
        references: {
          model: 'RootdataPeople',
          key: 'people_id',
        }
      },
      position: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "职位",
      },
    },
    {
      tableName: "RootdataProjectTeamMembers",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["projectId", "personId"] },
        { fields: ["projectId"] },
        { fields: ["personId"] },
      ],
    }
  );
};

