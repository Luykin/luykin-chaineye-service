const { DataTypes } = require("sequelize");

/**
 * 投资关系(Investment)数据模型
 * 记录一个实体对另一个项目的投资事件
 * 这是一个多态关联模型，投资方(investor)可以是项目、机构或个人
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "Investment",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "投资关系唯一标识",
      },
      // 被投资方 (总是 Project)
      fundedProjectId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: "被投资项目的ID (关联 RootdataProjects.project_id)",
      },
      // 投资方 (多态)
      investorId: {
        type: DataTypes.BIGINT, // 使用 BIGINT 以兼容 Project/Organization 的 INTEGER 和 Person 的 BIGINT
        allowNull: false,
        comment: "投资方ID",
      },
      investorType: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "投资方类型 (Project, Organization, or Person)",
      },
      // 投资轮次信息
      round: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "投资轮次",
      },
      amount: {
        type: DataTypes.BIGINT,
        allowNull: true,
        comment: "投资金额",
      },
      date: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "投资日期",
      },
      lead: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: "是否为领投方",
      },
    },
    {
      tableName: "RootdataInvestments",
      timestamps: true,
      indexes: [
        { fields: ["fundedProjectId"] },
        { fields: ["investorId", "investorType"] },
      ],
    }
  );
};
