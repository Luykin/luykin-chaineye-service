const { DataTypes } = require("sequelize");

/**
 * 标签(Tag)数据模型
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "Tag",
    {
      tag_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        comment: "标签ID",
      },
      tag_name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: "标签名称",
      },
    },
    {
      tableName: "RootdataTags",
      timestamps: true,
      indexes: [{ unique: true, fields: ["tag_id"] }, { fields: ["tag_name"] }],
    }
  );
};
