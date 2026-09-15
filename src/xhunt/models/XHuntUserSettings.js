const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const XHuntUserSettings = sequelize.define(
    "XHuntUserSettings",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "配置记录唯一标识符",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "关联 XHuntUsers.id",
      },
      category: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: "all",
        comment: "配置类别：all(全量大对象) / cleaner / display / features",
      },
      settings: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: "用户具体配置内容 (JSONB)",
      },
      version: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 1,
        comment: "配置版本号，每次成功修改递增",
      },
      clientUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "客户端提交修改的时间戳",
      },
    },
    {
      tableName: "XHuntUserSettings",
      timestamps: true,
      indexes: [
        {
          name: "uq_xhunt_user_settings_user_category",
          unique: true,
          fields: ["userId", "category"],
        },
        {
          name: "idx_xhunt_user_settings_user_id",
          fields: ["userId"],
        },
      ],
    }
  );

  return XHuntUserSettings;
};
