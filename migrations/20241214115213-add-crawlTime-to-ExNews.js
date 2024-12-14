'use strict';

module.exports = {
	async up(queryInterface, Sequelize) {
		await queryInterface.addColumn('ExNews', 'crawlTime', {
			type: Sequelize.DATE,
			allowNull: true,
		});
	},
	
	async down(queryInterface, Sequelize) {
		await queryInterface.removeColumn('ExNews', 'crawlTime');
	},
};
