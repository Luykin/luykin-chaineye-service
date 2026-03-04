'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    // 创建 XHuntWebUsers 表
    await queryInterface.createTable('XHuntWebUsers', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: '用户唯一标识符',
      },
      twitterId: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Twitter 用户 ID',
      },
      siteSource: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: '站点来源标识（如 airdrop, activity, data）',
      },
      username: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Twitter 用户名（@handle）',
      },
      displayName: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Twitter 显示名称',
      },
      avatar: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: '头像 URL',
      },
      xhuntUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: '关联的 XHuntUser.id（插件用户，可能为空）',
      },
      xhuntKolRank: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'XHunt KOL 排名（从 XHuntUser 同步或外部 API 获取）',
      },
      classification: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: '用户分类（KOL/项目方/机构/个人）',
      },
      twitterAccessToken: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Twitter OAuth Access Token',
      },
      twitterRefreshToken: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Twitter OAuth Refresh Token',
      },
      tokenExpiry: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Twitter Token 过期时间',
      },
      lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: '最后登录时间',
      },
      loginCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: '登录次数统计',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: '账号是否激活',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // 创建复合唯一索引
    await queryInterface.addIndex('XHuntWebUsers', ['twitterId', 'siteSource'], {
      unique: true,
      name: 'idx_twitter_site_unique',
    });

    // 创建其他索引
    await queryInterface.addIndex('XHuntWebUsers', ['siteSource'], {
      name: 'idx_site_source',
    });
    await queryInterface.addIndex('XHuntWebUsers', ['xhuntUserId'], {
      name: 'idx_xhunt_user_id',
    });
    await queryInterface.addIndex('XHuntWebUsers', ['username'], {
      name: 'idx_username',
    });

    // 创建 XHuntWebUserTokens 表
    await queryInterface.createTable('XHuntWebUserTokens', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        comment: 'Token 记录唯一标识符',
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'XHuntWebUsers',
          key: 'id',
        },
        comment: '关联用户 ID（指向 XHuntWebUser）',
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      siteSource: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: '站点来源标识（与用户表一致，用于验证）',
      },
      accessToken: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'JWT Token',
      },
      fingerprint: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: '设备指纹信息',
      },
      tokenExpiry: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Token 过期时间',
      },
      lastUsed: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: '最后使用时间',
      },
      isRevoked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: '是否已被撤销',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // 创建 Token 表索引
    await queryInterface.addIndex('XHuntWebUserTokens', ['userId'], {
      name: 'idx_web_user_id',
    });
    await queryInterface.addIndex('XHuntWebUserTokens', ['siteSource'], {
      name: 'idx_web_site_source',
    });
    await queryInterface.addIndex('XHuntWebUserTokens', ['tokenExpiry'], {
      name: 'idx_web_token_expiry',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('XHuntWebUserTokens');
    await queryInterface.dropTable('XHuntWebUsers');
  },
};
