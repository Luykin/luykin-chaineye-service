'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable('xhunt_user_tags', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: 'Twitter 用户名（小写存储）',
      },
      twitterId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'Twitter 用户 ID（同步自 data.cryptohunt.ai）',
      },
      tagsZh: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: '中文标签列表',
      },
      tagsEn: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: '英文标签列表',
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

    await queryInterface.addIndex('xhunt_user_tags', {
      fields: ['username'],
      unique: true,
      name: 'idx_xhunt_user_tags_username_unique',
    });

    await queryInterface.addIndex('xhunt_user_tags', {
      fields: ['twitterId'],
      name: 'idx_xhunt_user_tags_twitter_id',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('xhunt_user_tags');
  },
};
