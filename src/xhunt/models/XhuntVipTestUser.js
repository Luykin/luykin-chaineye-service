const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const XhuntVipTestUser = sequelize.define(
    "XhuntVipTestUser",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "Twitter 用户名（小写存储）",
      },
      listType: {
        type: DataTypes.ENUM("vip", "internal_test"),
        allowNull: false,
        comment: "名单类型：vip 或 internal_test",
      },
    },
    {
      tableName: "xhunt_vip_test_users",
      indexes: [
        {
          unique: true,
          fields: ["username", "listType"],
          name: "idx_xhunt_vip_test_users_username_list_type",
        },
        {
          fields: ["listType"],
          name: "idx_xhunt_vip_test_users_list_type",
        },
      ],
    }
  );

  return XhuntVipTestUser;
};
