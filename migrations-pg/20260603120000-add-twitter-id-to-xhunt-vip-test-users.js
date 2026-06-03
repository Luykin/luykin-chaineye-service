'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.addColumn('xhunt_vip_test_users', 'twitterId', {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: 'Twitter 用户 ID（同步自 data.cryptohunt.ai）',
    });

    await queryInterface.addIndex('xhunt_vip_test_users', {
      fields: ['twitterId', 'listType'],
      name: 'idx_xhunt_vip_test_users_twitter_id_list_type',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex(
      'xhunt_vip_test_users',
      'idx_xhunt_vip_test_users_twitter_id_list_type'
    );
    await queryInterface.removeColumn('xhunt_vip_test_users', 'twitterId');
  },
};
