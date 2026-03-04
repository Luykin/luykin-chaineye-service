const { DataTypes } = require("sequelize");

/**
 * XHuntWebUser 周边网站用户表
 * 支持多站点用户隔离，同一 Twitter 账号在不同站点是独立记录
 * @param {import('sequelize').Sequelize} sequelize
 * @returns {any}
 */
module.exports = (sequelize) => {
  return sequelize.define(
    "XHuntWebUser",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: "用户唯一标识符",
      },
      twitterId: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "Twitter 用户 ID",
      },
      siteSource: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "站点来源标识（如 'airdrop', 'activity', 'data'）",
      },
      username: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "Twitter 用户名（@handle）",
      },
      displayName: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Twitter 显示名称",
      },
      avatar: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "头像 URL",
      },
      xhuntUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "关联的 XHuntUser.id（插件用户，可能为空）",
      },
      xhuntKolRank: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "XHunt KOL 排名（从 XHuntUser 同步或外部 API 获取）",
      },
      classification: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "用户分类（KOL/项目方/机构/个人）",
      },
      twitterAccessToken: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Twitter OAuth Access Token",
      },
      twitterRefreshToken: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Twitter OAuth Refresh Token",
      },
      tokenExpiry: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Twitter Token 过期时间",
      },
      lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "最后登录时间",
      },
      loginCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "登录次数统计",
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "账号是否激活",
      },
    },
    {
      tableName: "XHuntWebUsers",
      timestamps: true,
      indexes: [
        {
          name: "idx_twitter_site_unique",
          fields: ["twitterId", "siteSource"],
          unique: true,
        },
        {
          name: "idx_site_source",
          fields: ["siteSource"],
        },
        {
          name: "idx_xhunt_user_id",
          fields: ["xhuntUserId"],
        },
        {
          name: "idx_username",
          fields: ["username"],
        },
      ],
    }
  );
};
