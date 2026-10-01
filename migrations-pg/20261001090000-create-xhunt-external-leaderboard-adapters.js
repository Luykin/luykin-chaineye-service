'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('XhuntExternalLeaderboardAdapters', {
      id: { type: Sequelize.DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false },
      campaignKey: { type: Sequelize.DataTypes.STRING(128), allowNull: false },
      leaderboardKey: { type: Sequelize.DataTypes.STRING(128), allowNull: false },
      draftConfig: { type: Sequelize.DataTypes.JSONB, allowNull: false, defaultValue: {} },
      publishedConfig: { type: Sequelize.DataTypes.JSONB, allowNull: true },
      lastSample: { type: Sequelize.DataTypes.JSONB, allowNull: false, defaultValue: {} },
      lastPreview: { type: Sequelize.DataTypes.JSONB, allowNull: false, defaultValue: {} },
      publishedVersion: { type: Sequelize.DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.DataTypes.STRING(32), allowNull: false, defaultValue: 'draft' },
      publishedAt: { type: Sequelize.DataTypes.DATE, allowNull: true },
      publishedByAdminId: { type: Sequelize.DataTypes.BIGINT, allowNull: true },
      createdAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('XhuntExternalLeaderboardAdapters', ['campaignKey', 'leaderboardKey'], {
      name: 'uq_xhunt_external_leaderboard_adapters_campaign_leaderboard',
      unique: true,
    });
    await queryInterface.addIndex('XhuntExternalLeaderboardAdapters', ['campaignKey'], {
      name: 'idx_xhunt_external_leaderboard_adapters_campaign_key',
    });
    await queryInterface.addIndex('XhuntExternalLeaderboardAdapters', ['status'], {
      name: 'idx_xhunt_external_leaderboard_adapters_status',
    });
  },
  down: async (queryInterface) => queryInterface.dropTable('XhuntExternalLeaderboardAdapters'),
};
