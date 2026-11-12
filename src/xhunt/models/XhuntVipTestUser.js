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
        allowNull: true,
        comment: "Twitter 用户名（小写存储）",
      },
      twitterId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: "Twitter 用户 ID（同步自 data.cryptohunt.ai）",
      },
      listType: {
        type: DataTypes.ENUM("vip", "internal_test"),
        allowNull: false,
        comment: "名单类型：vip 或 internal_test",
      },
      vipExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "VIP 权益的权威过期时间",
      },
      vipOrigin: {
        type: DataTypes.STRING(32),
        allowNull: true,
        validate: { isIn: [["legacy_manual", "membership_api"]] },
        comment: "VIP 首次来源，写入后不可变",
      },
      vipLastApiGrantedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "最近一次会员接口开通成功时间",
      },
      vipLastApiOrderNo: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: "最近一次会员接口成功订单号",
      },
      vipForceExpiredAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "最近一次强制过期时间",
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
        {
          fields: ["twitterId", "listType"],
          name: "idx_xhunt_vip_test_users_twitter_id_list_type",
        },
        {
          unique: true,
          fields: ["twitterId"],
          where: { listType: "vip" },
          name: "uq_xhunt_vip_test_users_vip_twitter_id",
        },
      ],
    }
  );

  return XhuntVipTestUser;
};
