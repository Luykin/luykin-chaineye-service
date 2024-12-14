'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
	  await queryInterface.changeColumn('ExNews', 'timestamp', {
		  type: Sequelize.STRING,
		  allowNull: true,
	  });
	  await queryInterface.changeColumn('ExNews', 'crawlTime', {
		  type: Sequelize.INTEGER,
		  allowNull: true,
		  defaultValue: 0,
	  });
  },

  async down (queryInterface, Sequelize) {
	  await queryInterface.changeColumn('ExNews', 'timestamp', {
		  type: Sequelize.DATE,
		  allowNull: true,
	  });
	  await queryInterface.changeColumn('ExNews', 'crawlTime', {
		  type: Sequelize.INTEGER,
		  allowNull: true,
		  defaultValue: 0,
	  });
  }
};
