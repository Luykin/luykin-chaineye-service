"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("CampaignRegistrations", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      campaign: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "活动标识，例如 mantle3、partner2025 等",
      },
      xHuntUserId: {
        type: Sequelize.UUID,
        allowNull: false,
        comment: "关联的 XHuntUser.id",
      },
      twitterId: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "用户 Twitter ID",
      },
      username: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "用户登录名",
      },
      displayName: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "用户显示名称",
      },
      avatar: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "用户头像 URL",
      },
      invitedByCode: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "邀请人的邀请码",
      },
      invitedByUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: "邀请人 XHuntUser.id",
      },
      invitedByTwitterId: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "邀请人的 Twitter ID",
      },
      invitedByUserInfo: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: "邀请人详细信息",
      },
      invitedByUsername: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "邀请人的用户名",
      },
      evmAddress: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "报名用户的 EVM 地址",
      },
      registrationUrl: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "报名来源 URL",
      },
      registeredAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
        comment: "报名时间",
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

    await queryInterface.addIndex("CampaignRegistrations", ["campaign"], {
      name: "idx_campaign_reg_campaign",
    });
    await queryInterface.addIndex(
      "CampaignRegistrations",
      ["campaign", "xHuntUserId"],
      { name: "idx_campaign_reg_campaign_user" }
    );
    await queryInterface.addIndex(
      "CampaignRegistrations",
      ["campaign", "twitterId"],
      { name: "idx_campaign_reg_campaign_twitter" }
    );
    await queryInterface.addIndex(
      "CampaignRegistrations",
      ["campaign", "evmAddress"],
      { name: "idx_campaign_reg_campaign_evm" }
    );
    await queryInterface.addIndex("CampaignRegistrations", ["invitedByCode"], {
      name: "idx_campaign_reg_invite_code",
    });
    await queryInterface.addIndex("CampaignRegistrations", ["invitedByUserId"], {
      name: "idx_campaign_reg_invite_user",
    });
    await queryInterface.addIndex(
      "CampaignRegistrations",
      ["invitedByTwitterId"],
      { name: "idx_campaign_reg_invite_twitter" }
    );
    await queryInterface.addIndex(
      "CampaignRegistrations",
      ["invitedByUsername"],
      { name: "idx_campaign_reg_invite_username" }
    );
    await queryInterface.addIndex(
      "CampaignRegistrations",
      ["registeredAt"],
      { name: "idx_campaign_reg_registered_at" }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("CampaignRegistrations");
  },
};
