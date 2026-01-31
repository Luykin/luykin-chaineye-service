'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addIndex('RootdataCrawlLogs', ['url', 'status'], {
      name: 'url_status_idx',
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeIndex('RootdataCrawlLogs', 'url_status_idx');
  }
};
