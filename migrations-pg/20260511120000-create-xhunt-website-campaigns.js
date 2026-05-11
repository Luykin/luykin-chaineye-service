'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable('XHuntWebsiteCampaigns', {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      nacosCampaignId: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      campaignKey: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      deletedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastSyncedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      testingPhase: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      sortWeight: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      displayNameZh: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      displayNameEn: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      projectIntroductionZh: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      projectIntroductionEn: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      startAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      endAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      rewardAmount: {
        type: DataTypes.DECIMAL(36, 8),
        allowNull: true,
      },
      rewardParticipantCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      rewardUnit: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      guideUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      activeUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      logos: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      tags: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      writingThemes: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      nacosPayload: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      webStatus: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'draft',
      },
      webAnnouncementZh: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      webAnnouncementEn: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      webRewardTextZh: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      webRewardTextEn: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      webNoteZh: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      webNoteEn: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      claimPoiContractAddress: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      claimPowContractAddress: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      claimEssayContractAddress: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      pageTemplate: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: 'standard',
      },
      templateConfig: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      websiteExtra: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('XHuntWebsiteCampaigns', {
      fields: ['nacosCampaignId'],
      unique: true,
      name: 'idx_xhunt_website_campaigns_nacos_campaign_id_unique',
    });
    await queryInterface.addIndex('XHuntWebsiteCampaigns', {
      fields: ['campaignKey'],
      name: 'idx_xhunt_website_campaigns_campaign_key',
    });
    await queryInterface.addIndex('XHuntWebsiteCampaigns', {
      fields: ['slug'],
      unique: true,
      name: 'idx_xhunt_website_campaigns_slug_unique',
    });
    await queryInterface.addIndex('XHuntWebsiteCampaigns', {
      fields: ['webStatus'],
      name: 'idx_xhunt_website_campaigns_web_status',
    });
    await queryInterface.addIndex('XHuntWebsiteCampaigns', {
      fields: ['isDeleted', 'webStatus'],
      name: 'idx_xhunt_website_campaigns_deleted_status',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('XHuntWebsiteCampaigns');
  },
};
