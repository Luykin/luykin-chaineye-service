const { DataTypes } = require("sequelize");

/**
 * 生态(Ecosystem)数据模型
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "Ecosystem",
    {
      ecosystem_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        comment: "生态ID",
      },
      ecosystem_name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: "生态名称",
      },
      project_num: {
        type: DataTypes.VIRTUAL,
        get() {
          // 这是一个计算属性，它依赖于名为 'Projects' 的关联
          // 如果在查询时通过 `include` 加载了 Projects 关联，则直接返回其长度
          if (this.Projects) {
            return this.Projects.length;
          }
          return null; // 否则返回 null，因为同步获取计数值是不现实的
        },
        comment: "该生态下的项目数量 (虚拟字段，动态计算)",
      },
    },
    {
      tableName: "RootdataEcosystems",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["ecosystem_id"] },
        { fields: ["ecosystem_name"] },
      ],
    }
  );
};
