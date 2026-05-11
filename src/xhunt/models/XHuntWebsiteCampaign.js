const { DataTypes } = require("sequelize");

/**
 * XHunt 网站活动配置表
 * Nacos 提供共享字段，数据库维护网站专属字段
 * @param {import('sequelize').Sequelize} sequelize
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "XHuntWebsiteCampaign",
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },
      nacosCampaignId: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        comment: "对应 Nacos campaign.id",
      },
      campaignKey: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: "活动业务 key",
      },
      slug: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        comment: "网站详情路由标识",
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
        defaultValue: "draft",
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
        defaultValue: "standard",
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
    },
    {
      tableName: "XHuntWebsiteCampaigns",
      timestamps: true,
      indexes: [
        {
          name: "idx_xhunt_website_campaigns_nacos_campaign_id_unique",
          fields: ["nacosCampaignId"],
          unique: true,
        },
        {
          name: "idx_xhunt_website_campaigns_campaign_key",
          fields: ["campaignKey"],
        },
        {
          name: "idx_xhunt_website_campaigns_slug_unique",
          fields: ["slug"],
          unique: true,
        },
        {
          name: "idx_xhunt_website_campaigns_web_status",
          fields: ["webStatus"],
        },
        {
          name: "idx_xhunt_website_campaigns_deleted_status",
          fields: ["isDeleted", "webStatus"],
        },
      ],
    }
  );
};
