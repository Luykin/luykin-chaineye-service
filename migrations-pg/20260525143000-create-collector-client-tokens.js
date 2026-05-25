'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable('CollectorClientTokens', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: '采集客户端 token 名称，例如 Windows RootData Tampermonkey',
      },
      token_hash: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        comment: 'token 的 SHA-256 哈希，不保存明文',
      },
      token_prefix: {
        type: DataTypes.STRING(24),
        allowNull: false,
        comment: 'token 前缀，用于后台展示和审计定位',
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      last_used_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_by_admin_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      created_by_admin_email: {
        type: DataTypes.STRING(255),
        allowNull: true,
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

    await queryInterface.addIndex('CollectorClientTokens', ['token_hash'], {
      unique: true,
      name: 'idx_collector_client_tokens_token_hash',
    });
    await queryInterface.addIndex('CollectorClientTokens', ['is_active', 'expires_at'], {
      name: 'idx_collector_client_tokens_active_expires',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('CollectorClientTokens');
  },
};
