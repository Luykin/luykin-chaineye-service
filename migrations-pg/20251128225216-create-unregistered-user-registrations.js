"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("UnregisteredUserRegistrations", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
        comment: "登记记录唯一标识符",
      },
      twitterId: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
        comment: "Twitter ID 字符串（全局唯一，对应 id_str）",
      },
      name: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "用户显示名称",
      },
      screenName: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "用户推特号（screen_name）",
      },
      followersCount: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: "粉丝数",
      },
      twitterCreatedAt: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: "Twitter 账户创建时间（来自 created_at）",
      },
      birthdate: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: "用户生日信息（JSON 格式）",
      },
      rawData: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: "原始 Twitter 用户数据（完整 JSON，原封不动保存）",
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn("NOW"),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn("NOW"),
      },
    });

    // 添加索引
    await queryInterface.addIndex(
      "UnregisteredUserRegistrations",
      ["twitterId"],
      {
        name: "idx_unregistered_twitter_id",
        unique: true,
      }
    );
    await queryInterface.addIndex(
      "UnregisteredUserRegistrations",
      ["screenName"],
      {
        name: "idx_unregistered_screen_name",
      }
    );
    await queryInterface.addIndex(
      "UnregisteredUserRegistrations",
      ["followersCount"],
      {
        name: "idx_unregistered_followers_count",
      }
    );
    await queryInterface.addIndex(
      "UnregisteredUserRegistrations",
      ["createdAt"],
      {
        name: "idx_unregistered_created_at",
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("UnregisteredUserRegistrations");
  },
};

