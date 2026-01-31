'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addIndex('CrawlLogs', ['url', 'status'], {
      name: 'url_status_idx',
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeIndex('CrawlLogs', 'url_status_idx');
  }
};