'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
	  await queryInterface.addIndex(
		  'InvestmentRelationships', // 表名
		  ['investorProjectId', 'fundedProjectId', 'round'], // 索引的字段
		  {
			  name: 'unique_investment_relationship', // 索引的名称
			  unique: true, // 唯一索引
		  }
	  );
  },

  async down (queryInterface, Sequelize) {
	  await queryInterface.removeIndex('InvestmentRelationships', 'unique_investment_relationship');
  }
};
