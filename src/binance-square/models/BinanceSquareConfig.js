const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "BinanceSquareConfig",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      configKey: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: "配置项key",
      },
      configValue: {
        type: DataTypes.STRING(256),
        allowNull: false,
        comment: "配置项value（字符串存储，使用时转换）",
      },
      description: {
        type: DataTypes.TEXT,
        comment: "配置说明",
      },
      minValue: {
        type: DataTypes.STRING(64),
        comment: "最小值（用于前端校验，数字类型时）",
      },
      maxValue: {
        type: DataTypes.STRING(64),
        comment: "最大值（用于前端校验，数字类型时）",
      },
      updatedBy: {
        type: DataTypes.STRING(128),
        comment: "最后修改人（admin邮箱）",
      },
    },
    {
      tableName: "BinanceSquareConfigs",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["configKey"], name: "idx_binance_square_configs_key_unique" },
      ],
    }
  );
};
