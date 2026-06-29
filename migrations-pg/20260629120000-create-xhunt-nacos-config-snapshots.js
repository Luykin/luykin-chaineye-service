'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable('xhunt_nacos_config_snapshots', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      dataId: {
        type: DataTypes.STRING(160),
        allowNull: false,
        comment: 'Nacos dataId',
      },
      group: {
        type: DataTypes.STRING(160),
        allowNull: false,
        defaultValue: 'DEFAULT_GROUP',
        comment: 'Nacos group',
      },
      tenant: {
        type: DataTypes.STRING(160),
        allowNull: true,
        comment: 'Nacos tenant / namespace',
      },
      type: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'json',
        comment: '配置类型',
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: '配置内容快照',
      },
      contentSha256: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: '配置内容 SHA256',
      },
      contentLength: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: '配置内容字节数',
      },
      action: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: 'publish / backup_before_publish / delete_backup',
      },
      reason: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: '变更原因',
      },
      operatorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: '操作管理员 ID',
      },
      operatorEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: '操作管理员邮箱',
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

    await queryInterface.addIndex('xhunt_nacos_config_snapshots', {
      fields: ['dataId', 'group', 'tenant', 'createdAt'],
      name: 'idx_xhunt_nacos_snapshots_config_time',
    });

    await queryInterface.addIndex('xhunt_nacos_config_snapshots', {
      fields: ['contentSha256'],
      name: 'idx_xhunt_nacos_snapshots_sha256',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('xhunt_nacos_config_snapshots');
  },
};
