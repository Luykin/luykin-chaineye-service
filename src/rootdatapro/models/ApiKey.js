const { DataTypes } = require("sequelize");

/**
 * RootDataPro Open API Key
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "ApiKey",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "主键",
      },
      key: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: "API Key 字符串（客户端通过 header: pro-api-key 传入）",
      },
      status: {
        type: DataTypes.ENUM("active", "disabled"),
        allowNull: false,
        defaultValue: "active",
        comment: "Key 状态：active 可用，disabled 禁用",
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "过期时间；为空表示不过期",
      },
      credits_total: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
        comment: "总额度（创建/充值时写入，用于展示/对账）",
      },
      credits_remaining: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
        comment: "剩余额度（每次调用按接口 cost 扣减）",
      },
      last_used_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "最后一次调用时间",
      },
      remark: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "备注（例如客户名称/用途/工单号等）",
      },
    },
    {
      tableName: "RootdataApiKeys",
      timestamps: false,
      indexes: [{ fields: ["key"], unique: true }],
    }
  );
};

