'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable('xhunt_special_user_markers', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: '目标 Twitter 用户名（小写存储，无@）',
      },
      twitter_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: '目标账号 Twitter 数字 ID',
      },
      marker_text: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: '标记文本，如：疑似诈骗',
      },
      color_preset: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'danger-red',
        comment: '预设色系: danger-red, warning-orange, info-blue, success-green, purple-special, gold-amber, neutral-gray',
      },
      variant: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'subtle',
        comment: '徽章形态: subtle(轻柔), solid(实色), outline(线框), glow(发光)',
      },
      icon: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'none',
        comment: '微型图标: none, shield-alert, alert-triangle, shield-check, badge-check, skull, flame, crown, bot, ban, zap',
      },
      effect: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'none',
        comment: '动画特效: none, pulse(轻微呼吸)',
      },
      custom_text_color: {
        type: DataTypes.STRING(32),
        allowNull: true,
        comment: '自定义文字颜色 (覆盖预设)',
      },
      custom_bg_color: {
        type: DataTypes.STRING(32),
        allowNull: true,
        comment: '自定义背景颜色 (覆盖预设)',
      },
      description: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: '标记原因或说明备注 (Tooltip展示)',
      },
      link_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: '详情或佐证链接',
      },
      visible_scope: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'all',
        comment: '可见性范围: all(全员可见), whitelist(指定白名单用户可见)',
      },
      visible_twids: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: '指定可见用户的 Twitter ID 字符串数组',
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: '是否启用',
      },
      operator_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: '最后操作人 ID',
      },
      operator_email: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: '最后操作人邮箱',
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('xhunt_special_user_markers', {
      fields: ['username'],
      unique: true,
      name: 'idx_special_user_markers_username_unique',
    });

    await queryInterface.addIndex('xhunt_special_user_markers', {
      fields: ['twitter_id'],
      name: 'idx_special_user_markers_twitter_id',
    });

    await queryInterface.addIndex('xhunt_special_user_markers', {
      fields: ['enabled'],
      name: 'idx_special_user_markers_enabled',
    });

    await queryInterface.addIndex('xhunt_special_user_markers', {
      fields: ['visible_scope'],
      name: 'idx_special_user_markers_visible_scope',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('xhunt_special_user_markers');
  },
};
