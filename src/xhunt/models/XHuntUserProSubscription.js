const { DataTypes } = require("sequelize");

/**
 * XHuntUserProSubscription 用户 Pro 订阅记录表
 * 用于记录用户每次开通 Pro 版本的完整信息，支持历史追溯
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "XHuntUserProSubscription",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "订阅记录唯一标识符",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "XHuntUsers",
          key: "id",
        },
        comment: "关联用户 ID（指向 XHuntUser）",
      },
      startTime: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: "开通开始时间",
      },
      endTime: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: "开通截止时间",
      },
      planType: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "vip-base",
        comment: "Pro 套餐版本（如 vip-base，未来可能有更多套餐）",
      },
      reason: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "开通原因（如：paid、invited、other 或自定义原因）",
      },
      reasonDetail: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "开通原因详细说明（可选，用于补充 reason 字段）",
      },
      pluginVersion: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "开通时插件的版本号",
      },
      pageUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "开通时的网页地址",
      },
      proInviteCode: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Pro 邀请码（可选，如果是通过邀请码开通的则记录）",
      },
    },
    {
      tableName: "XHuntUserProSubscriptions",
      timestamps: true,
      indexes: [
        {
          name: "idx_pro_subscription_user_id",
          fields: ["userId"],
        },
        {
          name: "idx_pro_subscription_end_time",
          fields: ["endTime"],
        },
        {
          name: "idx_pro_subscription_user_end_time",
          fields: ["userId", "endTime"],
          comment: "复合索引：用于查询用户当前有效订阅",
        },
        {
          name: "idx_pro_subscription_plan_type",
          fields: ["planType"],
        },
      ],
    }
  );
};
