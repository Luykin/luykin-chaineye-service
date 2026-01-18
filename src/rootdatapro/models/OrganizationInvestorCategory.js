const { DataTypes } = require("sequelize");

/**
 * 机构-投资者类型 关联表(OrganizationInvestorCategory)
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "OrganizationInvestorCategory",
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
      categoryId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "RootdataInvestorCategories",
          key: "category_id",
        },
      },
    },
    {
      tableName: "RootdataOrganizationInvestorCategories",
      timestamps: false,
      indexes: [
        {
          name: "unique_org_category_idx",
          unique: true,
          fields: ["organizationId", "categoryId"],
        },
      ],
    }
  );
};

