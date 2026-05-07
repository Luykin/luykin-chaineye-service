'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('BinanceSquareCrawlLogs', 'failedDetails', {
      type: Sequelize.JSON,
      comment: '失败详情 —— [{username, error, time}]',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('BinanceSquareCrawlLogs', 'failedDetails');
  }
};
