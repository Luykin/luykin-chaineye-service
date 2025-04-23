'use strict';

module.exports = {
	up: async (queryInterface, Sequelize) => {
		const tableInfo = await queryInterface.describeTable('Projects');
		
		if (!tableInfo.isVcListed) {
			await queryInterface.addColumn('Projects', 'isVcListed', {
				type: Sequelize.BOOLEAN,
				defaultValue: null,
				allowNull: true,
			});
		}
		
		if (!tableInfo.vcListPage) {
			await queryInterface.addColumn('Projects', 'vcListPage', {
				type: Sequelize.INTEGER,
				defaultValue: null,
				allowNull: true,
			});
		}
	},
	
	down: async (queryInterface, Sequelize) => {
		await queryInterface.removeColumn('Projects', 'isVcListed');
		await queryInterface.removeColumn('Projects', 'vcListPage');
	},
};
