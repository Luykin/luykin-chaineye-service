const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "BinanceSquareSeedConfig",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "用户名 —— 手动配置时必须提供",
      },
      displayName: {
        type: DataTypes.STRING(256),
        comment: "显示名称 —— 可选",
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: "排序权重",
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: "是否激活",
      },
      description: {
        type: DataTypes.TEXT,
        comment: "备注说明",
      },
    },
    {
      tableName: "BinanceSquareSeedConfigs",
      timestamps: true,
      indexes: [
        { unique: true, fields: ["username"], name: "idx_binance_square_seed_configs_username_unique" },
        { fields: ["isActive", "sortOrder"], name: "idx_binance_square_seed_configs_active_sort" },
      ],
    }
  );
};
