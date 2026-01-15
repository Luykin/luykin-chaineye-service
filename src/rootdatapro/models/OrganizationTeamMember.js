const { DataTypes } = require("sequelize");

/**
 * 机构团队成员(OrganizationTeamMember)数据模型
 * 这是 Organization 和 Person 之间的中间表
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "OrganizationTeamMember",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      organizationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: "机构ID (关联 RootdataOrganizations.org_id)",
        references: {
          model: 'RootdataOrganizations',
          key: 'org_id',
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
      tableName: "RootdataOrganizationTeamMembers",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["organizationId", "personId"] },
        { fields: ["organizationId"] },
        { fields: ["personId"] },
      ],
    }
  );
};

