const { DataTypes } = require("sequelize");

/**
 * 机构标签关联表(OrganizationTag)
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "OrganizationTag",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      organizationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "RootdataOrganizations",
          key: "org_id",
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
      tableName: "RootdataOrganizationTags",
      timestamps: false,
      indexes: [{ unique: true, fields: ["organizationId", "tagId"] }],
    }
  );
};
