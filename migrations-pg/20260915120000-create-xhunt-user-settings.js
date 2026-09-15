'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable('XHuntUserSettings', {
      id: {
        type: DataTypes.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        comment: '配置记录唯一标识符',
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'XHuntUsers',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: '关联 XHuntUsers.id',
      },
      category: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: 'all',
        comment: '配置类别：all(全量大对象) / cleaner / display / features',
      },
      settings: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: '用户具体配置内容 (JSONB)',
      },
      version: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 1,
        comment: '配置版本号，每次成功修改递增',
      },
      clientUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: '客户端提交修改的时间戳',
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

    await queryInterface.addIndex('XHuntUserSettings', {
      fields: ['userId', 'category'],
      unique: true,
      name: 'uq_xhunt_user_settings_user_category',
    });

    await queryInterface.addIndex('XHuntUserSettings', {
      fields: ['userId'],
      name: 'idx_xhunt_user_settings_user_id',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('XHuntUserSettings');
  },
};
