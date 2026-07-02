"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("CampaignRegistrations");

    if (!table.authCenterUserId) {
      await queryInterface.addColumn("CampaignRegistrations", "authCenterUserId", {
        type: Sequelize.UUID,
        allowNull: true,
        comment: "EchoHunt/Auth Center 用户 ID，插件报名为空",
      });
    }

    if (!table.registrationSource) {
      await queryInterface.addColumn("CampaignRegistrations", "registrationSource", {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "extension",
        comment: "报名来源：extension / echohunt_web / admin / other",
      });
    }

    if (!table.registrationClient) {
      await queryInterface.addColumn("CampaignRegistrations", "registrationClient", {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: "报名客户端标识，例如 xhunt_extension / echohunt",
      });
    }

    if (!table.registrationMetadata) {
      await queryInterface.addColumn("CampaignRegistrations", "registrationMetadata", {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: "来源相关元数据",
      });
    }

    await queryInterface
      .addIndex("CampaignRegistrations", ["campaign", "registrationSource"], {
        name: "idx_campaign_reg_campaign_source",
        concurrently: true,
      })
      .catch(() => {});

    await queryInterface
      .addIndex("CampaignRegistrations", ["campaign", "authCenterUserId"], {
        name: "idx_campaign_reg_campaign_auth_center_user",
        concurrently: true,
      })
      .catch(() => {});

    await queryInterface
      .addIndex("CampaignRegistrations", ["campaign", "twitterId"], {
        name: "ux_campaign_reg_campaign_twitter",
        unique: true,
        concurrently: true,
      })
      .catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface
      .removeIndex("CampaignRegistrations", "idx_campaign_reg_campaign_auth_center_user")
      .catch(() => {});
    await queryInterface
      .removeIndex("CampaignRegistrations", "idx_campaign_reg_campaign_source")
      .catch(() => {});
    await queryInterface
      .removeIndex("CampaignRegistrations", "ux_campaign_reg_campaign_twitter")
      .catch(() => {});

    const table = await queryInterface.describeTable("CampaignRegistrations");
    if (table.registrationMetadata) await queryInterface.removeColumn("CampaignRegistrations", "registrationMetadata");
    if (table.registrationClient) await queryInterface.removeColumn("CampaignRegistrations", "registrationClient");
    if (table.registrationSource) await queryInterface.removeColumn("CampaignRegistrations", "registrationSource");
    if (table.authCenterUserId) await queryInterface.removeColumn("CampaignRegistrations", "authCenterUserId");
  },
};
