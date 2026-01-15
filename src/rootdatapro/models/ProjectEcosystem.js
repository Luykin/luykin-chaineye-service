const { DataTypes } = require("sequelize");

/**
 * 项目生态关联表(ProjectEcosystem)
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "ProjectEcosystem",
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
      ecosystemId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "RootdataEcosystems",
          key: "ecosystem_id",
        },
      },
    },
    {
      tableName: "RootdataProjectEcosystems",
      timestamps: false,
      indexes: [{ unique: true, fields: ["projectId", "ecosystemId"] }],
    }
  );
};
