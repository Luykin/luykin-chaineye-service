const { DataTypes } = require("sequelize");

/**
 * 未注册用户登记表（保存未注册/未登录的 Twitter 用户信息）
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "UnregisteredUserRegistration",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "登记记录唯一标识符",
      },
      twitterId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: "Twitter ID 字符串（全局唯一，对应 id_str）",
      },
      name: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "用户显示名称",
      },
      screenName: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "用户推特号（screen_name）",
      },
      followersCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "粉丝数",
      },
      twitterCreatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Twitter 账户创建时间（来自 created_at）",
      },
      birthdate: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "用户生日信息（JSON 格式）",
      },
      rawData: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "原始 Twitter 用户数据（完整 JSON，原封不动保存）",
      },
    },
    {
      tableName: "UnregisteredUserRegistrations",
      timestamps: true, // 启用 createdAt 和 updatedAt（createdAt 作为登记时间）
      indexes: [
        {
          name: "idx_unregistered_twitter_id",
          fields: ["twitterId"],
          unique: true,
        },
        {
          name: "idx_unregistered_screen_name",
          fields: ["screenName"],
        },
        {
          name: "idx_unregistered_followers_count",
          fields: ["followersCount"],
        },
        {
          name: "idx_unregistered_created_at",
          fields: ["createdAt"],
        },
      ],
    }
  );
};

