"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("XPrivateMessages", "campaignId", {
      type: Sequelize.STRING,
      allowNull: true,
      comment: "活动标识，用于避免同一活动重复发送消息",
    });

    // 添加索引
    await queryInterface.addIndex("XPrivateMessages", ["campaignId"], {
      name: "idx_private_message_campaign",
    });

    await queryInterface.addIndex(
      "XPrivateMessages",
      ["receiverId", "campaignId"],
      {
        name: "idx_private_message_receiver_campaign",
      }
    );
  },

  async down(queryInterface, Sequelize) {
    // 删除索引
    await queryInterface.removeIndex(
      "XPrivateMessages",
      "idx_private_message_receiver_campaign"
    );
    await queryInterface.removeIndex(
      "XPrivateMessages",
      "idx_private_message_campaign"
    );

    // 删除字段
    await queryInterface.removeColumn("XPrivateMessages", "campaignId");
  },
};
