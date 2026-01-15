const { DataTypes } = require("sequelize");

/**
 * 投资者类型(InvestorCategory)数据模型
 * 仅供 Organization 使用
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "InvestorCategory",
    {
      category_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        comment: "投资者类型ID",
      },
      category_name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: "投资者类型名称",
      },
    },
    {
      tableName: "RootdataInvestorCategories",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["category_id"] },
        { fields: ["category_name"] },
      ],
    }
  );
};

