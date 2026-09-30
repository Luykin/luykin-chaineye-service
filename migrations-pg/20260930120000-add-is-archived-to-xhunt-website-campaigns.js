'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('XHuntWebsiteCampaigns', 'isArchived', {
      type: Sequelize.DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: '是否从内部活动配置中归档',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('XHuntWebsiteCampaigns', 'isArchived');
  },
};
